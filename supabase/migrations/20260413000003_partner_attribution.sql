-- Migration: Partner attribution
--
-- Korakuen is the system's singular "self" (contacts.is_self remains a
-- single-row flag), but two things change to support the settlement model:
--
-- 1. Every payment must declare which of the three consortium partners it
--    is attributed to — the one whose cash went out (outbound) or was
--    collected (inbound). `paid_by_partner_id` was already on the payments
--    table but was nullable and outbound-only. It becomes NOT NULL on both
--    directions. The `pay_direction_partner` CHECK is dropped.
--
-- 2. Quotes and invoices (outgoing and incoming, both sides) get a new
--    nullable `partner_id` FK. NULL means "belongs to Korakuen" — the 99%
--    default. A non-NULL value means "this document is visible in our
--    consortium ledger but it's actually Partner X's, not Korakuen's" —
--    used to exclude the row from Korakuen's own SUNAT/IGV reports while
--    still keeping project-level visibility.
--
-- Reference: memory/project_partner_attribution_model.md (2026-04-13 design
-- decision). Settlement math in app/actions/reports.ts already reads
-- paid_by_partner_id correctly; it just had no real inputs until now.
--
-- Safety: the database is empty (Phase 1, pre-launch). No backfill needed.

-- ============================================================
-- Safety guard: payments must be empty before NOT NULL
-- ============================================================
-- Defensive check. If the migration gets re-run in a non-empty DB by
-- accident, stop early so the operator can investigate.

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM payments) > 0 THEN
    RAISE EXCEPTION 'payments has rows; partner_attribution migration requires empty table. Investigate before re-running.';
  END IF;
END $$;

-- ============================================================
-- payments: required partner attribution on both directions
-- ============================================================

ALTER TABLE payments
  DROP CONSTRAINT pay_direction_partner;

ALTER TABLE payments
  ALTER COLUMN paid_by_partner_id SET NOT NULL;

-- Index: the existing idx_pay_partner (from 20260409000014_indexes.sql) was
-- a partial index on WHERE paid_by_partner_id IS NOT NULL. With the column
-- now NOT NULL, replace it with an unconditional index so the query planner
-- still uses it for settlement-report scans.

DROP INDEX IF EXISTS idx_pay_partner;

CREATE INDEX idx_pay_partner
  ON payments(paid_by_partner_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- outgoing_quotes: optional partner override
-- ============================================================

ALTER TABLE outgoing_quotes
  ADD COLUMN partner_id uuid REFERENCES contacts(id);

CREATE INDEX idx_oq_partner
  ON outgoing_quotes(partner_id)
  WHERE deleted_at IS NULL AND partner_id IS NOT NULL;

-- ============================================================
-- outgoing_invoices: optional partner override
-- ============================================================

ALTER TABLE outgoing_invoices
  ADD COLUMN partner_id uuid REFERENCES contacts(id);

CREATE INDEX idx_oi_partner
  ON outgoing_invoices(partner_id)
  WHERE deleted_at IS NULL AND partner_id IS NOT NULL;

-- ============================================================
-- incoming_quotes: optional partner override
-- ============================================================

ALTER TABLE incoming_quotes
  ADD COLUMN partner_id uuid REFERENCES contacts(id);

CREATE INDEX idx_iq_partner
  ON incoming_quotes(partner_id)
  WHERE deleted_at IS NULL AND partner_id IS NOT NULL;

-- ============================================================
-- incoming_invoices: optional partner override
-- ============================================================

ALTER TABLE incoming_invoices
  ADD COLUMN partner_id uuid REFERENCES contacts(id);

CREATE INDEX idx_ii_partner
  ON incoming_invoices(partner_id)
  WHERE deleted_at IS NULL AND partner_id IS NOT NULL;
