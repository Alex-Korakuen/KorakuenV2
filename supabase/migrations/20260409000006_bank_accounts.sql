-- Migration: bank_accounts
-- Korakuen's own bank accounts. Every payment must reference one.
-- Balance is always derived, never stored.

CREATE TABLE bank_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,                            -- e.g. "BCP Cuenta Corriente PEN"
  bank_name       text NOT NULL,
  account_number  text,                                     -- masked, e.g. "****3421"
  currency        text NOT NULL,                            -- 'PEN' | 'USD'
  account_type    smallint NOT NULL DEFAULT 1,              -- 1=regular, 2=banco_de_la_nacion
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT bn_always_pen
    CHECK (account_type != 2 OR currency = 'PEN')
);
