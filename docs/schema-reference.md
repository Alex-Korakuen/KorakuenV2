# Korakuen — Schema Reference

> Single source of truth for all database tables, columns, types, and constraints.
> Read `domain-model.md` first to understand what each entity represents before
> reading its schema definition here.
>
> Related: `domain-model.md` · `api-design-principles.md`

> **⚠ Pending migration — target state documented here.** The following decisions
> have been made but not yet applied to the database. See `TODO.md` for the
> execution checklist. Until the migration lands, the live database does not
> match this document for: `incoming_invoices.factura_status` (renamed from
> `status`, new two-value enum), nullable SUNAT fields on `incoming_invoices`,
> `cost_categories.parent_id`, `incoming_invoice_line_items.cost_category_id`,
> `projects.status = 5 (rejected)`, and the new `project_budgets` table.

---

## Schema Conventions

These rules apply to all tables unless explicitly noted as an exception.

- **Monetary amounts:** `numeric(15,2)` — never floating point. Peruvian construction
  amounts routinely have decimal places.
- **Soft deletes:** All mutable tables carry `deleted_at` (nullable timestamptz).
  `NULL` = active. Timestamp = soft-deleted. Hard deletion is never performed on
  financial records.
- **UUIDs:** All primary keys are `uuid`, default `gen_random_uuid()`, generated
  server-side on insert.
- **Timestamps:** `created_at` and `updated_at` on every mutable table, both
  `timestamptz`, default `now()`. Always stored in UTC.
- **snake_case:** All table and column names.
- **Smallint enums:** Enum-like fields stored as `smallint`. Mappings in the table
  below. Never raw strings for status fields.
- **No stored derived values:** Balances, outstanding amounts, and totals derivable
  from payment records are not stored. Computed by the engine at query time and returned
  in API responses under `_computed`.
- **Exception — header totals:** `subtotal`, `igv_amount`, and `total` on document
  headers (`outgoing_quotes`, `outgoing_invoices`, `incoming_quotes`,
  `incoming_invoices`) are cached sums of their line items. Recomputed atomically by
  the engine on every line item mutation. Never entered manually.
- **Exception — line item tables:** `*_line_items` and `payment_lines` tables do not
  carry `deleted_at`. Hard-deleted when removed. Line items on non-draft documents are
  immutable — engine blocks all mutations with `409 CONFLICT`. Payment lines on
  reconciled payments are immutable.

### Smallint Enum Mappings

| Field | Table | Mapping |
|---|---|---|
| `role` | `users` | 1=admin, 2=partner |
| `status` | `projects` | 1=prospect, 2=active, 3=completed, 4=archived, 5=rejected |
| `billing_frequency` | `projects` | 1=weekly, 2=biweekly, 3=monthly, 4=milestone |
| `status` | `outgoing_quotes` | 1=draft, 2=sent, 3=approved, 4=rejected, 5=expired |
| `status` | `outgoing_invoices` | 1=draft, 2=sent, 3=partially_paid, 4=paid, 5=void |
| `detraction_status` | `outgoing_invoices` | 1=not_applicable, 2=pending, 3=received, 4=autodetracted |
| `detraction_handled_by` | `outgoing_invoices` | 1=client_deposited, 2=not_applicable |
| `status` | `incoming_quotes` | 1=draft, 2=approved, 3=cancelled |
| `factura_status` | `incoming_invoices` | 1=expected, 2=received |
| `detraction_handled_by` | `incoming_invoices` | 1=self, 2=vendor_handled, 3=not_applicable |
| `direction` | `payments` | 1=inbound, 2=outbound |
| `payment_line_type` | `payment_lines` | 1=invoice, 2=bank_fee, 3=detraction, 4=loan, 5=general |
| `account_type` | `bank_accounts` | 1=regular, 2=banco_de_la_nacion |
| `tipo_persona` | `contacts` | 1=natural, 2=juridica |
| `action` | `activity_log` | 1=created, 2=updated, 3=approved, 4=voided, 5=deleted, 6=restored, 7=matched |
| `source` | `payments`, `outgoing_invoices`, `incoming_invoices` | 1=manual, 2=scan_app |
| `review_status` | `submissions` | 1=pending, 2=approved, 3=rejected |
| `source_type` | `submissions` | 1=incoming_invoice, 2=outgoing_invoice, 3=payment |

### Exceptions (no deleted_at / no updated_at)

- `activity_log` — immutable append-only. No soft delete, no updated_at.
- `exchange_rates` — append-only reference table. Never edited or deleted.
- `payment_lines` — no soft delete. Hard-deleted when removed. Immutable on
  reconciled payments.

---

## Infrastructure Tables

### `users`

Supabase Auth mirror. One row per authenticated user.

```sql
users
  id              uuid PRIMARY KEY                    -- mirrors auth.users.id
  email           text NOT NULL
  display_name    text
  role            smallint NOT NULL DEFAULT 2         -- 1=admin, 2=partner
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()
  deleted_at      timestamptz
```

### `exchange_rates`

Append-only. Populated by the daily Vercel Cron job at
`/api/cron/fetch-exchange-rates`, which fetches from the BCRP statistics API
and stores three rows per weekday: compra, venta, promedio. Never edited or
deleted by clients.

```sql
exchange_rates
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
  base_currency   text NOT NULL DEFAULT 'USD'
  target_currency text NOT NULL DEFAULT 'PEN'
  rate_type       text NOT NULL                       -- 'compra' | 'venta' | 'promedio' | 'manual'
  rate            numeric(10,6) NOT NULL              -- units of target per 1 base (e.g. 3.745600)
  rate_date       date NOT NULL
  source          text NOT NULL DEFAULT 'sunat'       -- 'sunat' | 'manual'
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()

  UNIQUE (base_currency, target_currency, rate_type, rate_date)
```

**Default rate:** `rate_type = 'promedio'` is used throughout the system.

**Fallback rule:** If no rate exists for a given date:
```sql
WHERE base_currency = 'USD' AND target_currency = 'PEN'
  AND rate_type = 'promedio' AND rate_date <= :target_date
ORDER BY rate_date DESC LIMIT 1
```

Weekend gaps are handled naturally by this fallback — Friday's rate covers Saturday
and Sunday transactions.

### `activity_log`

