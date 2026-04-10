"""
fetch_exchange_rates.py
=======================
Daily job that fetches the official USD/PEN exchange rate from BCRP and
inserts it into the Korakuen exchange_rates table in Supabase.

Source:
  BCRP — Banco Central de Reserva del Perú
  https://estadisticas.bcrp.gob.pe/estadisticas/series/api
  Series PD04639PD (compra) and PD04640PD (venta) — official SBS interbank
  rates, the same series SUNAT publishes daily for tax purposes.
  No auth required. No rate limits observed.

Date convention:
  BCRP labels each rate by the SBS closing date. SUNAT publishes that rate
  on the *next* business day (e.g. SBS Apr 7 closing → SUNAT publishes Apr 8).
  Korakuen stores rates by SUNAT publication date — the same date you would
  use on a Peruvian tax document. The script handles the +1 business day
  shift automatically.

Run:
  python fetch_exchange_rates.py                    # fetch today's published rate
  python fetch_exchange_rates.py --date 2026-03-15  # fetch a specific publication date
  python fetch_exchange_rates.py --backfill-days 30 # backfill last 30 calendar days
  python fetch_exchange_rates.py --force            # re-fetch even if rate exists

Schedule (Render Cron Job):
  Every weekday at 09:00 AM Peru time (UTC-5 → 14:00 UTC)
  Cron expression: 0 14 * * 1-5

Environment variables required:
  SUPABASE_DB_URL  — Postgres connection string
                     e.g. postgresql://user:pass@host:5432/postgres

Dependencies:
  pip install httpx psycopg2-binary python-dotenv
"""

import argparse
import logging
import os
import sys
from datetime import date, timedelta

import httpx
import psycopg2
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUPABASE_DB_URL = os.environ["SUPABASE_DB_URL"]

# BCRP statistics API
# PD04639PD = USD/PEN compra (SBS interbank buy)
# PD04640PD = USD/PEN venta (SBS interbank sell)
BCRP_BASE_URL = "https://estadisticas.bcrp.gob.pe/estadisticas/series/api"
BCRP_SERIES = "PD04639PD-PD04640PD"

REQUEST_TIMEOUT = 15  # seconds

# Sanity bounds — PEN/USD should always be in this range.
# If parsed values fall outside, the response format has changed — fail loudly.
RATE_MIN = 2.5
RATE_MAX = 6.0

# BCRP returns Spanish month abbreviations: Ene, Feb, Mar, Abr, May, Jun,
# Jul, Ago, Set/Sep, Oct, Nov, Dic
SPANISH_MONTHS = {
    "Ene": 1, "Feb": 2, "Mar": 3, "Abr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Ago": 8, "Set": 9, "Sep": 9, "Oct": 10, "Nov": 11, "Dic": 12,
}

# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------


def prev_business_day(d: date) -> date:
    """Return the previous business day (Mon-Fri) strictly before d."""
    prev = d - timedelta(days=1)
    while prev.weekday() >= 5:
        prev -= timedelta(days=1)
    return prev


def next_business_day(d: date) -> date:
    """Return the next business day (Mon-Fri) strictly after d."""
    nxt = d + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)
    return nxt


def parse_bcrp_date(name: str) -> date:
    """Parse a BCRP date label like '08.Abr.26' into a date."""
    parts = name.split(".")
    if len(parts) != 3:
        raise RuntimeError(f"Unexpected BCRP date format: {name!r}")
    day_str, mon_str, year_str = parts
    month = SPANISH_MONTHS.get(mon_str)
    if month is None:
        raise RuntimeError(f"Unknown Spanish month abbreviation: {mon_str!r}")
    return date(2000 + int(year_str), month, int(day_str))


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


def fetch_from_bcrp(start: date, end: date) -> list[tuple[date, float, float]]:
    """
    Fetch (sbs_date, compra, venta) tuples from the BCRP statistics API
    for the SBS closing-date range [start, end] inclusive.

    Returns rows in chronological order (skips weekends and holidays naturally).
    Raises RuntimeError on transport, format, or sanity failures.
    """
    url = f"{BCRP_BASE_URL}/{BCRP_SERIES}/json/{start.isoformat()}/{end.isoformat()}"
    log.info("Fetching exchange rates from BCRP: %s", url)

    try:
        response = httpx.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"BCRP returned HTTP {e.response.status_code}") from e
    except httpx.RequestError as e:
        raise RuntimeError(f"BCRP request failed: {e}") from e

    try:
        payload = response.json()
    except ValueError as e:
        raise RuntimeError(f"BCRP response is not valid JSON: {e}") from e

    periods = payload.get("periods")
    if not isinstance(periods, list):
        raise RuntimeError(
            "BCRP response missing 'periods' array. Endpoint format may have changed."
        )

    rows: list[tuple[date, float, float]] = []
    for period in periods:
        name = period.get("name")
        values = period.get("values") or []
        if not name or len(values) < 2:
            log.warning("Skipping malformed BCRP period: %r", period)
            continue

        try:
            sbs_date = parse_bcrp_date(name)
            compra = float(values[0])
            venta = float(values[1])
        except (ValueError, RuntimeError) as e:
            log.warning("Skipping unparseable BCRP period %r: %s", period, e)
            continue

        if not (RATE_MIN <= compra <= RATE_MAX):
            raise RuntimeError(
                f"BCRP compra rate {compra} on {sbs_date} is outside expected "
                f"range [{RATE_MIN}, {RATE_MAX}]. Refusing to store."
            )
        if not (RATE_MIN <= venta <= RATE_MAX):
            raise RuntimeError(
                f"BCRP venta rate {venta} on {sbs_date} is outside expected "
                f"range [{RATE_MIN}, {RATE_MAX}]. Refusing to store."
            )
        if compra > venta:
            raise RuntimeError(
                f"BCRP compra ({compra}) > venta ({venta}) on {sbs_date}. "
                f"This should never happen."
            )

        rows.append((sbs_date, compra, venta))

    rows.sort(key=lambda r: r[0])
    log.info(
        "BCRP returned %d valid period(s) for SBS range %s..%s",
        len(rows), start, end,
    )
    return rows


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_connection():
    return psycopg2.connect(SUPABASE_DB_URL)


