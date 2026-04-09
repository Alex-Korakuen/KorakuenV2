-- Migration: revenue documents
-- outgoing_quotes, outgoing_quote_line_items, outgoing_invoices, outgoing_invoice_line_items

-- ============================================================
-- Outgoing Quotes
-- ============================================================

CREATE TABLE outgoing_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  status            smallint NOT NULL DEFAULT 1,            -- 1=draft, 2=sent, 3=approved, 4=rejected, 5=expired
  quote_number      text,
  issue_date        date NOT NULL,
  valid_until       date,
  is_winning_quote  boolean NOT NULL DEFAULT false,         -- at most one per project (engine-enforced)
  currency          text NOT NULL DEFAULT 'PEN',
  -- Cached sums of outgoing_quote_line_items — never entered manually
  subtotal          numeric(15,2) NOT NULL DEFAULT 0,
  igv_amount        numeric(15,2) NOT NULL DEFAULT 0,
  total             numeric(15,2) NOT NULL DEFAULT 0,
  pdf_url           text,                                   -- Google Drive shareable URL
  drive_file_id     text,                                   -- Google Drive file ID (stable reference)
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  CONSTRAINT oq_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
);

CREATE TABLE outgoing_quote_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_quote_id   uuid NOT NULL REFERENCES outgoing_quotes(id) ON DELETE CASCADE,
  sort_order          smallint NOT NULL DEFAULT 0,
  description         text NOT NULL,
  unit                text,                                 -- "m2", "glb", "und", "hr", etc.
  quantity            numeric(12,4) NOT NULL DEFAULT 1,
  unit_price          numeric(15,2) NOT NULL,
  subtotal            numeric(15,2) NOT NULL,               -- quantity * unit_price
  igv_applies         boolean NOT NULL DEFAULT true,
  igv_amount          numeric(15,2) NOT NULL DEFAULT 0,
  total               numeric(15,2) NOT NULL,               -- subtotal + igv_amount
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oqli_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01),
  CONSTRAINT oqli_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT oqli_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
);

-- ============================================================
-- Outgoing Invoices
-- ============================================================

CREATE TABLE outgoing_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id),
  status                smallint NOT NULL DEFAULT 1,        -- 1=draft, 2=sent, 3=partially_paid, 4=paid, 5=void
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  issue_date            date NOT NULL,
  currency              text NOT NULL DEFAULT 'PEN',
  exchange_rate         numeric(10,6),                      -- required when currency = 'USD'
  -- Cached sums of outgoing_invoice_line_items — never entered manually
  subtotal              numeric(15,2) NOT NULL DEFAULT 0,
  igv_amount            numeric(15,2) NOT NULL DEFAULT 0,
  total                 numeric(15,2) NOT NULL DEFAULT 0,
  total_pen             numeric(15,2) NOT NULL DEFAULT 0,   -- always PEN
  -- Detracciones
  detraction_rate             numeric(5,4),
  detraction_amount           numeric(15,2),                -- always PEN
  detraction_status           smallint NOT NULL DEFAULT 1,  -- 1=not_applicable, 2=pending, 3=received, 4=autodetracted
  detraction_handled_by       smallint,                     -- 1=client_deposited, 2=not_applicable
  detraction_constancia_code  text,
  detraction_constancia_fecha date,
  detraction_constancia_url   text,
  -- SUNAT electronic document fields (extracted from XML at registration)
  serie_numero          text,                               -- e.g. "F001-00000142"
  fecha_emision         date,
  tipo_documento_code   text,                               -- "01"=factura, "03"=boleta
  ruc_emisor            text,                               -- Korakuen's RUC
  ruc_receptor          text,                               -- client's RUC
  hash_cdr              text,
  estado_sunat          text,                               -- 'accepted' | 'rejected' | 'pending'
  pdf_url               text,                               -- Google Drive shareable URL
  xml_url               text,                               -- Google Drive shareable URL
  drive_file_id         text,                               -- Google Drive file ID (stable reference)
  source                smallint NOT NULL DEFAULT 1,        -- 1=manual, 2=scan_app
  submission_id         uuid,                               -- FK added in submissions migration
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT oi_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT oi_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL),
  CONSTRAINT oi_total_pen_check
    CHECK ((currency = 'PEN' AND ABS(total_pen - total) < 0.01)
        OR (currency = 'USD' AND exchange_rate IS NOT NULL)),
  CONSTRAINT oi_detraction_consistency
    CHECK ((detraction_rate IS NULL AND detraction_amount IS NULL)
        OR (detraction_rate IS NOT NULL AND detraction_amount IS NOT NULL))
);

CREATE TABLE outgoing_invoice_line_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_invoice_id   uuid NOT NULL REFERENCES outgoing_invoices(id) ON DELETE CASCADE,
  sort_order            smallint NOT NULL DEFAULT 0,
  description           text NOT NULL,
  unit                  text,
  quantity              numeric(12,4) NOT NULL DEFAULT 1,
  unit_price            numeric(15,2) NOT NULL,
  subtotal              numeric(15,2) NOT NULL,
  igv_applies           boolean NOT NULL DEFAULT true,
  igv_amount            numeric(15,2) NOT NULL DEFAULT 0,
  total                 numeric(15,2) NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oili_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01),
  CONSTRAINT oili_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT oili_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
);