Immutable audit trail. Append-only. Never updated or deleted.

```sql
activity_log
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
  resource_type   text NOT NULL                       -- e.g. 'outgoing_invoice'
  resource_id     uuid NOT NULL
  action          smallint NOT NULL
  actor_user_id   uuid NOT NULL REFERENCES users(id)
  before_state    jsonb
  after_state     jsonb
  notes           text
  created_at      timestamptz NOT NULL DEFAULT now()
```

---

## Core Domain Tables

### `contacts`

Everyone Korakuen transacts with: clients, vendors, partner companies.

**All contacts must be verified against SUNAT (RUC) or RENIEC (DNI) before creation.**
There is no manual entry path. The engine calls the decolecta API on `POST /contacts`
and rejects any identifier not found in the official registry. Core SUNAT fields are
populated by the engine and are immutable after creation.

```sql
contacts
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  tipo_persona      smallint NOT NULL                 -- 1=natural, 2=juridica
  ruc               text UNIQUE                       -- 11 digits (juridica) or 8 (natural w/ RUC)
  dni               text UNIQUE                       -- 8 digits (natural without RUC)
  razon_social      text NOT NULL                     -- legal name or full personal name
  nombre_comercial  text                              -- trading name (user-entered, editable)
  is_client         boolean NOT NULL DEFAULT false
  is_vendor         boolean NOT NULL DEFAULT false
  is_partner        boolean NOT NULL DEFAULT false
  email             text
  phone             text
  address           text
  -- SUNAT/RENIEC fields — populated by engine, immutable after creation
  sunat_estado      text                              -- 'ACTIVO' | 'BAJA DE OFICIO' | etc.
  sunat_condicion   text                              -- 'HABIDO' | 'NO HABIDO' | etc.
  sunat_verified    boolean NOT NULL DEFAULT false
  sunat_verified_at timestamptz NOT NULL
  notes             text
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()
  deleted_at        timestamptz

  CONSTRAINT contact_has_identifier
    CHECK (ruc IS NOT NULL OR dni IS NOT NULL)

  CONSTRAINT contact_must_be_verified
    CHECK (sunat_verified = true)
```

**Editable after creation:** `nombre_comercial`, `email`, `phone`, `address`,
`is_client`, `is_vendor`, `is_partner`, `notes`.

### `bank_accounts`

Korakuen's own bank accounts. Every payment must reference one.
Balance is always derived — never stored.

```sql
bank_accounts
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
  name            text NOT NULL                       -- e.g. "BCP Cuenta Corriente PEN"
  bank_name       text NOT NULL
  account_number  text                                -- masked, e.g. "****3421"
  currency        text NOT NULL                       -- 'PEN' | 'USD'
  account_type    smallint NOT NULL DEFAULT 1         -- 1=regular, 2=banco_de_la_nacion
  is_active       boolean NOT NULL DEFAULT true
  notes           text
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()
  deleted_at      timestamptz

  CONSTRAINT bn_always_pen
    CHECK (account_type != 2 OR currency = 'PEN')
```

**Balance derivation:**
```sql
SELECT COALESCE(SUM(
  CASE WHEN direction = 1 THEN amount_pen ELSE -amount_pen END
), 0) AS balance_pen
FROM payments
WHERE bank_account_id = :id AND deleted_at IS NULL
```

---

## Project Tables

### `projects`

The central organizing entity. Everything links to a project. Contract terms are
stored directly on the project — they are always 1:1 and there is no scenario where
one exists without the other.

```sql
projects
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  name              text NOT NULL
  code              text UNIQUE                       -- internal ref e.g. "PRY001"
  status            smallint NOT NULL DEFAULT 1
  client_id         uuid NOT NULL REFERENCES contacts(id)
  description       text
  location          text

  -- Contract terms (populated when the project is won)
  contract_value        numeric(15,2)                -- total agreed value
  contract_currency     text NOT NULL DEFAULT 'PEN'
  contract_exchange_rate numeric(10,6)               -- required when currency = 'USD'
  igv_included          boolean NOT NULL DEFAULT true
  billing_frequency     smallint                     -- see enum mapping
  signed_date           date
  contract_pdf_url      text

  -- Timeline
  start_date        date
  expected_end_date date
  actual_end_date   date

  notes             text
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()
  deleted_at        timestamptz

  CONSTRAINT project_contract_currency
    CHECK (contract_currency = 'PEN' OR contract_exchange_rate IS NOT NULL)
```

**Contract fields are nullable** — a project can exist in `prospect` status before
a contract is signed. The engine validates that all contract fields are populated
before allowing the project to transition to `active`.

**`rejected` status** — for prospects that never converted (lost bids, dead leads)
or active projects that were cancelled. Terminal state. Separate from `archived`,
which is for completed projects moved out of active views for tidiness. Both are
filtered out of the default project list.

**Estimated cost is not a column on this table.** A project's estimated cost is
the sum of its `project_budgets` rows (see below). Totals are never stored.

### `project_partners`

Which companies participate in each project and at what profit split.

```sql
project_partners
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id        uuid NOT NULL REFERENCES projects(id)
  contact_id        uuid NOT NULL REFERENCES contacts(id)
  company_label     text NOT NULL                     -- e.g. "Korakuen", "Partner B"
  profit_split_pct  numeric(5,2) NOT NULL             -- e.g. 33.33
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()
  deleted_at        timestamptz

  UNIQUE (project_id, contact_id)

  CONSTRAINT valid_split_pct
    CHECK (profit_split_pct > 0 AND profit_split_pct <= 100)
```

**Engine rule:** `SUM(profit_split_pct)` across all active partners on a project
must equal 100.00 (±0.01) before the project can be activated.

---

## Reference Tables

### `cost_categories`

Admin-managed list of cost categories. Used to tag incoming invoices and payment
lines for cost breakdown reporting. Reporting is always done at the payment line
level — the invoice tag is for reference and filtering only.

Seed data:
```
Materiales
Mano de Obra
Alquiler de Equipos
Viáticos
```

```sql
cost_categories
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
  parent_id   uuid REFERENCES cost_categories(id)   -- NULL = top-level category
  name        text NOT NULL
  description text
  is_active   boolean NOT NULL DEFAULT true
  sort_order  smallint NOT NULL DEFAULT 0
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()

  UNIQUE (parent_id, name)                          -- unique within a parent branch
```