def rate_already_exists(publication_date: date) -> bool:
    """Return True if any USD/PEN row exists for this publication date."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM exchange_rates
                    WHERE base_currency   = 'USD'
                      AND target_currency = 'PEN'
                      AND rate_date       = %s
                )
                """,
                (publication_date,),
            )
            return cur.fetchone()[0]


def upsert_rate(publication_date: date, compra: float, venta: float) -> None:
    """
    Upsert three rows for publication_date: compra, venta, promedio.
    ON CONFLICT DO UPDATE makes this safely re-runnable.
    Source is recorded as 'sunat' — BCRP republishes the same SBS rate
    that SUNAT publishes for tax purposes.
    """
    promedio = round((compra + venta) / 2, 6)

    rows = [
        ("compra",   compra),
        ("venta",    venta),
        ("promedio", promedio),
    ]

    with get_connection() as conn:
        with conn.cursor() as cur:
            for rate_type, rate_value in rows:
                cur.execute(
                    """
                    INSERT INTO exchange_rates
                        (base_currency, target_currency, rate_type,
                         rate, rate_date, source)
                    VALUES
                        ('USD', 'PEN', %s, %s, %s, 'sunat')
                    ON CONFLICT (base_currency, target_currency, rate_type, rate_date)
                    DO UPDATE SET
                        rate       = EXCLUDED.rate,
                        source     = EXCLUDED.source,
                        updated_at = now()
                    """,
                    (rate_type, rate_value, publication_date),
                )

    log.info(
        "Stored rates for %s — compra: %.4f | venta: %.4f | promedio: %.4f",
        publication_date, compra, venta, promedio,
    )


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def process_publication_date(publication_date: date, force: bool = False) -> None:
    """
    Fetch the SBS rate that corresponds to the given SUNAT publication date
    and store it. Skips weekends — SUNAT does not publish on Sat/Sun.
    """
    if publication_date.weekday() >= 5:
        log.info("Skipping %s — weekend (SUNAT does not publish).", publication_date)
        return

    if not force and rate_already_exists(publication_date):
        log.info(
            "Rate for %s already exists. Use --force to overwrite.", publication_date
        )
        return

    sbs_date = prev_business_day(publication_date)
    rows = fetch_from_bcrp(sbs_date, sbs_date)

    if not rows:
        raise RuntimeError(
            f"BCRP returned no data for SBS date {sbs_date} "
            f"(publication date {publication_date}). The rate may not be published yet."
        )

    _, compra, venta = rows[0]
    upsert_rate(publication_date, compra, venta)


def process_backfill(days: int, force: bool = False) -> int:
    """
    Backfill the last `days` calendar days of publication dates with a single
    BCRP request. Returns the number of failures.
    """
    today = date.today()
    earliest_publication = today - timedelta(days=days)

    sbs_start = prev_business_day(earliest_publication)
    sbs_end = prev_business_day(today + timedelta(days=1))

    log.info(
        "Backfilling publication dates %s..%s (BCRP SBS range %s..%s)",
        earliest_publication, today, sbs_start, sbs_end,
    )

    try:
        rows = fetch_from_bcrp(sbs_start, sbs_end)
    except Exception as e:
        log.error("BCRP request failed: %s", e)
        return 1

    if not rows:
        log.warning("BCRP returned no rows for the requested range.")
        return 0

    upserted = 0
    skipped = 0
    failures = 0

    for sbs_date, compra, venta in rows:
        publication_date = next_business_day(sbs_date)
        if publication_date > today:
            log.info(
                "Skipping %s — publication date in the future.", publication_date
            )
            continue
        if publication_date < earliest_publication:
            continue
        if not force and rate_already_exists(publication_date):
            log.info("Skipping %s — already exists.", publication_date)
            skipped += 1
            continue
        try:
            upsert_rate(publication_date, compra, venta)
            upserted += 1
        except Exception as e:
            log.error("FAILED to upsert %s: %s", publication_date, e)
            failures += 1

    log.info(
        "Backfill summary: upserted=%d, skipped=%d, failed=%d",
        upserted, skipped, failures,
    )
    return failures


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch daily USD/PEN exchange rates from BCRP into Supabase."
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Specific publication date to fetch (YYYY-MM-DD). Defaults to today.",
    )
    parser.add_argument(
        "--backfill-days",
        type=int,
        metavar="N",
        help="Backfill the last N calendar days (skips weekends and existing rows).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch and overwrite even if the rate already exists.",
    )
    args = parser.parse_args()

    if args.backfill_days:
        failures = process_backfill(args.backfill_days, force=args.force)
        if failures:
            log.error(
                "%d row(s) failed to upsert. Enter missing rates manually via "
                "the dashboard: Settings → Tipos de Cambio → Registrar manualmente",
                failures,
            )
            sys.exit(1)
        log.info("Backfill complete.")
    else:
        target_date = (
            date.fromisoformat(args.date) if args.date else date.today()
        )
        try:
            process_publication_date(target_date, force=args.force)
        except Exception as e:
            log.error("FAILED: %s", e)
            log.error(
                "Enter the rate manually via the dashboard: "
                "Settings → Tipos de Cambio → Registrar manualmente"
            )
            sys.exit(1)


if __name__ == "__main__":
    main()
