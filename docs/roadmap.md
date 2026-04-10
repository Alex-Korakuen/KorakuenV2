# Korakuen — Build Roadmap

> Build order follows the three-phase architecture defined in `architecture.md`.
> The schema is fixed from day one. The application layer evolves in phases.
>
> Full specs: `architecture.md` · `api-design-principles.md` · `schema-reference.md` · `domain-model.md`

---

## Phase 1 — 2-Tier: Next.js → Supabase

*One repository. One language. Proper patterns. Built to last.*

The goal is a durable, correct management system — built on proper coding patterns
and sound business logic. Business logic
lives in `lib/validators/` and `lib/lifecycle.ts`. The activity log is handled by a
Postgres trigger. Server actions are written API-shaped from the start — thin, with
all validation centralized — so migrating to FastAPI later is a lift-and-shift, not
a rewrite.

---

### Step 0 — Setup ✅

**Create 1 private GitHub repository:** `korakuen`

**Create 1 Supabase project:**
- `korakuen-prod` — single project for now. Dev database added at the end of this roadmap.

**Local setup:**
```
npx create-next-app@latest korakuen
cd korakuen
npm install @supabase/supabase-js @supabase/ssr
```

**Environment variables (`.env.local`):**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DECOLECTA_TOKEN=
```

**Commit discipline:** One commit per logical unit of work.

---

### Step 1 — Database Schema ✅

Run migrations in the Supabase SQL editor (`korakuen-prod`) in this order:

1. Extensions: `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`
2. Infrastructure: `users`, `exchange_rates`, `activity_log`
3. Core: `contacts`, `bank_accounts`
4. Projects: `projects`, `project_partners`
5. Revenue: `outgoing_quotes`, `outgoing_quote_line_items`,
   `outgoing_invoices`, `outgoing_invoice_line_items`
6. Costs: `incoming_quotes`, `incoming_quote_line_items`,
   `incoming_invoices`, `incoming_invoice_line_items`
7. Cash: `payments`, `payment_lines`
8. Submissions: `submissions`
9. Indexes: all indexes from `schema-reference.md`
10. Activity log trigger (see below)
11. RLS policies

**Activity log trigger (write once, works forever):**
```sql
CREATE OR REPLACE FUNCTION log_financial_mutation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_log (resource_type, resource_id, action, actor_user_id,
                             before_state, after_state)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE TG_OP
      WHEN 'INSERT' THEN 1
      WHEN 'UPDATE' THEN 2
      WHEN 'DELETE' THEN 5
    END,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to all financial tables
CREATE TRIGGER log_outgoing_invoices
  AFTER INSERT OR UPDATE OR DELETE ON outgoing_invoices
  FOR EACH ROW EXECUTE FUNCTION log_financial_mutation();

-- Repeat for: incoming_invoices, outgoing_quotes, incoming_quotes,
-- payments, payment_lines, projects
```

**Initial RLS policies:**
```sql
-- Users see only their own data
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_projects" ON projects
  USING (auth.uid() IN (
    SELECT u.id FROM users u
    WHERE u.role = 1  -- admin sees all
    UNION
    SELECT pp.contact_id FROM project_partners pp
    WHERE pp.project_id = projects.id  -- partners see assigned projects
  ));
-- Repeat pattern for all tables
```

**Verify:** All tables visible in Supabase. Trigger fires when a test insert is made.

**Commit:** `feat: initial schema — all tables, trigger, indexes, RLS`

---

### Step 2 — Project Structure ✅

Create the core `lib/` structure before writing any server actions:

```
lib/
  db.ts              — Supabase client (server-side and client-side)
  lifecycle.ts       — status transition rules for all document types
  validators/
    contacts.ts      — RUC/DNI format, SUNAT verification flow
    invoices.ts      — totals consistency, IGV validation, SUNAT XML
    payments.ts      — BN account rules, detraction consistency, over-allocation
    projects.ts      — profit split sum, status transitions
    quotes.ts        — line item consistency, immutability rules
  sunat.ts           — decolecta API wrapper (RUC/DNI lookup)
  exchange-rate.ts   — rate lookup from exchange_rates table
```

`lifecycle.ts` is the single place that defines valid status transitions:
```typescript
export const TRANSITIONS = {
  outgoing_invoice: {
    1: [2],        // draft → sent
    2: [1, 5],     // sent → draft (undo, no SUNAT data) | void (no payment lines)
  },
  incoming_quote: {
    1: [2, 3],     // draft → approved | cancelled
  },
  // etc.
}

