-- Migration: Row Level Security policies
-- Admin (role=1) sees all. Partners (role=2) see only assigned projects and related records.
-- Service role bypasses RLS (used by server actions).

-- ============================================================
-- Helper: check if current user is admin
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role = 1 AND deleted_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: projects the current user is a partner on
CREATE OR REPLACE FUNCTION my_project_ids()
RETURNS SETOF uuid AS $$
  SELECT pp.project_id
  FROM project_partners pp
  JOIN users u ON u.id = auth.uid()
  JOIN contacts c ON c.id = pp.contact_id
  WHERE pp.deleted_at IS NULL
    -- Match partner user to their contact record via email
    AND c.email = u.email;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- Users
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select" ON users
  FOR SELECT USING (auth.uid() = id OR is_admin());

CREATE POLICY "users_admin_all" ON users
  FOR ALL USING (is_admin());

-- ============================================================
-- Exchange Rates (read-only for all authenticated)
-- ============================================================

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exchange_rates_select" ON exchange_rates
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Activity Log (read-only for all authenticated)
-- ============================================================

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_select" ON activity_log
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- ============================================================
-- Contacts (all authenticated can read; admin can mutate)
-- ============================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select" ON contacts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "contacts_admin_all" ON contacts
  FOR ALL USING (is_admin());

-- ============================================================
-- Bank Accounts (all authenticated can read; admin can mutate)
-- ============================================================

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_accounts_select" ON bank_accounts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "bank_accounts_admin_all" ON bank_accounts
  FOR ALL USING (is_admin());

-- ============================================================
-- Cost Categories (all authenticated can read; admin can mutate)
-- ============================================================

ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_categories_select" ON cost_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "cost_categories_admin_all" ON cost_categories
  FOR ALL USING (is_admin());

-- ============================================================
-- Projects (admin: all; partner: assigned projects only)
-- ============================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "projects_admin_all" ON projects
  FOR ALL USING (is_admin());

CREATE POLICY "projects_partner_select" ON projects
  FOR SELECT USING (id IN (SELECT my_project_ids()));

-- ============================================================
-- Project Partners
-- ============================================================

ALTER TABLE project_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_partners_admin_all" ON project_partners
  FOR ALL USING (is_admin());

CREATE POLICY "project_partners_partner_select" ON project_partners
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Outgoing Quotes
-- ============================================================

ALTER TABLE outgoing_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outgoing_quotes_admin_all" ON outgoing_quotes
  FOR ALL USING (is_admin());

CREATE POLICY "outgoing_quotes_partner_select" ON outgoing_quotes
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Outgoing Quote Line Items
-- ============================================================

ALTER TABLE outgoing_quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oqli_admin_all" ON outgoing_quote_line_items
  FOR ALL USING (is_admin());

CREATE POLICY "oqli_partner_select" ON outgoing_quote_line_items
  FOR SELECT USING (
    outgoing_quote_id IN (
      SELECT id FROM outgoing_quotes WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Outgoing Invoices
-- ============================================================

ALTER TABLE outgoing_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "outgoing_invoices_admin_all" ON outgoing_invoices
  FOR ALL USING (is_admin());

CREATE POLICY "outgoing_invoices_partner_select" ON outgoing_invoices
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Outgoing Invoice Line Items
-- ============================================================

ALTER TABLE outgoing_invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oili_admin_all" ON outgoing_invoice_line_items
  FOR ALL USING (is_admin());

CREATE POLICY "oili_partner_select" ON outgoing_invoice_line_items
  FOR SELECT USING (
    outgoing_invoice_id IN (
      SELECT id FROM outgoing_invoices WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Incoming Quotes
-- ============================================================

ALTER TABLE incoming_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incoming_quotes_admin_all" ON incoming_quotes
  FOR ALL USING (is_admin());

CREATE POLICY "incoming_quotes_partner_select" ON incoming_quotes
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Incoming Quote Line Items
-- ============================================================

ALTER TABLE incoming_quote_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iqli_admin_all" ON incoming_quote_line_items
  FOR ALL USING (is_admin());

CREATE POLICY "iqli_partner_select" ON incoming_quote_line_items
  FOR SELECT USING (
    incoming_quote_id IN (
      SELECT id FROM incoming_quotes WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Incoming Invoices
-- ============================================================

ALTER TABLE incoming_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incoming_invoices_admin_all" ON incoming_invoices
  FOR ALL USING (is_admin());

CREATE POLICY "incoming_invoices_partner_select" ON incoming_invoices
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Incoming Invoice Line Items
-- ============================================================

ALTER TABLE incoming_invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iili_admin_all" ON incoming_invoice_line_items
  FOR ALL USING (is_admin());

CREATE POLICY "iili_partner_select" ON incoming_invoice_line_items
  FOR SELECT USING (
    incoming_invoice_id IN (
      SELECT id FROM incoming_invoices WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Payments
-- ============================================================

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_admin_all" ON payments
  FOR ALL USING (is_admin());

CREATE POLICY "payments_partner_select" ON payments
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Payment Lines
-- ============================================================

ALTER TABLE payment_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payment_lines_admin_all" ON payment_lines
  FOR ALL USING (is_admin());

CREATE POLICY "payment_lines_partner_select" ON payment_lines
  FOR SELECT USING (
    payment_id IN (
      SELECT id FROM payments WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Loans
-- ============================================================

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loans_admin_all" ON loans
  FOR ALL USING (is_admin());

CREATE POLICY "loans_partner_select" ON loans
  FOR SELECT USING (project_id IN (SELECT my_project_ids()));

-- ============================================================
-- Loan Schedule
-- ============================================================

ALTER TABLE loan_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loan_schedule_admin_all" ON loan_schedule
  FOR ALL USING (is_admin());

CREATE POLICY "loan_schedule_partner_select" ON loan_schedule
  FOR SELECT USING (
    loan_id IN (
      SELECT id FROM loans WHERE project_id IN (SELECT my_project_ids())
    )
  );

-- ============================================================
-- Submissions (partner sees own; admin sees all)
-- ============================================================

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "submissions_admin_all" ON submissions
  FOR ALL USING (is_admin());

CREATE POLICY "submissions_partner_own" ON submissions
  FOR SELECT USING (submitted_by = auth.uid());

CREATE POLICY "submissions_partner_insert" ON submissions
  FOR INSERT WITH CHECK (submitted_by = auth.uid());
