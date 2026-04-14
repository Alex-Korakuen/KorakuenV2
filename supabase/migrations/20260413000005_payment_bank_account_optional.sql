-- Migration: Optional bank_account_id on payments
--
-- Until now every payment had to reference one of Korakuen's own bank
-- accounts. That made it impossible to record payments made out-of-pocket
-- by one of the other consortium partners (Partner B pays a vendor from
-- their personal funds; no Korakuen account is involved). The only
-- workaround was to invent fake bank accounts, which would have polluted
-- the balance/reconciliation views.
--
-- This migration relaxes the NOT NULL. A payment with bank_account_id
-- = NULL means "no Korakuen account moved; the money came/went via the
-- partner in paid_by_partner_id". That partner is, by definition, not the
-- is_self contact — if Korakuen paid, a real Korakuen bank account is
-- always involved. The is_self check cannot be expressed as a table-level
-- CHECK (CHECK constraints can't reference other tables), so the rule is
-- enforced in the createPayment server action.
--
-- Reference: conversation 2026-04-13. Off-book partner payments still
-- appear in cash flow, project cost, and settlement reports — they just
-- don't affect per-bank-account balance or show up in the bank
-- reconciliation queue. The existing get_bank_account_balances function
-- already filters on bank_account_id = <id>, so NULL rows are naturally
-- excluded without any change.
--
-- Safety: the database is in Phase 1 pre-launch and payments is still
-- empty; no backfill is required.

ALTER TABLE payments
  ALTER COLUMN bank_account_id DROP NOT NULL;

-- The existing pay_bn_detraction CHECK (is_detraction → currency='PEN')
-- is unaffected; detractions still require a Banco de la Nación account,
-- which is enforced in the createPayment action (is_detraction is derived
-- from bank_account.account_type, so a NULL bank account forces
-- is_detraction = false).
