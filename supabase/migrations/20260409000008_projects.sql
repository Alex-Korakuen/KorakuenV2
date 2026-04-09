-- Migration: projects + project_partners
-- The central organizing entity. Contract terms stored directly on the project (1:1).

CREATE TABLE projects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  code                  text UNIQUE,                        -- internal ref e.g. "PRY001"
  status                smallint NOT NULL DEFAULT 1,        -- 1=prospect, 2=active, 3=completed, 4=archived
  client_id             uuid NOT NULL REFERENCES contacts(id),
  description           text,
  location              text,

  -- Contract terms (populated when the project is won)
  contract_value        numeric(15,2),                      -- total agreed value
  contract_currency     text NOT NULL DEFAULT 'PEN',
  contract_exchange_rate numeric(10,6),                     -- required when currency = 'USD'
  igv_included          boolean NOT NULL DEFAULT true,
  billing_frequency     smallint,                           -- 1=weekly, 2=biweekly, 3=monthly, 4=milestone
  signed_date           date,
  contract_pdf_url      text,

  -- Timeline
  start_date            date,
  expected_end_date     date,
  actual_end_date       date,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT project_contract_currency
    CHECK (contract_currency = 'PEN' OR contract_exchange_rate IS NOT NULL)
);

-- Which companies participate in each project and at what profit split.
CREATE TABLE project_partners (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  company_label     text NOT NULL,                          -- e.g. "Korakuen", "Partner B"
  profit_split_pct  numeric(5,2) NOT NULL,                  -- e.g. 33.33
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,

  UNIQUE (project_id, contact_id),

  CONSTRAINT valid_split_pct
    CHECK (profit_split_pct > 0 AND profit_split_pct <= 100)
);