**Hierarchy:** The `parent_id` self-reference supports a three-level taxonomy that
will back the future Price Sentinel: Category (top, e.g. "Materiales") → Item
Group (e.g. "Cemento") → Standard Reference Item (e.g. "Cemento Portland 42.5kg").
Phase 1 operates at the top level only; the deeper levels are seeded later from
historical presupuestos. The column exists now at zero cost to avoid a retroactive
reclassification of thousands of records later.

**Budgeting rule:** `project_budgets` rows may only reference top-level categories
(rows where `parent_id IS NULL`). Enforced in `lib/validators/project-budgets.ts`,
not as a DB constraint, so the rule can be relaxed later without a migration.

Categories are never deleted — set `is_active = false` to retire one. This preserves
historical records that reference it.

### `project_budgets`

Per-project cost budget, tagged by top-level cost category. The sum of a project's
budget rows is the project's estimated cost. Never stored as a column on `projects`.

```sql
project_budgets
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id            uuid NOT NULL REFERENCES projects(id)
  cost_category_id      uuid NOT NULL REFERENCES cost_categories(id)
  budgeted_amount_pen   numeric(15,2) NOT NULL     -- always PEN, the reporting currency
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()
  deleted_at            timestamptz

  UNIQUE (project_id, cost_category_id)

  CONSTRAINT pb_positive
    CHECK (budgeted_amount_pen >= 0)
```

**Always PEN.** Budgets are internal planning. Purchases in USD convert to PEN at
payment time (using the exchange rate stamped on each payment) and show up against
the PEN budget naturally. Making budgets multi-currency would mean re-doing the
conversion at budget-entry time with no upside.

**Top-level only.** Validator enforces that the referenced `cost_category_id` has
`parent_id IS NULL`. Sub-category budgets and leaf-level (partida) budgets are
explicitly out of scope — the latter is a future feature (per-partida tracking),
tracked in `north-star.md` under "What's explicitly NOT in scope."

**Mutation rules.** Budgets are editable while a project is in `prospect` or
`active` status — planning during prospect, mid-project corrections during
active. Once a project reaches `completed`, `archived`, or `rejected`, budget
rows become immutable. Changing a budget after the project is frozen would
silently shift the historical "expected margin" figure the project summary
endpoint derives, so the engine blocks all mutations with `409 CONFLICT` at
those stages.

**Total estimated cost for a project:**
```sql
SELECT COALESCE(SUM(budgeted_amount_pen), 0) AS estimated_cost_pen
FROM project_budgets
WHERE project_id = :project_id AND deleted_at IS NULL
```

---

## Revenue Document Tables

### `outgoing_quotes`

Formal proposals sent to prospective clients.

**Lifecycle:** `draft → sent → approved | rejected | expired`

```sql
outgoing_quotes
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id        uuid NOT NULL REFERENCES projects(id)
  contact_id        uuid NOT NULL REFERENCES contacts(id)
  status            smallint NOT NULL DEFAULT 1
  quote_number      text
  issue_date        date NOT NULL
  valid_until       date
  is_winning_quote  boolean NOT NULL DEFAULT false    -- the quote this project is based on
                                                      -- at most one per project (engine-enforced)
  currency          text NOT NULL DEFAULT 'PEN'
  -- Cached sums of outgoing_quote_line_items — never entered manually
  subtotal          numeric(15,2) NOT NULL DEFAULT 0
  igv_amount        numeric(15,2) NOT NULL DEFAULT 0
  total             numeric(15,2) NOT NULL DEFAULT 0
  pdf_url           text                              -- Google Drive shareable URL
  drive_file_id     text                              -- Google Drive file ID (stable reference)
  notes             text
  created_at        timestamptz NOT NULL DEFAULT now()
  updated_at        timestamptz NOT NULL DEFAULT now()
  deleted_at        timestamptz

  CONSTRAINT oq_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
```

**`is_winning_quote` rule:** At most one quote per project can be flagged as winning.
When set to `true`, the engine automatically unsets any other winning quote on the same
project. A quote does not need to be `approved` to be flagged as winning — these are
independent concepts (approved = client accepted it, winning = this is what the project
is based on).

### `outgoing_quote_line_items`

Source of truth for outgoing quote totals.

```sql
outgoing_quote_line_items
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
  outgoing_quote_id   uuid NOT NULL REFERENCES outgoing_quotes(id) ON DELETE CASCADE
  sort_order          smallint NOT NULL DEFAULT 0
  description         text NOT NULL
  unit                text                            -- "m²", "glb", "und", "hr", etc.
  quantity            numeric(12,4) NOT NULL DEFAULT 1
  unit_price          numeric(15,2) NOT NULL
  subtotal            numeric(15,2) NOT NULL          -- quantity × unit_price
  igv_applies         boolean NOT NULL DEFAULT true
  igv_amount          numeric(15,2) NOT NULL DEFAULT 0
  total               numeric(15,2) NOT NULL          -- subtotal + igv_amount
  notes               text
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()

  CONSTRAINT oqli_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01)
  CONSTRAINT oqli_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT oqli_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
```

**Immutability:** Locked when quote `status != 1`. Returns `409 CONFLICT`.
**Header recomputation:** Engine atomically updates `outgoing_quotes` totals after
every line item mutation.

### `outgoing_invoices`

Periodic facturas sent to clients. One per billing period.

**Lifecycle:** `draft → sent → partially_paid → paid | void`

