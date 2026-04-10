/**
 * BCRP (Banco Central de Reserva del Perú) exchange rate integration.
 *
 * Used by the daily Vercel Cron job at /api/cron/fetch-exchange-rates.
 * Source: https://estadisticas.bcrp.gob.pe/estadisticas/series/api
 *   PD04639PD = USD/PEN compra (SBS interbank buy)
 *   PD04640PD = USD/PEN venta (SBS interbank sell)
 *
 * BCRP republishes the same SBS rates that SUNAT publishes for tax purposes,
 * but labels them by SBS closing date. SUNAT publishes that rate on the
 * NEXT business day (e.g. SBS Apr 7 closing → SUNAT publishes Apr 8).
 * Korakuen stores rates by SUNAT publication date — the same date you would
 * use on a tax document. The +1 business day shift is handled here.
 */

import { createServiceClient } from "@/lib/db";

const BCRP_BASE_URL =
  "https://estadisticas.bcrp.gob.pe/estadisticas/series/api";
const BCRP_SERIES = "PD04639PD-PD04640PD";
const REQUEST_TIMEOUT_MS = 15_000;

// Sanity bounds — PEN/USD should always be in this range.
// If parsed values fall outside, the response format has changed — fail loudly.
const RATE_MIN = 2.5;
const RATE_MAX = 6.0;

const SPANISH_MONTHS: Record<string, number> = {
  Ene: 1,
  Feb: 2,
  Mar: 3,
  Abr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Ago: 8,
  Set: 9,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dic: 12,
};

export type BcrpRow = {
  sbs_date: string; // YYYY-MM-DD
  compra: number;
  venta: number;
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Return a YYYY-MM-DD string for a Date, using its UTC components.
 * Inputs to this module are date-only values constructed at noon UTC.
 */
function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Parse a YYYY-MM-DD string into a Date at noon UTC.
 * Noon avoids any DST/timezone edge cases when only the date matters.
 */
function dateFromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** Day of week using UTC components: 0=Sun, 6=Sat. */
function utcDayOfWeek(d: Date): number {
  return d.getUTCDay();
}

/** Strict previous business day (Mon-Fri). */
export function prevBusinessDay(d: Date): Date {
  const prev = new Date(d);
  prev.setUTCDate(prev.getUTCDate() - 1);
  while (utcDayOfWeek(prev) === 0 || utcDayOfWeek(prev) === 6) {
    prev.setUTCDate(prev.getUTCDate() - 1);
  }
  return prev;
}

/** Strict next business day (Mon-Fri). */
export function nextBusinessDay(d: Date): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + 1);
  while (utcDayOfWeek(next) === 0 || utcDayOfWeek(next) === 6) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/** Parse a BCRP date label like "08.Abr.26" into a Date at noon UTC. */
