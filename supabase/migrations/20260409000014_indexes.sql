-- Migration: indexes
-- All indexes from schema-reference.md (deduplicated)

-- Projects
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_client ON projects(client_id) WHERE deleted_at IS NULL;

-- Contacts
CREATE INDEX idx_contacts_ruc ON contacts(ruc) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_dni ON contacts(dni) WHERE deleted_at IS NULL;

-- Loans
CREATE INDEX idx_loans_project  ON loans(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_loans_borrower ON loans(borrowing_partner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_loan_schedule  ON loan_schedule(loan_id, due_date);

-- Payments
CREATE INDEX idx_pay_bank_date  ON payments(bank_account_id, payment_date)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_pay_project    ON payments(project_id, direction)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_pay_contact    ON payments(contact_id, direction)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_pay_partner    ON payments(paid_by_partner_id)
  WHERE paid_by_partner_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_pay_reconciled ON payments(reconciled, bank_account_id)
  WHERE deleted_at IS NULL;

-- Payment lines
CREATE INDEX idx_pl_payment          ON payment_lines(payment_id, sort_order);
CREATE INDEX idx_pl_outgoing_invoice ON payment_lines(outgoing_invoice_id)
  WHERE outgoing_invoice_id IS NOT NULL;
CREATE INDEX idx_pl_incoming_invoice ON payment_lines(incoming_invoice_id)
  WHERE incoming_invoice_id IS NOT NULL;
CREATE INDEX idx_pl_loan             ON payment_lines(loan_id)
  WHERE loan_id IS NOT NULL;
CREATE INDEX idx_pl_type             ON payment_lines(line_type);
CREATE INDEX idx_pl_cost_category    ON payment_lines(cost_category_id)
  WHERE cost_category_id IS NOT NULL;

-- Revenue documents
CREATE INDEX idx_oq_project  ON outgoing_quotes(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_oq_winning  ON outgoing_quotes(project_id) WHERE is_winning_quote = true;
CREATE INDEX idx_oi_project  ON outgoing_invoices(project_id, status) WHERE deleted_at IS NULL;

-- Cost documents
CREATE INDEX idx_iq_project  ON incoming_quotes(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_iq_contact  ON incoming_quotes(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_project  ON incoming_invoices(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_contact  ON incoming_invoices(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_category ON incoming_invoices(cost_category_id)
  WHERE cost_category_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_ii_quote    ON incoming_invoices(incoming_quote_id)
  WHERE incoming_quote_id IS NOT NULL AND deleted_at IS NULL;

-- Line items (always fetched ordered by sort_order)
CREATE INDEX idx_oqli ON outgoing_quote_line_items(outgoing_quote_id, sort_order);
CREATE INDEX idx_oili ON outgoing_invoice_line_items(outgoing_invoice_id, sort_order);
CREATE INDEX idx_iqli ON incoming_quote_line_items(incoming_quote_id, sort_order);
CREATE INDEX idx_iili ON incoming_invoice_line_items(incoming_invoice_id, sort_order);

-- Submissions
CREATE INDEX idx_submissions_status ON submissions(review_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_submissions_by     ON submissions(submitted_by, submitted_at DESC)
  WHERE deleted_at IS NULL;

-- Activity log
CREATE INDEX idx_activity_resource ON activity_log(resource_type, resource_id);
CREATE INDEX idx_activity_actor    ON activity_log(actor_user_id, created_at DESC);

-- Exchange rates
CREATE INDEX idx_rates_lookup ON exchange_rates(base_currency, target_currency,
  rate_type, rate_date DESC);