export function canTransition(table: string, from: number, to: number): boolean {
  return TRANSITIONS[table]?.[from]?.includes(to) ?? false
}
```

**Commit:** `feat: lib structure — validators, lifecycle, db client`

---

### Step 3 — Auth ✅

1. Supabase Auth setup (email/password, or magic link)
2. Middleware in `middleware.ts` — refresh session on every request
3. Login page
4. `lib/auth.ts` — helper to get current user + role from session
5. Admin vs Partner route protection via Next.js middleware

**Verify:** Login works. Admin and partner sessions have correct role.

**Commit:** `feat: auth — Supabase Auth, session middleware, role-based routing`

---

### Step 4 — Contacts ✅

Server actions in `app/actions/contacts.ts`:

- `getContacts(filters)` — list with `is_client`, `is_vendor`, `is_partner`, `search`
- `lookupContact(ruc?: string, dni?: string)` — calls decolecta, returns pre-filled fields
- `createContact(data)` — calls `lookupContact` internally, validates, saves
- `updateContact(id, data)` — only editable fields (nome_comercial, email, phone, flags, notes)
- `deleteContact(id)` — soft delete, blocks if active documents exist

**`sunat.ts` — the decolecta wrapper:**
```typescript
export async function lookupRuc(ruc: string) {
  const res = await fetch(
    `https://api.decolecta.com/v1/sunat/ruc?numero=${ruc}`,
    { headers: { Authorization: `Bearer ${process.env.DECOLECTA_TOKEN}` } }
  )
  if (!res.ok) throw new Error('RUC no encontrado en el padrón SUNAT')
  return res.json()
}
```

**Rules enforced in `validators/contacts.ts`:**
- No contact creation without SUNAT/RENIEC verification
- RUC/DNI immutable after creation
- Warning returned (not error) for inactive/non-habido contacts

**Commit:** `feat: contacts — SUNAT-verified creation, CRUD, lookup endpoint`

---

### Step 5 — Bank Accounts ✅

Server actions in `app/actions/bank-accounts.ts`:

- `getBankAccounts()` — each account includes computed `balance_pen`
- `createBankAccount(data)`
- `updateBankAccount(id, data)`
- `archiveBankAccount(id)` — blocks if payments exist

**Balance computation (called on every list fetch):**
```typescript
const { data } = await supabase.rpc('get_bank_account_balance', { account_id: id })
```

Or inline SQL via Supabase's `from().select()` with aggregation.

**Commit:** `feat: bank accounts CRUD with balance derivation`

---

### Step 6 — Projects and Partners ✅

Server actions in `app/actions/projects.ts`:

- `getProjects(filters)` — paginated list, embeds each project's partners via a
  single batched fetch (no N+1)
- `createProject(data)`
- `updateProject(id, data)` — strongly typed with `UpdateProjectInput`
- `activateProject(id)` — prospect → active. Validates: contract exists, profit split = 100
- `completeProject(id)` — active → completed
- `archiveProject(id)` — completed → archived
- `deleteProject(id)` — prospect only, blocks if any references exist
- `getProject(id)` — detail view with embedded partners
- `getProjectPartners(projectId)`
- `upsertProjectPartner(projectId, data)` — add or update partner split
- `removeProjectPartner(projectId, partnerId)`

**Profit split validation in `lib/validators/projects.ts`:** `validateProfitSplits`
requires the set to sum to 100% within tolerance and is called by
`validateProjectActivation` at the prospect → active transition.

**Partner input validation in `lib/validators/project-partners.ts`:**
`validateProjectPartnerInput` enforces field presence and `0 < pct ≤ 100`.
(Originally scheduled for Step 6.5c — landed early as part of the post-audit
fixes below.)

**Partner lifecycle rule — "set in stone at activation":** Partner rosters are
free to edit during the prospect phase, when admins iterate on who's involved
and what the splits look like. Once a project transitions to `active`,
`upsertProjectPartner` and `removeProjectPartner` return `CONFLICT` with the
message "Los repartos quedan fijos al activar el proyecto." This is a hard
lock, not a sum=100 guard — it matches the real workflow where splits are
finalized before the first expense is logged and never touched afterward.
The settlement formula in Step 12 depends on the 100%-invariant holding for
the entire active lifetime of the project, and a hard lock is the only
representation that guarantees it cannot silently drift.

**Tests:** `lib/validators/__tests__/projects.test.ts` and
`lib/validators/__tests__/project-partners.test.ts` cover the validators.

**Commit:** `feat: projects & partners — CRUD, lifecycle transitions, partner management`

**Post-audit fixes (April 2026):** A full audit of Step 6 against the roadmap
and the API principles surfaced four issues, fixed in a follow-up pass:

1. `getProjects` list now embeds partners as the roadmap originally required
   (single batched query, no N+1).
2. Partners frozen on active projects via the hard lock described above.
3. `updateProject` parameter typed with `UpdateProjectInput` instead of
   `Record<string, unknown>`.
4. New test suite for `validateProjectPartnerInput` (11 cases).

**Commit:** `refactor: step 6 post-audit fixes`

---

### Step 6.5 — Schema Delta + Project Budgets ✅

> Result of the April 2026 north-star alignment audit. A single coordinated
> pass that lands the decided schema changes, updates the TypeScript and
> lifecycle layers to match, cleans up validator debt from earlier steps,
> and ships the `project_budgets` feature that those changes enable. Four
> sub-commits, tightly ordered — the TypeScript layer cannot compile against
> the old schema, so 6.5a and 6.5b must land in sequence, and the validators
> in 6.5c depend on both. Running the steps out of order creates a "broken
> middle" state where types disagree with the database.
>
> This step unblocks Step 9 (Cost Documents, uses the new `factura_status`),
> Step 10 (Payments, payment lines link to `incoming_invoices`), and the
> project summary endpoint in Step 12 (needs `project_budgets` rows to
> derive estimated cost and margin).

**Prerequisite check:** Verify `incoming_invoices` is empty in prod before
running 6.5a. If any rows exist, the migration must map old values safely:
`unmatched | partially_matched | matched → factura_status = 2 (received)`
(all old rows had a factura).

#### 6.5a — Schema migration

Single new migration file under `supabase/migrations/`. All changes are
additive or rename operations — no destructive changes.

- `cost_categories`: add `parent_id uuid REFERENCES cost_categories(id)`
  nullable; drop `UNIQUE (name)` and replace with `UNIQUE (parent_id, name)`
  so uniqueness is scoped to a branch
- `projects`: add `5 = rejected` to the status enum (app-level; the smallint
  column already accepts the value, so this is a CHECK constraint update)
- `incoming_invoice_line_items`: add `cost_category_id uuid REFERENCES cost_categories(id)`, nullable
- `incoming_invoices`:
  - Rename column `status` → `factura_status`
  - New two-value enum: `1 = expected, 2 = received`
  - Make nullable: `serie_numero`, `fecha_emision`, `tipo_documento_code`,
    `ruc_emisor`, `ruc_receptor`, `hash_cdr`, `estado_sunat`, `pdf_url`,
    `xml_url`, `drive_file_id`, `factura_number`
  - Add constraint `ii_received_requires_sunat`: when `factura_status = 2`,
    all of `serie_numero`, `fecha_emision`, `tipo_documento_code`,
    `ruc_emisor`, `ruc_receptor` must be NOT NULL
- New table `project_budgets`:
  `id, project_id, cost_category_id, budgeted_amount_pen, notes,
  created_at, updated_at, deleted_at`. Unique `(project_id, cost_category_id)`.
  Check `budgeted_amount_pen >= 0`. Full definition in `schema-reference.md`.
- Activity log trigger attached to `project_budgets` so mutations are logged
- New SQL helper function `get_incoming_invoice_payment_progress(invoice_id)`
  returning `{total_pen, paid, outstanding, payment_state}`, used by server
  actions to avoid reimplementing the math per query

**Commit:** `feat: schema — factura_status, project_budgets, cost_categories hierarchy, rejected status`

#### 6.5b — TypeScript types and lifecycle

- `lib/types.ts`:
  - Replace `INCOMING_INVOICE_STATUS` with `INCOMING_INVOICE_FACTURA_STATUS`
    (`expected = 1, received = 2`); update all imports
  - Add `rejected = 5` to `PROJECT_STATUS`
  - Update any shape types that include the old incoming invoice status
- `lib/lifecycle.ts`:
  - Remove old `incoming_invoice` transitions
    (`unmatched → partially_matched → matched`)
  - Add `incoming_invoice.factura_status` transition: `expected → received`
    (one-way). On transition to `received`, the validator in 6.5c will
    enforce the SUNAT field presence rule — the lifecycle rule itself
    just gates which transitions are legal.
  - Add `project.status` transitions: `prospect → rejected`, `active → rejected`
- Grep for any file importing the removed `INCOMING_INVOICE_STATUS` enum
  and update each site. Expected: nothing yet (incoming invoices CRUD is
  not built), but verify before committing.

**Commit:** `feat: types — factura_status enum, rejected project status, lifecycle rules`

#### 6.5c — Validators and validator-debt cleanup

Two validator changes bundled so they land as one logical pass:

- **New** `lib/validators/project-budgets.ts`:
  - `validateCreateProjectBudget(data)` — amount ≥ 0; the referenced
    `cost_category_id` must resolve to a row with `parent_id IS NULL`
    (top-level only); no existing row for the same `(project_id,
    cost_category_id)` pair
  - `validateUpdateProjectBudget(data)` — same rules
- **Update** `lib/validators/incoming-invoices.ts`:
  - `validateFacturaStatusTransition(from, to, data)` — enforce
    `expected → received` only; on `received`, require all SUNAT fields
    present
  - Remove any references to the old status vocabulary

> **Note:** The Step 6 retrofit originally scheduled here — extracting the
> inline project-partner validation into `lib/validators/project-partners.ts`
> — was landed early as part of the Step 6 post-audit fixes, alongside a new
> sum=100 guard on active-project partner mutations and a dedicated test
> suite. That validator file and its tests already exist when 6.5c begins.

**Commit:** `refactor: validators — project-budgets, incoming invoices`

#### 6.5d — Project Budgets server actions

Server actions in `app/actions/project-budgets.ts`:

- `getProjectBudgets(projectId)` — list budget rows for a project with
  category names joined in
- `upsertProjectBudget(projectId, categoryId, amountPen, notes?)` — create
  or update a single budget line (uses the `UNIQUE (project_id,
  cost_category_id)` constraint to decide insert vs update)
- `removeProjectBudget(projectId, categoryId)` — soft delete
- `getEstimatedCost(projectId)` — returns the derived sum; used by the
  project summary endpoint in Step 12

**No UI in Phase 1.** Logic and validators only. Budget entry and display
are deferred until later in the UI build — the data foundation exists so
the project summary endpoint can compute expected margin the moment a
budget exists.

**Commit:** `feat: project_budgets server actions`

---

### Step 7 — Exchange Rate Job ✅

The exchange rate cron lives entirely inside the Next.js app:

- **Route:** `app/api/cron/fetch-exchange-rates/route.ts` — protected by `CRON_SECRET`
- **Helper:** `lib/bcrp.ts` — fetches BCRP series `PD04639PD-PD04640PD`, parses,
  applies the +1 business day shift to convert SBS closing date → SUNAT
  publication date, and upserts three rows (compra/venta/promedio)
- **Schedule:** `vercel.json` — `0 14 * * *` (14:00 UTC = 09:00 Lima time);
  weekends are skipped inside the route, not by the cron expression
- **Env vars on Vercel:** `CRON_SECRET` (the same value as in `.env.local`) and
  the existing Supabase keys

Why BCRP and not SUNAT directly: SUNAT's XML endpoint is now blocked by an F5
firewall and only ever returned the latest rate (no historical lookup). BCRP is
the central bank itself, free, no auth, no rate limits, and supports historical
date ranges in a single call. BCRP republishes the same SBS rates SUNAT uses for
tax purposes, just labeled by SBS closing date instead of SUNAT publication date.

**System health endpoint in Next.js (`app/api/health/route.ts`):**
```typescript
export async function GET() {
  const today = new Date().toISOString().split('T')[0]
  const isWeekend = [0, 6].includes(new Date().getDay())
  const { data } = await supabase
    .from('exchange_rates')
    .select('rate_date, rate')
    .eq('rate_type', 'promedio')
    .order('rate_date', { ascending: false })
    .limit(1)
    .single()

  const rateOk = isWeekend || data?.rate_date === today
  return Response.json({
    status: rateOk ? 'ok' : 'degraded',
    exchange_rate: {
      ok: rateOk,
      last_rate_date: data?.rate_date,
      last_rate: data?.rate,
      alert: rateOk ? null :
        'Tipo de cambio no disponible para hoy. Los montos en USD no pueden convertirse.'
    }
  })
}
```

**Dashboard banner:** On every page load, the layout checks `/api/health`. If
`exchange_rate.ok = false` on a weekday, a persistent red banner appears at the top.

**Commit:** `feat: exchange rate job, health endpoint, dashboard alert`

---

### Step 8 — Revenue Documents ✅

Server actions for:

**Outgoing quotes:**
- Full CRUD with line items
- Status transitions: draft → sent → approved | rejected | expired
- Line item immutability enforced in `validators/quotes.ts`
- Header totals recomputed after every line item mutation

**Outgoing invoices:**
- Full CRUD with line items
- Status: `draft → sent → void` (workflow-only, manual transitions)
- Undo: `sent → draft` allowed while no SUNAT fields are committed
- Void: blocked while any `payment_lines` reference the invoice
- Line items locked when `status != draft`
- `_computed` block on every response: `payment_state`, `sunat_state`,
  `paid_regular`, `paid_bn`, `outstanding_regular`, `outstanding_bn`,
  `is_fully_paid` — all derived from payment_lines and `estado_sunat`
- SUNAT field format validation in `validators/invoices.ts`
  (serie_numero regex, RUC digit check, tipo_documento_code enum)

**Commit:** `feat: revenue documents — quotes, outgoing invoices with line items`

---

### Step 9 — Cost Documents

> Prerequisite: Step 6.5 must be landed. The `factura_status` enum, the
> `incoming_invoice.factura_status` lifecycle transition, and the
> `validateFacturaStatusTransition` validator all come from Step 6.5; Step 9
> is where the server actions and UI wire those pieces into the incoming
> invoices CRUD.

Server actions for:

**Incoming quotes:**
- Full CRUD with line items
- Status: draft → approved | cancelled
- Line items locked on approval
- "Track as expected invoice" one-click action on approved quotes

**Incoming invoices:**
- Full CRUD (header-only or with line items)
- `factura_status` lifecycle: `expected → received` (one-way)
- Payment progress (`unpaid | partially_paid | paid`) is **derived**, never stored —
  returned under `_computed` in every invoice response
- Three creation paths: from approved quote, from payment with no factura
  linked, manual "New Incoming Invoice" with Expected toggle
- SUNAT fields nullable while `expected`; required on transition to `received`
- `incoming_quote_id` linkable after the fact
- SUNAT XML fields extracted and stored when transitioning to `received`

**Commit:** `feat: cost documents — incoming quotes, incoming invoices with factura_status`

---

### Step 10 — Payments and Payment Lines

Server actions for:

**Payments (header):**
- `getPayments(filters)` — all filters from schema (project, account, direction,
  contact, date range, reconciled)
- `createPayment(data)` — validates BN rules, detraction consistency,
  computes `total_amount_pen`
- `updatePayment(id, data)` — blocked if reconciled
- `deletePayment(id)` — soft delete, blocked if reconciled

**Payment lines (detail):**
- `addPaymentLine(paymentId, data)` — validates line_type rules, over-allocation,
  invoice exclusivity. Recomputes payment header totals.
- `removePaymentLine(lineId)` — blocked if payment is reconciled.
  Recomputes payment header totals.
- `getEligiblePayments(invoiceId, invoiceType)` — filtered list of payments
  eligible to allocate to this invoice (same contact or no contact, unallocated balance > 0)

**Outgoing invoice status is workflow-only** and never touched by payment
line mutations. The `_computed.payment_state` field is derived at query
time from the sum of linked `payment_lines.amount_pen` vs `total_pen`,
mirroring the same derivation used for incoming invoices. Both document
types follow the two-dimensional model: workflow status on the row,
payment progress under `_computed`. See `api-design-principles.md` →
"Formulas" for the canonical computations.

**Commit:** `feat: payments CRUD, payment lines, eligible payment filter`

---

### Step 11 — Bank Reconciliation

- `getUnreconciled(bankAccountId)` — payments with `reconciled = false`
- `reconcilePayment(id, bankReference)` — marks reconciled, stamps
  `reconciled_at` and `reconciled_by`
- `unreconcilePayment(id)` — reverts

Reconciliation is per-payment, not batched. For Korakuen's scale (roughly
50–100 transactions per month) the simple per-payment flow — open the queue,
paste bank references from the statement one by one, confirm — is the right
shape. No `reconciliation_group_id`, no batch import, no atomic group
reconciliation. If volume grows enough to need bulk operations later, the
schema can be extended without breaking existing data.

**Commit:** `feat: bank reconciliation`

---

### Step 12 — Reporting

All derived calculations follow the canonical formulas in
`api-design-principles.md` under the "Formulas" section.

**Per-project endpoints:**
- `getProjectSummary(projectId)` — contract value, estimated cost (derived from
  `project_budgets`), invoiced, collected, actual spend, expected margin, actual
  margin, per-partner cost breakdown
- `getSettlement(projectId)` — per-partner costs + profit share (the liquidación
  formula)

**Consolidated Financial Position view** — the single dashboard that answers
"where does Korakuen stand right now?" in one screen. Replaces what would
otherwise be five separate report endpoints. Returns:
- Cash position — per bank account and total (regular accounts)
- Banco de la Nación balance — reported separately (tax-only funds)
- IGV position — output − input = net, with period selector
- Loan positions — outstanding per active loan, total owed
- Receivables summary — total outstanding across all outgoing invoices,
  aggregated by client
- Payables summary — total outstanding across all `received` incoming invoices,
  aggregated by vendor
- Chase list — `expected` incoming invoices that already have payments (need
  factura paperwork)

Action: `getFinancialPosition(periodStart?, periodEnd?)` returns all of the
above in a single response. The dashboard renders it as one "Posición
Financiera" page.

**Commit:** `feat: reporting — project summary, settlement, financial position view`

---

### Step 13 — Dashboard UI and Partner Views

Priority order:

1. Auth flow and role-based layout
2. Projects list with status indicators and financial summary
3. Project detail — contract, invoice list, payment list, settlement
4. New outgoing invoice form (with line items)
5. New payment form (with payment lines and invoice matching)
6. Bank reconciliation queue UI
7. Reports: cash position, IGV, outstanding receivables
8. Partner view — restricted to assigned projects, their costs, their profit share
9. Exchange rate alert banner (from health endpoint)

**Commit:** `feat: dashboard UI — admin and partner views`

---

### Step 14 — Submissions (Scan App Staging)

- Submissions table UI for admin — review queue, approve/reject
- Partner submission form — upload image/PDF/XML, review extracted data
- Approval flow — engine promotes to `incoming_invoices` or `payments`

**Commit:** `feat: submissions — staging workflow for partner scan uploads`

---

### Step 15 — Dev Database

Create a second Supabase project `korakuen-dev` to separate development from production:

1. Create `korakuen-dev` Supabase project
2. Run all migrations against `korakuen-dev`
3. Set up `.env.local` to point to dev by default, `.env.production` to prod
4. Seed dev database with representative test data
5. Verify all server actions and reporting work against dev
6. From this point forward: never develop against prod

**Commit:** `feat: dev database — separate Supabase project, seed data, env config`

---

## Phase 2 — Add FastAPI Engine

*Trigger: when CLI or AI agent access is needed.*

At this point the system is working. The `lib/validators/` and `lib/lifecycle.ts`
files contain all the business logic. Migration steps:

1. Create `korakuen-engine` repository (Python FastAPI)
2. Port `lib/validators/` → Python `services/`
3. Port `lib/lifecycle.ts` → Python `services/lifecycle.py`
4. Replace Postgres trigger activity log with engine middleware
5. Replace Next.js server actions with `fetch()` calls to engine endpoints
6. Deploy engine on Render
7. Add CLI as `/cli` directory in `korakuen-client`

**The schema does not change. The Supabase database does not change.**

FastAPI auto-generates the OpenAPI spec at `/docs`. This becomes the AI agent's map.

---

## Phase 3 — AI Agent on Mac Mini

*Trigger: when Phase 2 engine is stable.*

1. Agent gets a Personal Access Token (PAT) with `role = admin`
2. Agent reads OpenAPI spec to know available endpoints
3. Agent calls engine endpoints — every action is validated and logged
4. Agent identity is visible in `activity_log` for audit

No additional infrastructure needed. The same API the dashboard uses is what the agent uses.

---

## Later

| Feature | Notes |
|---|---|
| SUNAT XML auto-import | Upload XML → auto-populate incoming invoice fields |
| PDF generation | Quotes and invoices as PDFs (not SUNAT e-invoicing) |
| Per-partida budgets | Line-item budget tracking (the Parametric Estimator) |
| Recurring cost templates | For predictable periodic vendor payments |
| Document generation via CLI | Agent generates and registers documents from terminal |
| Retención modeling | 3% withholding on receivables when client is designated retention agent — deferred because rare in Korakuen's current client mix |
| Obligation calendar | Chronological payables/receivables queue — deferred because Korakuen pays vendors upfront and does not extend credit, so the queue is usually empty |
| Price Sentinel | Variance analysis — seeded from historical presupuestos once Phase 1 is stable |
| Parametric Estimator | Recipe-based cost forecasting from project dimensions |

---

*Last updated: April 2026*
