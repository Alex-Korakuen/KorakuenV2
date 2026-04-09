-- Migration: activity_log trigger
-- Automatically logs every mutation to financial tables.
-- Uses auth.uid() for actor — falls back to NULL if not in a Supabase Auth context.

CREATE OR REPLACE FUNCTION log_financial_mutation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_log (resource_type, resource_id, action, actor_user_id,
                             before_state, after_state)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE TG_OP
      WHEN 'INSERT' THEN 1   -- created
      WHEN 'UPDATE' THEN 2   -- updated
      WHEN 'DELETE' THEN 5   -- deleted
    END,
    COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to all financial tables
CREATE TRIGGER trg_log_contacts
  AFTER INSERT OR UPDATE OR DELETE ON contacts
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_bank_accounts
  AFTER INSERT OR UPDATE OR DELETE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_projects
  AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_project_partners
  AFTER INSERT OR UPDATE OR DELETE ON project_partners
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_outgoing_quotes
  AFTER INSERT OR UPDATE OR DELETE ON outgoing_quotes
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_outgoing_invoices
  AFTER INSERT OR UPDATE OR DELETE ON outgoing_invoices
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_incoming_quotes
  AFTER INSERT OR UPDATE OR DELETE ON incoming_quotes
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_incoming_invoices
  AFTER INSERT OR UPDATE OR DELETE ON incoming_invoices
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_payment_lines
  AFTER INSERT OR UPDATE OR DELETE ON payment_lines
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_loans
  AFTER INSERT OR UPDATE OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

CREATE TRIGGER trg_log_loan_schedule
  AFTER INSERT OR UPDATE OR DELETE ON loan_schedule
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();
