-- Drop payment_lines.line_type — Phase B of the line_type refactor.
--
-- The smallint line_type column was fully redundant with fields already on
-- the line (outgoing_invoice_id / incoming_invoice_id / loan_id /
-- cost_category_id) and the payment header (is_detraction / bank_account_id).
-- Its pl_bank_fee_no_invoice CHECK constraint was also buggy: banks in Peru
-- routinely issue facturas for their commissions, so a bank-fee line
-- legitimately needs to be linkable to an incoming_invoice.
--
-- Classification is now derived at query/render time from the remaining
-- columns:
--   - loan line       → loan_id IS NOT NULL
--   - invoice line    → outgoing_invoice_id OR incoming_invoice_id IS NOT NULL
--   - bank fee        → cost_category_id points under "Comisiones bancarias"
--   - detraction      → captured at the payment header (is_detraction /
--                       bank_account.account_type = banco_de_la_nacion)
--   - general         → no FK set anywhere; needs reconciliation
--
-- Phase A (the non-UI code + docs + tests) landed in commit f6e75f8.
-- Phase C (the 5 UI files that still reference line_type) follows this
-- migration.
--
-- Safety: verified empty payment_lines and payments tables before applying.
-- Submissions carry line_type inside extracted_data JSON; stale keys will
-- simply be ignored on read (type-erased in Phase A) and overwritten on the
-- next edit pass.

BEGIN;

-- Drop the two CHECK constraints that reference line_type before the
-- column itself goes, otherwise the DROP COLUMN would fail.
ALTER TABLE payment_lines
  DROP CONSTRAINT IF EXISTS pl_bank_fee_no_invoice;

ALTER TABLE payment_lines
  DROP CONSTRAINT IF EXISTS pl_loan_type;

-- Drop the single-column index created in 20260409000014_indexes.sql.
DROP INDEX IF EXISTS idx_pl_type;

-- Finally drop the column itself.
ALTER TABLE payment_lines
  DROP COLUMN IF EXISTS line_type;

COMMENT ON TABLE payment_lines IS
  'Detail rows for a payment. Line classification is derived from the FK '
  'columns (outgoing_invoice_id / incoming_invoice_id / loan_id) and the '
  'cost_category_id — never stored. Payment-header flags (is_detraction, '
  'bank_account_id) carry detraction context for the whole payment.';

COMMIT;
