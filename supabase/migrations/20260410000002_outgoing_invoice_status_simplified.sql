-- Migration: outgoing invoice status cleanup + outgoing quote number uniqueness
--
-- Part 1: Simplify outgoing_invoices.status to three workflow values only.
-- The old enum mixed workflow state (draft/sent/void) with payment progress
-- (partially_paid/paid). Payment progress is now derived at query time from
-- payment_lines, following the same two-dimensional model applied to
-- incoming_invoices in Step 6.5. The integer values 1 (draft), 2 (sent),
-- and 5 (void) are preserved; values 3 and 4 are retired.
--
-- Both outgoing_invoices and outgoing_quotes are empty in prod, so no data
-- migration is needed.
--
-- Part 2: Add UNIQUE constraint on outgoing_quotes.quote_number. The Step 8
-- quote number generator (COT-YYYY-NNNN) relies on this to detect and retry
-- on accidental collisions. NULLS DISTINCT (the Postgres default) allows
-- multiple historical rows with NULL quote_number.

ALTER TABLE outgoing_invoices
  ADD CONSTRAINT oi_status_valid CHECK (status IN (1, 2, 5));

ALTER TABLE outgoing_quotes
  ADD CONSTRAINT oq_quote_number_unique UNIQUE (quote_number);