```sql
outgoing_invoices
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id          uuid NOT NULL REFERENCES projects(id)
  status              smallint NOT NULL DEFAULT 1
  period_start        date NOT NULL
  period_end          date NOT NULL
  issue_date          date NOT NULL
  currency            text NOT NULL DEFAULT 'PEN'
  exchange_rate       numeric(10,6)                   -- required when currency = 'USD'
  -- Cached sums of outgoing_invoice_line_items — never entered manually
  subtotal            numeric(15,2) NOT NULL DEFAULT 0
  igv_amount          numeric(15,2) NOT NULL DEFAULT 0
  total               numeric(15,2) NOT NULL DEFAULT 0
  total_pen           numeric(15,2) NOT NULL DEFAULT 0  -- always PEN
  -- Detracciones
  detraction_rate           numeric(5,4)
  detraction_amount         numeric(15,2)             -- always PEN
  detraction_status         smallint NOT NULL DEFAULT 1
  detraction_handled_by     smallint
  detraction_constancia_code  text
  detraction_constancia_fecha date
  detraction_constancia_url   text
  -- SUNAT electronic document fields (extracted from XML at registration)
  serie_numero        text                            -- e.g. "F001-00000142"
  fecha_emision       date
  tipo_documento_code text                            -- "01"=factura, "03"=boleta
  ruc_emisor          text                            -- Korakuen's RUC
  ruc_receptor        text                            -- client's RUC
  hash_cdr            text
  estado_sunat        text                            -- 'accepted' | 'rejected' | 'pending'
  pdf_url             text                            -- Google Drive shareable URL
  xml_url             text                            -- Google Drive shareable URL
  drive_file_id       text                            -- Google Drive file ID (stable reference)
  source              smallint NOT NULL DEFAULT 1
  submission_id       uuid
  notes               text
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()
  deleted_at          timestamptz

  CONSTRAINT oi_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT oi_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
  CONSTRAINT oi_total_pen_check
    CHECK ((currency = 'PEN' AND ABS(total_pen - total) < 0.01)
        OR (currency = 'USD' AND exchange_rate IS NOT NULL))
  CONSTRAINT oi_detraction_consistency
    CHECK ((detraction_rate IS NULL AND detraction_amount IS NULL)
        OR (detraction_rate IS NOT NULL AND detraction_amount IS NOT NULL))
```

**Status is updated automatically** by the engine when allocations change:
`partially_paid` when some payments are allocated, `paid` when `total_pen` is covered.

### `outgoing_invoice_line_items`

Source of truth for outgoing invoice totals.

```sql
outgoing_invoice_line_items
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  outgoing_invoice_id   uuid NOT NULL REFERENCES outgoing_invoices(id) ON DELETE CASCADE
  sort_order            smallint NOT NULL DEFAULT 0
  description           text NOT NULL
  unit                  text
  quantity              numeric(12,4) NOT NULL DEFAULT 1
  unit_price            numeric(15,2) NOT NULL
  subtotal              numeric(15,2) NOT NULL
  igv_applies           boolean NOT NULL DEFAULT true
  igv_amount            numeric(15,2) NOT NULL DEFAULT 0
  total                 numeric(15,2) NOT NULL
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()

  CONSTRAINT oili_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01)
  CONSTRAINT oili_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT oili_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
```

**Immutability:** Locked when invoice `status != 1`. Corrections require void + reissue.
**Header recomputation:** Engine updates `outgoing_invoices` totals (incl. `total_pen`)
after every mutation.

---

## Cost Document Tables

### `incoming_quotes`

Vendor quotes received by Korakuen. Optional — some payments happen with no prior quote.

**Lifecycle:** `draft → approved | cancelled`

```sql
incoming_quotes
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id      uuid REFERENCES projects(id)        -- nullable: null = general expense
  contact_id      uuid NOT NULL REFERENCES contacts(id)
  status          smallint NOT NULL DEFAULT 1
  description     text NOT NULL
  reference       text                                -- vendor's own quote reference
  currency        text NOT NULL DEFAULT 'PEN'
  exchange_rate   numeric(10,6)
  -- Cached sums of incoming_quote_line_items — never entered manually
  subtotal        numeric(15,2) NOT NULL DEFAULT 0
  igv_amount      numeric(15,2) NOT NULL DEFAULT 0
  total           numeric(15,2) NOT NULL DEFAULT 0
  total_pen       numeric(15,2) NOT NULL DEFAULT 0
  -- Detracciones (when Korakuen detracts from this vendor)
  detraction_rate   numeric(5,4)
  detraction_amount numeric(15,2)                    -- always PEN
  pdf_url         text                                -- Google Drive shareable URL
  drive_file_id   text                                -- Google Drive file ID (stable reference)
  notes           text
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()
  deleted_at      timestamptz

  CONSTRAINT iq_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT iq_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
```

### `incoming_quote_line_items`

Source of truth for incoming quote totals.

```sql
incoming_quote_line_items
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
  incoming_quote_id   uuid NOT NULL REFERENCES incoming_quotes(id) ON DELETE CASCADE
  sort_order          smallint NOT NULL DEFAULT 0
  description         text NOT NULL
  unit                text
  quantity            numeric(12,4) NOT NULL DEFAULT 1
  unit_price          numeric(15,2) NOT NULL
  subtotal            numeric(15,2) NOT NULL
  igv_applies         boolean NOT NULL DEFAULT true
  igv_amount          numeric(15,2) NOT NULL DEFAULT 0
  total               numeric(15,2) NOT NULL
  notes               text
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()

  CONSTRAINT iqli_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01)
  CONSTRAINT iqli_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT iqli_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
```

**Immutability:** Locked when quote `status = 2` (approved).
**Header recomputation:** Engine updates `incoming_quotes` totals after every mutation.

### `incoming_invoices`

Facturas received from vendors — plus invoices we know are coming but don't have
the paperwork for yet. In Korakuen's workflow the paper trail and the money movement
happen in any order: sometimes the factura arrives first, sometimes the payment,
sometimes the vendor just announces "I'll bill you next week." This table models
all of them without record duplication.

**Two independent dimensions:**

