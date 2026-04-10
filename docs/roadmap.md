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
    2: [3, 4, 5],  // sent → partially_paid | paid | void
    3: [4, 5],     // partially_paid → paid | void
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

### Step 4 — Contacts

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

### Step 5 — Bank Accounts

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

### Step 6 — Projects and Partners

Server actions in `app/actions/projects.ts`:

- `getProjects(filters)` — includes partner list
- `createProject(data)`
- `updateProject(id, data)`
- `activateProject(id)` — prospect → active. Validates: contract exists, profit split = 100
- `completeProject(id)` — active → completed
- `getProjectPartners(projectId)`
- `upsertProjectPartner(projectId, data)` — add or update partner split
- `removeProjectPartner(projectId, partnerId)`

**Profit split validation in `validators/projects.ts`:**
```typescript
export function validateProfitSplits(partners: ProjectPartner[]) {
  const sum = partners.reduce((acc, p) => acc + p.profit_split_pct, 0)
  if (Math.abs(sum - 100) > 0.01)
    throw new Error(`Profit splits sum to ${sum}%, must equal 100%`)
}
```

**Commit:** `feat: projects CRUD, lifecycle transitions, partner management`

---

### Step 6.5 — Project Budgets

Server actions in `app/actions/project-budgets.ts`:

- `getProjectBudgets(projectId)` — list budget rows for a project with category names
- `upsertProjectBudget(projectId, categoryId, amountPen, notes?)` — create or
  update a single budget line (uses the unique `(project_id, cost_category_id)`
  constraint to decide insert vs update)
- `removeProjectBudget(projectId, categoryId)` — soft delete
- `getEstimatedCost(projectId)` — returns the derived sum; used by the project
  summary endpoint

Validation lives in `lib/validators/project-budgets.ts`:
- `budgeted_amount_pen >= 0`
- Referenced `cost_category_id` must have `parent_id IS NULL` (top-level only)
- No duplicate `(project_id, cost_category_id)` pairs

**No UI in Phase 1.** Logic and validators only. Budget entry and display are
deferred until later in the UI build — the data foundation exists so the
project summary endpoint can compute expected margin the moment budgets exist.

**Commit:** `feat: project_budgets — schema-backed estimated cost, logic only`

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

### Step 8 — Revenue Documents

Server actions for:

**Outgoing quotes:**
- Full CRUD with line items
- Status transitions: draft → sent → approved | rejected | expired
- Line item immutability enforced in `validators/quotes.ts`
- Header totals recomputed after every line item mutation

**Outgoing invoices:**
- Full CRUD with line items
- Status: draft → sent → partially_paid → paid | void
- Status auto-updates when allocations change
- `_computed` outstanding breakdown: `paid_regular`, `paid_bn`, `outstanding_regular`,
  `outstanding_bn`, `is_fully_paid`
- SUNAT XML validation in `validators/invoices.ts`

**Commit:** `feat: revenue documents — quotes, outgoing invoices with line items`

---

### Step 9 — Cost Documents

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

**Outgoing invoice status auto-updates** from payment line mutations
(`sent → partially_paid → paid`). **Incoming invoices do NOT auto-update** —
their `factura_status` is independent of payment progress, and payment state
is always derived at query time. See `api-design-principles.md` → "Formulas"
for the canonical incoming invoice payment progress computation.

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
