"""
fetch_exchange_rates.py
=======================
Daily job that fetches the official USD/PEN exchange rate from SUNAT and
inserts it into the Korakuen exchange_rates table in Supabase.

Source:
  SUNAT — https://www.sunat.gob.pe/cl-at-ittipcam/tcS01Alias
  Publishes the SBS closing rate of the previous business day.
  No auth required. Official for SUNAT tax calculations.

No fallback. If the SUNAT endpoint fails, the job fails loudly and exits
with a non-zero code. Render will log the failure. A missing rate for today
is surfaced as an alert in the Korakuen dashboard via GET /system/health.

Run:
  python fetch_exchange_rates.py                    # fetch today's rate
  python fetch_exchange_rates.py --date 2026-03-15  # backfill a specific date
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
import xml.etree.ElementTree as ET
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

# SUNAT XML endpoint — SBS closing rate of the previous business day
SUNAT_URL = "https://www.sunat.gob.pe/cl-at-ittipcam/tcS01Alias"

REQUEST_TIMEOUT = 15  # seconds

# Sanity bounds — PEN/USD should always be in this range.
# If parsed values fall outside, the XML format has changed — fail loudly.
RATE_MIN = 2.5
RATE_MAX = 6.0

# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------


def fetch_from_sunat() -> tuple[float, float, str]:
    """
    Fetch compra and venta rates from the SUNAT XML endpoint.

    SUNAT returns the SBS closing rate for the previous business day.
    The fecha in the response tells us which date the rates are for.

    Returns (compra, venta, fecha_str) on success.
    Raises RuntimeError on any failure — no silent fallback.

    SUNAT XML shape:
      <tcS01>
        <tcS01-0100>
          <tc_compra>3.745</tc_compra>
          <tc_venta>3.748</tc_venta>
          <tc_fecha>09/04/2026</tc_fecha>
        </tcS01-0100>
      </tcS01>
    """
    log.info("Fetching exchange rate from SUNAT: %s", SUNAT_URL)

    try:
        response = httpx.get(SUNAT_URL, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"SUNAT returned HTTP {e.response.status_code}") from e
    except httpx.RequestError as e:
        raise RuntimeError(f"SUNAT request failed: {e}") from e

    try:
        root = ET.fromstring(response.text)
    except ET.ParseError as e:
        raise RuntimeError(f"SUNAT response is not valid XML: {e}") from e

    compra_el = root.find(".//tc_compra")
    venta_el  = root.find(".//tc_venta")
    fecha_el  = root.find(".//tc_fecha")

    if compra_el is None or venta_el is None:
        raise RuntimeError(
            "SUNAT XML is missing <tc_compra> or <tc_venta>. "
            "The endpoint format may have changed."
        )

    try:
        compra = float(compra_el.text.strip())
        venta  = float(venta_el.text.strip())
    except (ValueError, AttributeError) as e:
        raise RuntimeError(f"Could not parse rate values from SUNAT XML: {e}") from e

    fecha_str = fecha_el.text.strip() if fecha_el is not None else "unknown"

    # Sanity check — if these fail, something is very wrong with the data
    if not (RATE_MIN <= compra <= RATE_MAX):
        raise RuntimeError(
            f"SUNAT compra rate {compra} is outside expected range "
            f"[{RATE_MIN}, {RATE_MAX}]. Refusing to store."
        )
    if not (RATE_MIN <= venta <= RATE_MAX):
        raise RuntimeError(
            f"SUNAT venta rate {venta} is outside expected range "
            f"[{RATE_MIN}, {RATE_MAX}]. Refusing to store."
        )
    if compra > venta:
        raise RuntimeError(
            f"SUNAT compra ({compra}) > venta ({venta}). This should never happen."
        )

    log.info(
        "SUNAT OK — fecha: %s | compra: %.4f | venta: %.4f",
        fecha_str, compra, venta,
    )
    return compra, venta, fecha_str


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_connection():
    return psycopg2.connect(SUPABASE_DB_URL)


def rate_already_exists(target_date: date) -> bool:
    """Return True if we already have any rate row for this date."""
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
                (target_date,),
            )
            return cur.fetchone()[0]


def upsert_rate(target_date: date, compra: float, venta: float) -> None:
    """
    Upsert three rows for target_date: compra, venta, promedio.
    ON CONFLICT DO UPDATE makes this safely re-runnable.
    All three rows use source = 'sunat'.
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
                    (rate_type, rate_value, target_date),
                )

    log.info(
        "Stored rates for %s — compra: %.4f | venta: %.4f | promedio: %.4f",
        target_date, compra, venta, promedio,
    )


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------


def process_date(target_date: date, force: bool = False) -> None:
    """
    Fetch and store the rate for target_date.
    Raises on any failure — caller decides how to handle.

    Skips weekends: SBS does not publish on Saturday or Sunday.
    The engine's fallback rule (most recent available rate) covers the gap.
    """
    if target_date.weekday() >= 5:  # 5=Sat, 6=Sun
        log.info("Skipping %s — weekend (SBS does not publish).", target_date)
        return

    if not force and rate_already_exists(target_date):
        log.info(
            "Rate for %s already exists. Use --force to overwrite.", target_date
        )
        return

    compra, venta, _ = fetch_from_sunat()
    upsert_rate(target_date, compra, venta)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch daily USD/PEN exchange rates from SUNAT into Supabase."
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Specific date to fetch (YYYY-MM-DD). Defaults to today.",
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
        today = date.today()
        failures: list[tuple[date, str]] = []

        log.info("Backfilling last %d calendar days...", args.backfill_days)
        for i in range(args.backfill_days, -1, -1):
            d = today - timedelta(days=i)
            try:
                process_date(d, force=args.force)
            except Exception as e:
                log.error("FAILED for %s: %s", d, e)
                failures.append((d, str(e)))

        if failures:
            log.error(
                "%d date(s) failed: %s",
                len(failures),
                ", ".join(str(d) for d, _ in failures),
            )
            log.error(
                "Enter missing rates manually via the dashboard: "
                "Settings → Tipos de Cambio → Registrar manualmente"
            )
            sys.exit(1)

        log.info("Backfill complete.")

    else:
        target_date = (
            date.fromisoformat(args.date) if args.date else date.today()
        )
        try:
            process_date(target_date, force=args.force)
        except Exception as e:
            log.error("FAILED: %s", e)
            log.error(
                "Enter the rate manually via the dashboard: "
                "Settings → Tipos de Cambio → Registrar manualmente"
            )
            sys.exit(1)


if __name__ == "__main__":
    main()