1. **Factura state** — does the SUNAT paperwork physically exist?
   - `factura_status = 1 (expected)` — we know the obligation exists (from a quote,
     a payment already made, or a vendor's pre-announcement) but no factura is in hand.
     SUNAT fields are NULL.
   - `factura_status = 2 (received)` — the factura is registered. SUNAT fields populated.
2. **Payment progress** — how much of this invoice has been paid? **Never stored.**
   Derived at query time from the sum of `payment_lines.amount_pen` where
   `incoming_invoice_id = this.id`. Returned under `_computed` in API responses
   as `paid`, `outstanding`, and a convenience state (`unpaid | partially_paid | paid`).

**Lifecycle:** `expected → received`. One-way transition. Enforced in
`lib/lifecycle.ts`. When transitioning to `received`, the engine requires all SUNAT
fields to be populated.

**Three entry paths create an `expected` row:**
1. **From an approved incoming quote** — one-click "Track as expected invoice." The
   expected row carries over vendor, project, amount, and line items from the quote.
2. **From a payment that has no factura linked** — payment form prompts "No factura
   yet — create an expected invoice to track it?" Pre-fills vendor, amount, project.
3. **Manually** — "New Incoming Invoice" form with an "Expected" toggle that hides
   the SUNAT fields.

**The four real-world flows this supports (from `north-star.md` problem #5):**
- **Quote-first:** quote approved → expected invoice → payment → factura arrives → received
- **Payment-first:** payment recorded → expected invoice auto-prompted → factura arrives → received
- **Invoice-first:** factura arrives → received invoice created → payment later
- **Announcement-first:** vendor says "bill coming" → expected invoice created manually → payment → factura → received

```sql
incoming_invoices
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id          uuid REFERENCES projects(id)    -- nullable
  contact_id          uuid NOT NULL REFERENCES contacts(id)
  incoming_quote_id   uuid REFERENCES incoming_quotes(id)  -- nullable
  cost_category_id    uuid REFERENCES cost_categories(id)  -- header-level, nullable
  factura_status      smallint NOT NULL DEFAULT 1     -- 1=expected, 2=received
  factura_number      text                            -- vendor's own invoice number, nullable while expected
  currency            text NOT NULL DEFAULT 'PEN'
  exchange_rate       numeric(10,6)
  -- Amounts: required always. For expected rows, these are the best estimate we have.
  -- For received rows, these come from the SUNAT document.
  subtotal            numeric(15,2) NOT NULL
  igv_amount          numeric(15,2) NOT NULL
  total               numeric(15,2) NOT NULL
  total_pen           numeric(15,2) NOT NULL
  -- Detracciones
  detraction_rate           numeric(5,4)
  detraction_amount         numeric(15,2)             -- always PEN
  detraction_handled_by     smallint                  -- 1=self, 2=vendor_handled, 3=not_applicable
  detraction_constancia_code      text
  detraction_constancia_fecha     date
  detraction_constancia_url       text
  detraction_constancia_xml_url   text
  -- SUNAT electronic document fields — NULLABLE. Populated only when factura_status = 2 (received).
  serie_numero        text                            -- nullable
  fecha_emision       date                            -- nullable
  tipo_documento_code text                            -- nullable
  ruc_emisor          text                            -- nullable — validated vs contact.ruc when present
  ruc_receptor        text                            -- nullable — Korakuen's RUC
  hash_cdr            text                            -- nullable
  estado_sunat        text                            -- nullable
  pdf_url             text                            -- nullable, Google Drive shareable URL
  xml_url             text                            -- nullable, Google Drive shareable URL
  drive_file_id       text                            -- nullable, Google Drive file ID
  source              smallint NOT NULL DEFAULT 1
  submission_id       uuid
  notes               text
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()
  deleted_at          timestamptz

  CONSTRAINT ii_total_check
    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT ii_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
  CONSTRAINT ii_ruc_format
    CHECK (ruc_emisor IS NULL OR length(ruc_emisor) = 11)
  CONSTRAINT ii_received_requires_sunat
    CHECK (factura_status = 1 OR (
      serie_numero IS NOT NULL AND
      fecha_emision IS NOT NULL AND
      tipo_documento_code IS NOT NULL AND
      ruc_emisor IS NOT NULL AND
      ruc_receptor IS NOT NULL
    ))
```

**Payment progress computation (derived, not stored):**
```sql
SELECT
  ii.total_pen,
  COALESCE(SUM(pl.amount_pen), 0)                        AS paid,
  ii.total_pen - COALESCE(SUM(pl.amount_pen), 0)         AS outstanding,
  CASE
    WHEN COALESCE(SUM(pl.amount_pen), 0) = 0             THEN 'unpaid'
    WHEN COALESCE(SUM(pl.amount_pen), 0) < ii.total_pen  THEN 'partially_paid'
    ELSE 'paid'
  END                                                     AS payment_state
FROM incoming_invoices ii
LEFT JOIN payment_lines pl ON pl.incoming_invoice_id = ii.id
LEFT JOIN payments p ON p.id = pl.payment_id AND p.deleted_at IS NULL
WHERE ii.id = :invoice_id
GROUP BY ii.id, ii.total_pen
```

**Chase-the-factura query** — payments have been made but the paper factura never arrived:
```sql
SELECT ii.*
FROM incoming_invoices ii
LEFT JOIN payment_lines pl ON pl.incoming_invoice_id = ii.id
LEFT JOIN payments p ON p.id = pl.payment_id AND p.deleted_at IS NULL
WHERE ii.factura_status = 1 AND ii.deleted_at IS NULL
GROUP BY ii.id
HAVING COALESCE(SUM(pl.amount_pen), 0) > 0
```

### `incoming_invoice_line_items`

Optional. Header-only mode (totals from SUNAT document) or full line item detail.
When line items exist, their sum must match the header totals.

```sql
incoming_invoice_line_items
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  incoming_invoice_id   uuid NOT NULL REFERENCES incoming_invoices(id) ON DELETE CASCADE
  sort_order            smallint NOT NULL DEFAULT 0
  description           text NOT NULL
  unit                  text
  quantity              numeric(12,4) NOT NULL DEFAULT 1
  unit_price            numeric(15,2) NOT NULL
  subtotal              numeric(15,2) NOT NULL
  igv_applies           boolean NOT NULL DEFAULT true
  igv_amount            numeric(15,2) NOT NULL DEFAULT 0
  total                 numeric(15,2) NOT NULL
  cost_category_id      uuid REFERENCES cost_categories(id)  -- nullable, per-line categorization
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()

  CONSTRAINT iili_subtotal CHECK (ABS(subtotal - (quantity * unit_price)) < 0.01)
  CONSTRAINT iili_total    CHECK (ABS(total - (subtotal + igv_amount)) < 0.01)
  CONSTRAINT iili_igv_zero CHECK (igv_applies = true OR igv_amount = 0)
```

**`cost_category_id` on line items:** Line-level categorization exists alongside
the header-level `cost_category_id` on `incoming_invoices`. A single factura can
mix materials and labor, so header-only tagging would lose that detail. Phase 1
reporting still uses `payment_lines.cost_category_id` (the cash-basis view) as
ground truth; the line-level invoice category is a Phase 1 data hook for the
future Price Sentinel, which needs to compare individual line prices against
historical references.

**Immutability:** Locked when invoice `factura_status = 2 (received)` AND fully paid.
While `expected` or partially paid, line items remain editable so corrections can
flow through before the factura is finalized.

---

## Cash Tables

The payment model follows the same header + detail principle as quotes and invoices.

```
payments        — the cash event (one bank statement entry)
payment_lines   — what that cash was for (invoices, fees, loans, general)
```

Every cash movement — inbound or outbound — is a `payments` row. The `payment_lines`
rows say what the money was for. Bank account balance is derived from payment headers.
Invoice outstanding is derived from payment lines.

### `payments`

One row per cash event. Maps 1:1 to a bank statement entry.

```sql
payments
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  direction             smallint NOT NULL              -- 1=inbound, 2=outbound
  bank_account_id       uuid NOT NULL REFERENCES bank_accounts(id)
  project_id            uuid REFERENCES projects(id)  -- nullable: null = general expense
  contact_id            uuid REFERENCES contacts(id)  -- who paid us or who we paid (nullable)
  -- Partner tracking (outbound only)
  paid_by_partner_id    uuid REFERENCES contacts(id)
  -- Amounts (cached sum of payment_lines.amount — never entered manually)
  total_amount          numeric(15,2) NOT NULL DEFAULT 0
  currency              text NOT NULL DEFAULT 'PEN'
  exchange_rate         numeric(10,6)                  -- required when currency = 'USD'
  total_amount_pen      numeric(15,2) NOT NULL DEFAULT 0
  -- Detraction flag (true when this payment goes to/from Banco de la Nación)
  is_detraction         boolean NOT NULL DEFAULT false
  -- Reconciliation
  reconciled            boolean NOT NULL DEFAULT false
  bank_reference        text                           -- bank's own reference number
  reconciled_at         timestamptz
  reconciled_by         uuid REFERENCES users(id)
  -- Source tracking
  source                smallint NOT NULL DEFAULT 1
  submission_id         uuid
  drive_file_id         text                           -- Google Drive file ID for payment receipt
  payment_date          date NOT NULL
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()
  deleted_at            timestamptz

  CONSTRAINT pay_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
  CONSTRAINT pay_direction_partner
    CHECK (paid_by_partner_id IS NULL OR direction = 2)
  CONSTRAINT pay_bn_detraction
    CHECK (NOT is_detraction OR currency = 'PEN')
```

**Bank account balance:**
```sql
SELECT COALESCE(SUM(
  CASE WHEN direction = 1 THEN total_amount_pen ELSE -total_amount_pen END
), 0) AS balance_pen
FROM payments
WHERE bank_account_id = :id AND deleted_at IS NULL
```

### `payment_lines`

Detail rows. Each line says what a portion of the payment was for.

```sql
payment_lines
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  payment_id            uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE
  sort_order            smallint NOT NULL DEFAULT 0
  amount                numeric(15,2) NOT NULL
  amount_pen            numeric(15,2) NOT NULL
  -- What this line settles (all nullable — only one should be set)
  outgoing_invoice_id   uuid REFERENCES outgoing_invoices(id)
  incoming_invoice_id   uuid REFERENCES incoming_invoices(id)
  loan_id               uuid REFERENCES loans(id)
  -- Cost categorization (for reporting — nullable, outbound lines only)
  cost_category_id      uuid REFERENCES cost_categories(id)
  -- Line classification
  line_type             smallint NOT NULL DEFAULT 1
    -- 1=invoice  — settles an outgoing or incoming invoice
    -- 2=bank_fee — bank commission, never linked to an invoice
    -- 3=detraction — BN deposit/withdrawal
    -- 4=loan     — loan repayment
    -- 5=general  — general expense with no document
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()

  CONSTRAINT pl_positive
    CHECK (amount > 0)
  CONSTRAINT pl_invoice_exclusive
    CHECK (
      (outgoing_invoice_id IS NOT NULL)::int +
      (incoming_invoice_id IS NOT NULL)::int +
      (loan_id IS NOT NULL)::int <= 1
    )                                                  -- at most one document link per line
  CONSTRAINT pl_bank_fee_no_invoice
    CHECK (line_type != 2 OR (
      outgoing_invoice_id IS NULL AND
      incoming_invoice_id IS NULL AND
      loan_id IS NULL
    ))                                                 -- bank fees never link to documents
  CONSTRAINT pl_loan_type
    CHECK (line_type != 4 OR loan_id IS NOT NULL)      -- loan lines must have a loan_id
```

**Header recomputation:** After every line mutation, the engine atomically updates
`payments.total_amount` and `payments.total_amount_pen`.

**Cost breakdown by category for a project (payment-based, ground truth):**
```sql
SELECT
  COALESCE(cc.name, 'Sin categoría') AS category,
  SUM(pl.amount_pen)                 AS total_spent,
  COUNT(DISTINCT p.id)               AS payment_count,
  SUM(pl.amount_pen) FILTER (WHERE pl.incoming_invoice_id IS NOT NULL) AS formal,
  SUM(pl.amount_pen) FILTER (WHERE pl.incoming_invoice_id IS NULL)     AS informal
FROM payment_lines pl
JOIN payments p ON p.id = pl.payment_id AND p.deleted_at IS NULL
LEFT JOIN cost_categories cc ON cc.id = pl.cost_category_id
WHERE p.project_id = :project_id
  AND p.direction = 2              -- outbound only
  AND pl.line_type IN (1, 5)       -- invoice payments and general expenses
GROUP BY cc.name
ORDER BY total_spent DESC
```
```sql
-- Payments that can be linked to a given invoice
-- Filter: same contact OR no contact registered. Different contact = hard block.
SELECT
  p.id, p.total_amount_pen, p.payment_date, p.contact_id,
  -- available = total payment minus what's already allocated to other invoices
  p.total_amount_pen - COALESCE(SUM(pl.amount_pen) FILTER (
    WHERE pl.outgoing_invoice_id IS NOT NULL
       OR pl.incoming_invoice_id IS NOT NULL
  ), 0) AS available_amount
FROM payments p
LEFT JOIN payment_lines pl ON pl.payment_id = p.id
WHERE p.direction = :expected_direction
  AND p.deleted_at IS NULL
  AND (
    p.contact_id = :invoice_contact_id
    OR p.contact_id IS NULL
  )
GROUP BY p.id, p.total_amount_pen, p.payment_date, p.contact_id
HAVING p.total_amount_pen - COALESCE(SUM(pl.amount_pen) FILTER (
    WHERE pl.outgoing_invoice_id IS NOT NULL
       OR pl.incoming_invoice_id IS NOT NULL
  ), 0) > 0
```

**Invoice outstanding:**
```sql
SELECT
  oi.total_pen,
  COALESCE(SUM(pl.amount_pen), 0)           AS total_paid,
  oi.total_pen - COALESCE(SUM(pl.amount_pen), 0) AS outstanding
FROM outgoing_invoices oi
LEFT JOIN payment_lines pl ON pl.outgoing_invoice_id = oi.id
LEFT JOIN payments p ON p.id = pl.payment_id AND p.deleted_at IS NULL
WHERE oi.id = :invoice_id
GROUP BY oi.id, oi.total_pen
```

**S/100 invoice + S/4 bank fee example:**
```sql
-- One payment: S/104 out of BCP
INSERT INTO payments (direction, bank_account_id, currency, total_amount_pen,
  contact_id, payment_date, bank_reference)
VALUES (2, :bcp_id, 'PEN', 104.00, :vendor_id, '2026-04-09', 'TRF-00293847');

-- Line 1: S/100 settles incoming invoice F001
INSERT INTO payment_lines (payment_id, amount, amount_pen, incoming_invoice_id, line_type)
VALUES (:payment_id, 100.00, 100.00, :invoice_f001_id, 1);

-- Line 2: S/4 bank fee, no document link
INSERT INTO payment_lines (payment_id, amount, amount_pen, line_type, notes)
VALUES (:payment_id, 4.00, 4.00, 2, 'Comisión bancaria');
```

**S/10,000 payment covering 3 invoices:**
```sql
INSERT INTO payments (direction, bank_account_id, currency, total_amount_pen,
  contact_id, payment_date)
VALUES (2, :bcp_id, 'PEN', 10000.00, :vendor_id, '2026-04-09');

INSERT INTO payment_lines (payment_id, amount, amount_pen, incoming_invoice_id, line_type)
VALUES
  (:payment_id, 3000.00, 3000.00, :invoice_f001_id, 1),
  (:payment_id, 4000.00, 4000.00, :invoice_f002_id, 1),
  (:payment_id, 3000.00, 3000.00, :invoice_f003_id, 1);
```

**Loan repayment example:**
```sql
INSERT INTO payments (direction, bank_account_id, currency, total_amount_pen,
  contact_id, payment_date)
VALUES (2, :bcp_id, 'PEN', 5000.00, :lender_contact_id, '2026-04-09');

INSERT INTO payment_lines (payment_id, amount, amount_pen, loan_id, line_type)
VALUES (:payment_id, 5000.00, 5000.00, :loan_id, 4);
```

---

## Loans Module

Partners borrow externally to fund their share of project costs. These are personal
loans arranged by a partner, not company debt. Korakuen tracks them because repayments
come from the partner's profit share and because the 10% minimum return rule creates
internal obligations that must be visible in cash flow planning.

### `loans`

One row per loan arrangement.

```sql
loans
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  project_id            uuid NOT NULL REFERENCES projects(id)
  borrowing_partner_id  uuid NOT NULL REFERENCES contacts(id)  -- the partner who borrowed
  lender_contact_id     uuid NOT NULL REFERENCES contacts(id)  -- the person who lent
  principal_amount      numeric(15,2) NOT NULL
  currency              text NOT NULL DEFAULT 'PEN'
  exchange_rate         numeric(10,6)
  principal_amount_pen  numeric(15,2) NOT NULL
  -- Return terms
  return_rate           numeric(5,4) NOT NULL                  -- minimum 0.10 (10%)
  return_type           text NOT NULL DEFAULT 'percentage'      -- 'percentage' | 'fixed_amount'
  return_amount         numeric(15,2)                          -- only when return_type = 'fixed_amount'
  -- Dates
  disbursement_date     date NOT NULL
  due_date              date
  notes                 text
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()
  deleted_at            timestamptz

  CONSTRAINT loan_pen_required
    CHECK (currency = 'PEN' OR exchange_rate IS NOT NULL)
  CONSTRAINT loan_minimum_return
    CHECK (return_rate >= 0.10)                               -- 10% minimum rule
  CONSTRAINT loan_fixed_amount_required
    CHECK (return_type != 'fixed_amount' OR return_amount IS NOT NULL)
```

### `loan_schedule`

Optional structured repayment schedule. When present, entries appear in the obligation
calendar alongside invoice due dates.

```sql
loan_schedule
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid()
  loan_id     uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE
  due_date    date NOT NULL
  amount_due  numeric(15,2) NOT NULL
  notes       text
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()
```

**Repayments** flow through `payments` + `payment_lines` with `line_type = 4`
and `loan_id` set on the line. No separate repayment table needed.

**Loan status is always derived — never stored:**
```sql
-- v_loan_balances view
SELECT
  l.id,
  l.principal_amount_pen,
  COALESCE(SUM(pl.amount_pen), 0)                          AS total_repaid,
  l.principal_amount_pen - COALESCE(SUM(pl.amount_pen), 0) AS balance_remaining,
  CASE
    WHEN COALESCE(SUM(pl.amount_pen), 0) = 0              THEN 'active'
    WHEN COALESCE(SUM(pl.amount_pen), 0) < l.principal_amount_pen THEN 'partially_repaid'
    ELSE 'settled'
  END AS status
FROM loans l
LEFT JOIN payment_lines pl ON pl.loan_id = l.id
LEFT JOIN payments p ON p.id = pl.payment_id AND p.deleted_at IS NULL
WHERE l.deleted_at IS NULL
GROUP BY l.id, l.principal_amount_pen
```

**Obligation calendar view — DEFERRED.** The north star originally described an
obligation calendar (a single chronological list of everything that needs to be
paid, sorted by due date, spanning receivables, payables, and loan schedule rows).
Korakuen pays its vendors upfront and does not extend credit to clients, so the
real-world queue this was meant to surface is usually empty. The feature is
explicitly deferred — the `loan_schedule` table still exists for tracking loan
due dates, but no `v_obligation_calendar` view is planned for Phase 1.

---

Staging layer for the scan-and-upload mobile app. Partner submissions land here for
admin review before being promoted into main tables. Nothing here affects balances
or financial reports until approved.

```sql
submissions
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
  source_type           smallint NOT NULL
  submitted_by          uuid NOT NULL REFERENCES users(id)
  submitted_at          timestamptz NOT NULL DEFAULT now()
  image_url             text
  pdf_url               text
  xml_url               text
  -- Pre-filled fields from OCR/AI parsing. Admin reviews and corrects before approving.
  extracted_data        jsonb NOT NULL DEFAULT '{}'
  review_status         smallint NOT NULL DEFAULT 1
  reviewed_by           uuid REFERENCES users(id)
  reviewed_at           timestamptz
  rejection_notes       text
  -- Set on approval — bidirectional link to the created record
  resulting_record_id   uuid
  resulting_record_type text                          -- e.g. 'incoming_invoices'
  created_at            timestamptz NOT NULL DEFAULT now()
  updated_at            timestamptz NOT NULL DEFAULT now()
  deleted_at            timestamptz

  CONSTRAINT approved_has_result
    CHECK (review_status != 2 OR
      (resulting_record_id IS NOT NULL AND resulting_record_type IS NOT NULL))

  CONSTRAINT rejected_no_result
    CHECK (review_status != 3 OR resulting_record_id IS NULL)
```

**`extracted_data` shape for `source_type = 1` (incoming_invoice):**
```json
{
  "serie_numero": "F001-00000142",
  "fecha_emision": "2026-04-08",
  "ruc_emisor": "20512345678",
  "razon_social_emisor": "Proveedor SAC",
  "subtotal": 847.46,
  "igv_amount": 152.54,
  "total": 1000.00,
  "currency": "PEN",
  "detraction_rate": null,
  "confidence": 0.94
}
```

`confidence` (0–1) is the OCR extraction confidence score. Low-confidence fields
are highlighted in the review UI.

**RLS:** Partners see only their own submissions. Admin sees all.

---

## Indexes

```sql
-- Projects
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_client ON projects(client_id) WHERE deleted_at IS NULL;

-- Contacts
CREATE INDEX idx_contacts_ruc ON contacts(ruc) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_dni ON contacts(dni) WHERE deleted_at IS NULL;

-- Transactions (most queried table)
```sql
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
CREATE INDEX idx_iq_project ON incoming_quotes(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_iq_contact ON incoming_quotes(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_project ON incoming_invoices(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_contact ON incoming_invoices(contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ii_category ON incoming_invoices(cost_category_id)
  WHERE cost_category_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_ii_quote   ON incoming_invoices(incoming_quote_id)
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
```

---

## Engine-Enforced Integrity Rules

These cannot be expressed as CHECK constraints and are enforced in application code:

1. **Profit split sum:** `SUM(profit_split_pct)` across active `project_partners`
   must equal 100.00 (±0.01) before project activation or settlement calculation.

2. **Project activation requires contract fields:** Before transitioning a project
   from `prospect` to `active`, the engine validates that all contract fields are
   populated: `contract_value`, `billing_frequency`, `signed_date`.

3. **Winning quote uniqueness:** At most one `outgoing_quote` per project can have
   `is_winning_quote = true`. Setting it on one automatically unsets any other on
   the same project. Enforced at the engine layer, not via DB constraint (to allow
   the atomic swap without a constraint violation).

4. **Contact verification:** `POST /contacts` always calls the decolecta API.
   RUC or DNI not found in SUNAT/RENIEC → `404`. Contact cannot be created.

3. **IGV XML validation:** When `serie_numero` is present, `igv_amount` is validated
   against the XML value. Mismatch > S/0.01 → warning (XML is authoritative).

4. **RUC consistency:** `ruc_emisor` from XML must match `contacts.ruc` for the
   vendor on incoming invoices. Mismatch → warning.

5. **Detraction PEN on USD:** If `currency = 'USD'` and `detraction_amount` is set,
   `exchange_rate` is required. Engine validates:
   `detraction_amount ≈ total × detraction_rate × exchange_rate`.

6. **BN payment = detraction:** Any payment on a `banco_de_la_nacion` account
   must have `is_detraction = true`.

7. **Autodetracción:** Setting `detraction_status = 4` on an outgoing invoice requires
   at least one payment line with `line_type = 3` linked to that invoice via a BN payment.

8. **Payment line over-allocation block:** Engine prevents adding a payment line
   whose amount would cause the invoice's total paid to exceed `invoice.total_pen`.
   Returns `422`.

9. **Payment header total:** `payments.total_amount` must always equal
   `SUM(payment_lines.amount)`. Engine recomputes atomically after every line mutation.

10. **Bank fee lines never link to documents:** `line_type = 2` lines must have
    `outgoing_invoice_id`, `incoming_invoice_id`, and `loan_id` all null. Enforced
    by DB constraint `pl_bank_fee_no_invoice` and engine validation.

11. **Reconciliation immutability:** Payment lines on reconciled payments
    (`payments.reconciled = true`) cannot be added, edited, or deleted.

12. **Line item / header consistency:** Before a document leaves draft, the engine
    validates `SUM(line_items.total) = header.total` (±S/0.01).

13. **Incoming invoice dual mode:** Header-only OR line items — not both simultaneously.
    Once line items exist, header totals become read-only.

14. **Submission promotion uniqueness:** A submission can only be approved once.
    Re-approving after `resulting_record_id` is set returns `409 CONFLICT`.

15. **Outgoing invoice status auto-update:** When a payment line linking to an
    outgoing invoice is created or deleted, the engine recalculates and updates
    `outgoing_invoices.status`:
    - `SUM(payment_lines.amount_pen) = 0` → remains at `sent`
    - `0 < SUM < total_pen` → `partially_paid`
    - `SUM >= total_pen` → `paid`

    **Incoming invoices do NOT auto-update from payments.** Their `factura_status`
    is independent of payment progress and only changes via an explicit
    `expected → received` transition. Payment progress on an incoming invoice is
    always derived at query time from the sum of linked payment lines and returned
    under `_computed` — it is never stored.

---

*Last updated: April 2026*
