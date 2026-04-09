-- Migration: loans + loan_schedule
-- Partners borrow externally to fund their share of project costs.
-- Repayments flow through payments + payment_lines with line_type = 4.

CREATE TABLE loans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id),
  borrowing_partner_id  uuid NOT NULL REFERENCES contacts(id),  -- the partner who borrowed
  lender_contact_id     uuid NOT NULL REFERENCES contacts(id),  -- the person who lent
  principal_amount      numeric(15,2) NOT NULL,
  currency              text NOT NULL DEFAULT 'PEN',
  exchange_rate         numeric(10,6),
  principal_amount_pen  numeric(15,2) NOT NULL,
  -- Return terms
  return_rate           numeric(5,4) NOT NULL,               -- minimum 0.10 (10%)
  return_type           text NOT NULL DEFAULT 'percentage',   -- 'percentage' | 'fixed_amount'
  return_amount         numeric(15,2),                        -- only when return_type = 'fixed_amount'
  -- Dates
  disbursement_date     date NOT NULL,
  due_date              date,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT loan_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL),
  CONSTRAINT loan_minimum_return
    CHECK (return_rate >= 0.10),
  CONSTRAINT loan_fixed_amount_required
    CHECK (return_type != 'fixed_amount' OR return_amount IS NOT NULL)
);

CREATE TABLE loan_schedule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id     uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  due_date    date NOT NULL,
  amount_due  numeric(15,2) NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Add FK from payment_lines.loan_id to loans (deferred from payments migration)
ALTER TABLE payment_lines
  ADD CONSTRAINT payment_lines_loan_id_fkey
  FOREIGN KEY (loan_id) REFERENCES loans(id);
