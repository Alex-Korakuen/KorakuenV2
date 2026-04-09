-- Migration: cost documents
-- incoming_quotes, incoming_quote_line_items, incoming_invoices, incoming_invoice_line_items

-- ============================================================
-- Incoming Quotes
-- ============================================================

CREATE TABLE incoming_quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id),             -- nullable: null = general expense
  contact_id      uuid NOT NULL REFERENCES contacts(id),
  status          smallint NOT NULL DEFAULT 1,               -- 1=draft, 2=approved, 3=cancelled
  description     text NOT NULL,
  reference       text,                                      -- vendor's own quote reference
  currency        text NOT NULL DEFAULT 'PEN',
  exchange_rate   numeric(10,6),
  -- Cached sums of incoming_quote_line_items — never entered manually
  subtotal        numeric(15,2) NOT NULL DEFAULT 0,
  igv_amount      numeric(15,2) NOT NULL DEFAULT 0,
  total           numeric(15,2) NOT NULL DEFAULT 0,
  total_pen       numeric(15,2) NOT NULL DEFAULT 0,
  -- Detracciones (when Korakuen detracts from this vendor)
  detraction_rate   numeric(5,4),
  detraction_amount numeric(15,2),                           -- always PEN
  pdf_url         text,                                      -- Google Drive shareable URL
  drive_file_id   text,                                      -- Google Drive file ID (stable reference)
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT iq_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT iq_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
);

CREATE TABLE incoming_quote_line_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_quote_id   uuid NOT NULL REFERENCES incoming_quotes(id) ON DELETE CASCADE,
  sort_order          smallint NOT NULL DEFAULT 0,
  description         text NOT NULL,
  unit                text,
  quantity            numeric(12,4) NOT NULL DEFAULT 1,
  unit_price          numeric(15,2) NOT NULL,
  subtotal            numeric(15,2) NOT NULL,
  igv_applies         boolean NOT NULL DEFAULT true,
  igv_amount          numeric(15,2) NOT NULL DEFAULT 0,
  total               numeric(15,2) NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT iqli_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01),
  CONSTRAINT iqli_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT iqli_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
);

-- ============================================================
-- Incoming Invoices
-- ============================================================

CREATE TABLE incoming_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid REFERENCES projects(id),       -- nullable
  contact_id            uuid NOT NULL REFERENCES contacts(id),
  incoming_quote_id     uuid REFERENCES incoming_quotes(id), -- nullable
  cost_category_id      uuid REFERENCES cost_categories(id), -- nullable, for filtering/reference
  status                smallint NOT NULL DEFAULT 1,         -- 1=unmatched, 2=partially_matched, 3=matched
  factura_number        text,                                -- vendor's own invoice number
  currency              text NOT NULL DEFAULT 'PEN',
  exchange_rate         numeric(10,6),
  -- Totals: entered directly from SUNAT document (header-only) OR derived from line items
  subtotal              numeric(15,2) NOT NULL,
  igv_amount            numeric(15,2) NOT NULL,
  total                 numeric(15,2) NOT NULL,
  total_pen             numeric(15,2) NOT NULL,
  -- Detracciones
  detraction_rate             numeric(5,4),
  detraction_amount           numeric(15,2),                 -- always PEN
  detraction_handled_by       smallint,                      -- 1=self, 2=vendor_handled, 3=not_applicable
  detraction_constancia_code        text,
  detraction_constancia_fecha       date,
  detraction_constancia_url         text,
  detraction_constancia_xml_url     text,
  -- SUNAT electronic document fields (extracted from XML)
  serie_numero          text,
  fecha_emision         date,
  tipo_documento_code   text,
  ruc_emisor            text,                                -- vendor RUC (validated vs contact.ruc)
  ruc_receptor          text,                                -- Korakuen's RUC
  hash_cdr              text,
  estado_sunat          text,
  pdf_url               text,                                -- Google Drive shareable URL
  xml_url               text,                                -- Google Drive shareable URL
  drive_file_id         text,                                -- Google Drive file ID (stable reference)
  source                smallint NOT NULL DEFAULT 1,         -- 1=manual, 2=scan_app
  submission_id         uuid,                                -- FK added in submissions migration
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT ii_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT ii_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL),
  CONSTRAINT ii_ruc_format
    CHECK (ruc_emisor IS NULL OR length(ruc_emisor) = 11)
);

CREATE TABLE incoming_invoice_line_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_invoice_id   uuid NOT NULL REFERENCES incoming_invoices(id) ON DELETE CASCADE,
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

  CONSTRAINT iili_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01),
  CONSTRAINT iili_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01),
  CONSTRAINT iili_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
);
