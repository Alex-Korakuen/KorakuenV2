-- Migration: exchange_rates
-- Append-only. Populated by fetch_exchange_rates.py daily cron job.
-- Three rows per weekday: compra, venta, promedio.

CREATE TABLE exchange_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency   text NOT NULL DEFAULT 'USD',
  target_currency text NOT NULL DEFAULT 'PEN',
  rate_type       text NOT NULL,                            -- 'compra' | 'venta' | 'promedio' | 'manual'
  rate            numeric(10,6) NOT NULL,                   -- units of target per 1 base (e.g. 3.745600)
  rate_date       date NOT NULL,
  source          text NOT NULL DEFAULT 'sunat',            -- 'sunat' | 'manual'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (base_currency, target_currency, rate_type, rate_date)
);
