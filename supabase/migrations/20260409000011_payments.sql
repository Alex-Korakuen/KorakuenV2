-- Migration: payments + payment_lines
-- One payment = one bank statement entry. Payment lines say what the money was for.
-- Note: payment_lines.loan_id column is created here but FK is added in loans migration.

-- ============================================================
-- Payments (header)
-- ============================================================

CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction             smallint NOT NULL,                   -- 1=inbound, 2=outbound
  bank_account_id       uuid NOT NULL REFERENCES bank_accounts(id),
  project_id            uuid REFERENCES projects(id),        -- nullable: null = general expense
  contact_id            uuid REFERENCES contacts(id),        -- who paid us or who we paid (nullable)
  -- Partner tracking (outbound only)
  paid_by_partner_id    uuid REFERENCES contacts(id),
  -- Amounts (cached sum of payment_lines.amount — never entered manually)
  total_amount          numeric(15,2) NOT NULL DEFAULT 0,
  currency              text NOT NULL DEFAULT 'PEN',
  exchange_rate         numeric(10,6),                       -- required when currency = 'USD'
  total_amount_pen      numeric(15,2) NOT NULL DEFAULT 0,
  -- Detraction flag (true when this payment goes to/from Banco de la Nacion)
  is_detraction         boolean NOT NULL DEFAULT false,
  -- Reconciliation
  reconciled            boolean NOT NULL DEFAULT false,
  bank_reference        text,                                -- bank's own reference number
  reconciled_at         timestamptz,
  reconciled_by         uuid REFERENCES users(id),
  -- Source tracking
  source                smallint NOT NULL DEFAULT 1,         -- 1=manual, 2=scan_app
  submission_id         uuid,                                -- FK added in submissions migration
  drive_file_id         text,                                -- Google Drive file ID for payment receipt
  payment_date          date NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT pay_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL),
  CONSTRAINT pay_direction_partner
    CHECK (paid_by_partner_id IS NULL OR direction = 2),
  CONSTRAINT pay_bn_detraction
    CHECK (NOT is_detraction OR currency = 'PEN')
);

-- ============================================================
-- Payment Lines (detail)
-- ============================================================

CREATE TABLE payment_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  sort_order            smallint NOT NULL DEFAULT 0,
  amount                numeric(15,2) NOT NULL,
  amount_pen            numeric(15,2) NOT NULL,
  -- What this line settles (all nullable — only one should be set)
  outgoing_invoice_id   uuid REFERENCES outgoing_invoices(id),
  incoming_invoice_id   uuid REFERENCES incoming_invoices(id),
  loan_id               uuid,                                -- FK added in loans migration
  -- Cost categorization (for reporting — nullable, outbound lines only)
  cost_category_id      uuid REFERENCES cost_categories(id),
  -- Line classification
  line_type             smallint NOT NULL DEFAULT 1,
    -- 1=invoice, 2=bank_fee, 3=detraction, 4=loan, 5=general
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pl_positive
    CHECK (amount > 0),
  CONSTRAINT pl_invoice_exclusive
    CHECK (
      (outgoing_invoice_id IS NOT NULL)::int +
      (incoming_invoice_id IS NOT NULL)::int +
      (loan_id IS NOT NULL)::int <= 1
    ),
  CONSTRAINT pl_bank_fee_no_invoice
    CHECK (line_type != 2 OR (
      outgoing_invoice_id IS NULL AND
      incoming_invoice_id IS NULL AND
      loan_id IS NULL
    )),
  CONSTRAINT pl_loan_type
    CHECK (line_type != 4 OR loan_id IS NOT NULL)
);
