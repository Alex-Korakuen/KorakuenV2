-- Migration: rename payment notes columns to better-named fields
--
-- The `payments.notes` column was always meant to hold the bank-statement
-- memo / payment title — the UI already labels the input "Título" (texto
-- del estado de cuenta). Keeping the schema column as `notes` was a naming
-- leak that confused the CSV template too (header notes vs line notes).
--
-- Similarly, `payment_lines.notes` is really a per-line description — what
-- this specific slice of the bank transaction represents. Renaming to
-- `description` matches what the UI already stores internally.
--
-- This rename is scoped to the payment-path tables only. Invoices, quotes,
-- contacts, and every other table keep their existing `notes` field
-- (legitimate internal-accounting notes, a different concept).
--
-- Safety: Phase 1, pre-launch, tables may still be empty. The RENAME is
-- metadata-only at the PostgreSQL level — no data is rewritten — so the
-- operation is instant even when rows exist.

ALTER TABLE payments RENAME COLUMN notes TO title;
ALTER TABLE payment_lines RENAME COLUMN notes TO description;
