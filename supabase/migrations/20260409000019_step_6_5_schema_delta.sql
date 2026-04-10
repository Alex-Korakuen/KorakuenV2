-- Migration: Step 6.5 schema delta
-- Lands the April 2026 north-star alignment decisions:
--   - cost_categories gains a parent_id hierarchy
--   - incoming_invoice_line_items gains cost_category_id
--   - incoming_invoices.status renamed to factura_status (new vocabulary)
--   - new ii_received_requires_sunat CHECK constraint
--   - project_budgets table created with activity log trigger
--   - get_incoming_invoice_payment_progress helper function
--
-- Unblocks: Step 9 (Cost Documents), Step 12 (project summary endpoint)
-- Reference: docs/roadmap.md Step 6.5, docs/schema-reference.md

-- ============================================================
-- Safety guard: incoming_invoices must be empty
-- ============================================================
-- The column rename and CHECK constraint addition assume no legacy rows.
-- If rows exist, stop and investigate before proceeding.

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM incoming_invoices) > 0 THEN
    RAISE EXCEPTION 'incoming_invoices has rows; Step 6.5 migration requires empty table. Investigate before re-running.';
  END IF;
END $$;

-- ============================================================
-- cost_categories: add parent_id hierarchy
-- ============================================================
-- Three-level taxonomy support (category → item group → standard reference
-- item). Phase 1 operates at top-level only. Budgets enforce top-level
-- via validator, not DB constraint, so the rule can be relaxed later.

ALTER TABLE cost_categories
  ADD COLUMN parent_id uuid REFERENCES cost_categories(id);

ALTER TABLE cost_categories
  DROP CONSTRAINT cost_categories_name_key;

ALTER TABLE cost_categories
  ADD CONSTRAINT cost_categories_parent_name_key UNIQUE (parent_id, name);

-- ============================================================
-- incoming_invoice_line_items: add cost_category_id
-- ============================================================
-- Nullable — header-only incoming invoices may not have line items at all,
-- and when they do, categorization is optional per line.

ALTER TABLE incoming_invoice_line_items
  ADD COLUMN cost_category_id uuid REFERENCES cost_categories(id);

-- ============================================================
-- incoming_invoices: rename status, add factura_status CHECK
-- ============================================================
-- Old vocabulary: 1=unmatched, 2=partially_matched, 3=matched
-- New vocabulary: 1=expected, 2=received
--
-- SUNAT fields are already nullable in the existing DDL — no DROP NOT NULL
-- statements are needed. Only the new CHECK constraint enforces that
-- received rows have all SUNAT fields populated.

ALTER TABLE incoming_invoices RENAME COLUMN status TO factura_status;
ALTER TABLE incoming_invoices ALTER COLUMN factura_status SET DEFAULT 1;

ALTER TABLE incoming_invoices
  ADD CONSTRAINT ii_received_requires_sunat
  CHECK (
    factura_status = 1 OR (
      serie_numero IS NOT NULL AND
      fecha_emision IS NOT NULL AND
      tipo_documento_code IS NOT NULL AND
      ruc_emisor IS NOT NULL AND
      ruc_receptor IS NOT NULL
    )
  );

-- ============================================================
-- project_budgets: new table
-- ============================================================
-- Per-project cost budget tagged by top-level cost category. Sum of a
-- project's rows is the project's estimated cost. Always PEN — purchases
-- in USD convert at payment time.

CREATE TABLE project_budgets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id),
  cost_category_id      uuid NOT NULL REFERENCES cost_categories(id),
  budgeted_amount_pen   numeric(15,2) NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT pb_project_category_unique UNIQUE (project_id, cost_category_id),
  CONSTRAINT pb_positive CHECK (budgeted_amount_pen >= 0)
);

CREATE INDEX idx_project_budgets_project
  ON project_budgets(project_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- project_budgets: activity log trigger
-- ============================================================
-- Uses the existing log_financial_mutation() function defined in
-- 20260409000015_activity_log_trigger.sql.

CREATE TRIGGER trg_log_project_budgets
  AFTER INSERT OR UPDATE OR DELETE ON project_budgets
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

-- ============================================================
-- project_budgets: RLS policies
-- ============================================================
-- Mirrors the projects RLS pattern: admin sees all, partner sees rows
-- for projects they're assigned to via project_partners.

ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_budgets_admin_all" ON project_budgets
  FOR ALL USING (is_admin());

CREATE POLICY "project_budgets_partner_select" ON project_budgets
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- get_incoming_invoice_payment_progress: SQL helper function
-- ============================================================
-- Canonical formula from docs/schema-reference.md lines 722-738.
-- Used by Step 9 (incoming invoice CRUD) and Step 10 (payment line
-- mutations) to derive payment state without reimplementing the math.

CREATE OR REPLACE FUNCTION get_incoming_invoice_payment_progress(invoice_id uuid)
RETURNS TABLE (
  total_pen      numeric,
  paid           numeric,
  outstanding    numeric,
  payment_state  text
) AS $$
  SELECT
    ii.total_pen,
    COALESCE(SUM(pl.amount_pen), 0)                        AS paid,
    ii.total_pen - COALESCE(SUM(pl.amount_pen), 0)         AS outstanding,
    CASE
      WHEN COALESCE(SUM(pl.amount_pen), 0) = 0            THEN 'unpaid'
      WHEN COALESCE(SUM(pl.amount_pen), 0) < ii.total_pen THEN 'partially_paid'
      ELSE                                                     'paid'
    END                                                     AS payment_state
  FROM incoming_invoices ii
  LEFT JOIN payment_lines pl
    ON pl.incoming_invoice_id = ii.id
  LEFT JOIN payments p
    ON p.id = pl.payment_id AND p.deleted_at IS NULL
  WHERE ii.id = invoice_id
  GROUP BY ii.id, ii.total_pen;
$$ LANGUAGE sql STABLE;
