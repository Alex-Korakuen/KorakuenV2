import { createServiceClient } from "@/lib/db";
import { failure, success } from "@/lib/types";
import type { ValidationResult } from "@/lib/types";

type ExchangeRateResult = {
  rate: number;
  rate_date: string;
};

/**
 * Look up the exchange rate for a given date.
 *
 * Uses the fallback rule from schema-reference.md: if no rate exists for the
 * exact date, returns the most recent rate on or before that date.
 * This handles weekends naturally (Friday's rate covers Saturday and Sunday).
 *
 * Returns null if no rate exists at all.
 */
export async function getExchangeRate(
  date: Date,
  rateType: string = "promedio",
): Promise<ExchangeRateResult | null> {
  const supabase = createServiceClient();
  const dateStr = date.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate, rate_date")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_type", rateType)
    .lte("rate_date", dateStr)
    .order("rate_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return { rate, rate_date: data.rate_date };
}

/**
 * Same as getExchangeRate but returns a validation error if no rate is found.
 * Use in validators and server actions that cannot proceed without a rate.
 */
export async function requireExchangeRate(
  date: Date,
  rateType: string = "promedio",
): Promise<ValidationResult<ExchangeRateResult>> {
  const result = await getExchangeRate(date, rateType);

  if (!result) {
    const dateStr = date.toISOString().split("T")[0];
    return failure(
      "VALIDATION_ERROR",
      `No hay tipo de cambio disponible para ${dateStr}. Registre el tipo de cambio manualmente.`,
      { exchange_rate: `No exchange rate found for ${dateStr} or earlier` },
    );
  }

  return success(result);
}

/**
 * Strict exact-match lookup for a specific date. Unlike `requireExchangeRate`,
 * this does NOT fall back to the most recent prior rate. Used by the outgoing
 * invoice creation flow where Alex's rule is: if the rate for the exact issue
 * date isn't in the table, block creation and make the admin register it
 * manually via Settings → Tipos de Cambio. With the Step 7 weekend backfill
 * in place, weekend dates are always present (duplicated from Friday), so
 * this lookup only fails on genuine gaps that need human attention.
 */
export async function requireExactExchangeRate(
  dateStr: string,
  rateType: string = "promedio",
): Promise<ValidationResult<ExchangeRateResult>> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate, rate_date")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_type", rateType)
    .eq("rate_date", dateStr)
    .maybeSingle();

  if (error || !data) {
    return failure(
      "VALIDATION_ERROR",
      `No hay tipo de cambio registrado para ${dateStr}. Registre el tipo de cambio en Ajustes → Tipos de Cambio antes de crear el documento.`,
      { exchange_rate: `No exchange rate found for exact date ${dateStr}` },
    );
  }

  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return failure(
      "VALIDATION_ERROR",
      `El tipo de cambio registrado para ${dateStr} no es válido.`,
      { exchange_rate: `Invalid stored rate for ${dateStr}` },
    );
  }

  return success({ rate, rate_date: data.rate_date as string });
}

/**
 * Check whether today's exchange rate is available.
 *
 * Used by the health endpoint and the dashboard banner.
 * Compares against today in Lima timezone (the system operates on Peru time).
 * Weekends are always ok — SUNAT does not publish on Saturday/Sunday.
 */
export async function checkExchangeRateHealth(): Promise<{
  ok: boolean;
  last_rate_date: string | null;
  last_rate_promedio: number | null;
  days_since_last_rate: number | null;
  alert: string | null;
}> {
  const supabase = createServiceClient();
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });
  const dayOfWeek = new Date(today + "T12:00:00-05:00").getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate, rate_date")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_type", "promedio")
    .order("rate_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return {
      ok: isWeekend,
      last_rate_date: null,
      last_rate_promedio: null,
      days_since_last_rate: null,
      alert: isWeekend
        ? null
        : `No exchange rate for today (${today}). Transactions in USD cannot be converted. Enter the rate manually.`,
    };
  }

  const rate = Number(data.rate);
  const lastDate = data.rate_date as string;
  const daysDiff = Math.floor(
    (new Date(today).getTime() - new Date(lastDate).getTime()) /
      (1000 * 60 * 60 * 24),
  );
  const rateOk = isWeekend || lastDate === today;

  return {
    ok: rateOk,
    last_rate_date: lastDate,
    last_rate_promedio: Number.isFinite(rate) ? rate : null,
    days_since_last_rate: daysDiff,
    alert: rateOk
      ? null
      : `No exchange rate for today (${today}). Transactions in USD cannot be converted. Enter the rate manually.`,
  };
}

/**
 * Convert an amount to PEN using a given exchange rate.
 * Pure function — no database call.
 */
export function convertToSoles(amount: number, exchangeRate: number): number {
  return Math.round(amount * exchangeRate * 100) / 100;
}