export function parseBcrpDate(name: string): Date {
  const parts = name.split(".");
  if (parts.length !== 3) {
    throw new Error(`Unexpected BCRP date format: ${name}`);
  }
  const [dayStr, monStr, yearStr] = parts;
  const month = SPANISH_MONTHS[monStr];
  if (!month) {
    throw new Error(`Unknown Spanish month abbreviation: ${monStr}`);
  }
  const year = 2000 + parseInt(yearStr, 10);
  const day = parseInt(dayStr, 10);
  if (!Number.isFinite(year) || !Number.isFinite(day)) {
    throw new Error(`Could not parse BCRP date: ${name}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Today's date in Lima timezone, returned as a Date at noon UTC. */
export function todayInLima(): Date {
  const limaIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });
  return dateFromIso(limaIso);
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch (sbs_date, compra, venta) rows from BCRP for the given closing-date
 * range, inclusive. Returns chronologically sorted rows. Skips weekends and
 * holidays naturally (BCRP simply doesn't include them).
 *
 * Throws on transport, format, or sanity-check failures.
 */
export async function fetchFromBcrp(
  start: Date,
  end: Date,
): Promise<BcrpRow[]> {
  const url = `${BCRP_BASE_URL}/${BCRP_SERIES}/json/${isoDate(start)}/${isoDate(end)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    // BCRP returns HTML garbage appended to the JSON body when called with
    // Node's default User-Agent. Sending an explicit UA gets the clean
    // 297-byte JSON response that curl and Python receive.
    response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Korakuen-ExchangeRateCron/1.0" },
    });
  } catch (e) {
    throw new Error(
      `BCRP request failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`BCRP returned HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (e) {
    throw new Error(
      `BCRP response is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const periods = (payload as { periods?: unknown }).periods;
  if (!Array.isArray(periods)) {
    throw new Error(
      "BCRP response missing 'periods' array. Endpoint format may have changed.",
    );
  }

  const rows: BcrpRow[] = [];
  for (const period of periods) {
    const p = period as { name?: string; values?: unknown[] };
    if (!p.name || !Array.isArray(p.values) || p.values.length < 2) {
      continue;
    }

    let sbsDate: Date;
    let compra: number;
    let venta: number;
    try {
      sbsDate = parseBcrpDate(p.name);
      compra = Number(p.values[0]);
      venta = Number(p.values[1]);
    } catch {
      continue;
    }

    if (!Number.isFinite(compra) || !Number.isFinite(venta)) {
      continue;
    }

    if (compra < RATE_MIN || compra > RATE_MAX) {
      throw new Error(
        `BCRP compra rate ${compra} on ${isoDate(sbsDate)} is outside expected range [${RATE_MIN}, ${RATE_MAX}].`,
      );
    }
    if (venta < RATE_MIN || venta > RATE_MAX) {
      throw new Error(
        `BCRP venta rate ${venta} on ${isoDate(sbsDate)} is outside expected range [${RATE_MIN}, ${RATE_MAX}].`,
      );
    }
    if (compra > venta) {
      throw new Error(
        `BCRP compra (${compra}) > venta (${venta}) on ${isoDate(sbsDate)}. This should never happen.`,
      );
    }

    rows.push({ sbs_date: isoDate(sbsDate), compra, venta });
  }

  rows.sort((a, b) => a.sbs_date.localeCompare(b.sbs_date));
  return rows;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export async function rateExistsForPublicationDate(
  publicationDate: Date,
): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("id")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_date", isoDate(publicationDate))
    .limit(1);

  if (error) {
    throw new Error(`Failed to check rate existence: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Upsert three rows (compra, venta, promedio) for a publication date.
 * Idempotent — safely re-runnable.
 */
export async function upsertExchangeRate(
  publicationDate: Date,
  compra: number,
  venta: number,
): Promise<void> {
  const supabase = createServiceClient();
  const promedio = Math.round(((compra + venta) / 2) * 1_000_000) / 1_000_000;
  const dateStr = isoDate(publicationDate);

  const rows = [
    { rate_type: "compra", rate: compra },
    { rate_type: "venta", rate: venta },
    { rate_type: "promedio", rate: promedio },
  ].map((r) => ({
    base_currency: "USD",
    target_currency: "PEN",
    rate_type: r.rate_type,
    rate: r.rate,
    rate_date: dateStr,
    source: "sunat",
  }));

  const { error } = await supabase
    .from("exchange_rates")
    .upsert(rows, {
      onConflict: "base_currency,target_currency,rate_type,rate_date",
    });

  if (error) {
    throw new Error(`Failed to upsert rates for ${dateStr}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type FetchAndStoreResult = {
  publication_date: string;
  stored: boolean;
  reason: "stored" | "weekend" | "already_exists";
  compra: number | null;
  venta: number | null;
  promedio: number | null;
};

/**
 * Fetch and store the SUNAT-published rate for the given publication date.
 * Skips Saturdays and Sundays (BCRP doesn't publish on weekends).
 *
 * Weekend backfill: on Friday runs the fetched rate is additionally written
 * to the following Saturday and Sunday rows. SUNAT's convention is to use
 * Friday's rate for weekend-dated transactions, so we materialize those rows
 * here instead of making every query special-case weekends.
 *
 * On Fridays the existing-row short-circuit is bypassed so weekend backfill
 * runs even when the Friday row was already stored by an earlier invocation.
 */
export async function fetchAndStorePublicationRate(
  publicationDate: Date,
  options: { force?: boolean } = {},
): Promise<FetchAndStoreResult> {
  const dateStr = isoDate(publicationDate);
  const dow = utcDayOfWeek(publicationDate);

  if (dow === 0 || dow === 6) {
    return {
      publication_date: dateStr,
      stored: false,
      reason: "weekend",
      compra: null,
      venta: null,
      promedio: null,
    };
  }

  const isFriday = dow === 5;

  if (
    !options.force &&
    !isFriday &&
    (await rateExistsForPublicationDate(publicationDate))
  ) {
    return {
      publication_date: dateStr,
      stored: false,
      reason: "already_exists",
      compra: null,
      venta: null,
      promedio: null,
    };
  }

  const sbsDate = prevBusinessDay(publicationDate);
  const rows = await fetchFromBcrp(sbsDate, sbsDate);

  if (rows.length === 0) {
    throw new Error(
      `BCRP returned no data for SBS date ${isoDate(sbsDate)} (publication date ${dateStr}). The rate may not be published yet.`,
    );
  }

  const { compra, venta } = rows[0];
  await upsertExchangeRate(publicationDate, compra, venta);

  if (isFriday) {
    const saturday = new Date(publicationDate);
    saturday.setUTCDate(saturday.getUTCDate() + 1);
    const sunday = new Date(publicationDate);
    sunday.setUTCDate(sunday.getUTCDate() + 2);
    await upsertExchangeRate(saturday, compra, venta);
    await upsertExchangeRate(sunday, compra, venta);
  }

  const promedio = Math.round(((compra + venta) / 2) * 1_000_000) / 1_000_000;

  return {
    publication_date: dateStr,
    stored: true,
    reason: "stored",
    compra,
    venta,
    promedio,
  };
}
