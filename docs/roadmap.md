# Korakuen — Build Roadmap

> Build order follows the three-phase architecture defined in `architecture.md`.
> The schema is fixed from day one. The application layer evolves in phases.
>
> Full specs: `architecture.md` · `api-design-principles.md` · `schema-reference.md` · `domain-model.md`

---

## Phase 1 — 2-Tier: Next.js → Supabase

*One repository. One language. Get the system working.*

The goal is a fully functional management system as fast as possible. Business logic
lives in `lib/validators/` and `lib/lifecycle.ts`. The activity log is handled by a
Postgres trigger. Server actions are written API-shaped from the start — thin, with
all validation centralized — so migrating to FastAPI later is a lift-and-shift, not
a rewrite.

---

### Step 0 — Setup

**Create 1 private GitHub repository:** `korakuen`

**Create 2 Supabase projects:**
- `korakuen-dev` — for all development. Never develop against prod.
- `korakuen-prod` — production only.

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

### Step 1 — Database Schema

Run migrations in the Supabase SQL editor (`korakuen-dev`) in this order:

1. Extensions: `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`
2. Infrastructure: `users`, `exchange_rates`, `activity_log`
3. Core: `contacts`, `bank_accounts`
4. Projects: `projects`, `project_partners`
5. Revenue: `outgoing_quotes`, `outgoing_quote_line_items`, `contracts`,
   `outgoing_invoices`, `outgoing_invoice_line_items`
6. Costs: `incoming_quotes`, `incoming_quote_line_items`,
   `incoming_invoices`, `incoming_invoice_line_items`
7. Cash: `transactions`, `payment_invoice_allocations`
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
-- transactions, payment_invoice_allocations, contracts, projects
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

### Step 2 — Project Structure

Create the core `lib/` structure before writing any server actions:

```
lib/
  db.ts              — Supabase client (server-side and client-side)
  lifecycle.ts       — status transition rules for all document types
  validators/
    contacts.ts      — RUC/DNI format, SUNAT verification flow
    invoices.ts      — totals consistency, IGV validation, SUNAT XML
    transactions.ts  — BN account rules, detraction consistency, over-allocation
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

### Step 3 — Auth

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
- `archiveBankAccount(id)` — blocks if transactions exist

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

### Step 7 — Exchange Rate Job

The `fetch_exchange_rates.py` script already exists (see `jobs/` directory).

**Deploy on Render as a Cron Job:**
- Build command: `pip install httpx psycopg2-binary python-dotenv`
- Run command: `python fetch_exchange_rates.py`
- Schedule: `0 14 * * 1-5` (09:00 Lima time, weekdays)
- Environment variable: `SUPABASE_DB_URL`

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

**Contracts:**
- Create (from quote or direct), read, update
- `getContractSummary(id)` — total value, total invoiced, remaining

**Outgoing invoices:**
- Full CRUD with line items
- Status: draft → sent → partially_paid → paid | void
- Status auto-updates when allocations change
- `_computed` outstanding breakdown: `paid_regular`, `paid_bn`, `outstanding_regular`,
  `outstanding_bn`, `is_fully_paid`
- SUNAT XML validation in `validators/invoices.ts`

**Commit:** `feat: revenue documents — quotes, contracts, outgoing invoices with line items`

---

### Step 9 — Cost Documents

Server actions for:

**Incoming quotes:**
- Full CRUD with line items
- Status: draft → approved | cancelled
- Line items locked on approval

**Incoming invoices:**
- Full CRUD (header-only or with line items)
- Status auto-updated by allocation engine: unmatched → partially_matched → matched
- `incoming_quote_id` linkable after the fact
- SUNAT XML fields extracted and stored on registration

**Commit:** `feat: cost documents — incoming quotes, incoming invoices with line items`

---

### Step 10 — Transactions and Allocations

Server actions for:

**Transactions:**
- `getTransactions(filters)` — all filters from schema (project, account, direction,
  contact, date range, reconciled, type)
- `createTransaction(data)` — validates BN rules, detraction consistency,
  computes `amount_pen`
- `updateTransaction(id, data)` — blocked if reconciled
- `deleteTransaction(id)` — soft delete, blocked if reconciled

**Payment allocations:**
- `getEligiblePayments(invoiceId, invoiceType)` — filtered list of transactions
  eligible to allocate to this invoice (same contact or no contact, unallocated balance > 0)
- `allocatePayment(transactionId, invoiceId, invoiceType, amount)` — validates
  amount doesn't exceed available balance or invoice outstanding
- `deallocatePayment(allocationId)` — blocked if invoice is matched

**Allocation auto-updates invoice status** after every create/delete.

**Commit:** `feat: transactions CRUD, payment allocations, eligible payment filter`

---

### Step 11 — Bank Reconciliation

- `getUnreconciled(bankAccountId)` — transactions with `reconciled = false`
- `reconcileTransaction(id, bankReference)` — marks reconciled
- `unreconcileTransaction(id)` — reverts
- `reconcileGroup(groupId, bankReference)` — reconciles all transactions in a
  `reconciliation_group_id` atomically

**Commit:** `feat: bank reconciliation`

---

### Step 12 — Reporting

Server actions / route handlers for:

- `getProjectSummary(projectId)` — contract value, invoiced, collected, costs,
  gross profit, per-partner breakdown
- `getIgvPosition(periodStart, periodEnd)` — igv_output, igv_input, net_igv
- `getCashPosition()` — all accounts with balance, grouped by type
- `getOutstandingReceivables()` — unpaid outgoing invoices with breakdown
- `getOutstandingPayables()` — unmatched incoming invoices + quotes without invoices
- `getSettlement(projectId)` — per-partner costs + profit share

**Commit:** `feat: core reporting — project summary, IGV, cash position, settlement`

---

### Step 13 — Dashboard UI and Partner Views

Priority order:

1. Auth flow and role-based layout
2. Projects list with status indicators and financial summary
3. Project detail — contract, invoice list, transaction list, settlement
4. New outgoing invoice form (with line items)
5. New transaction form (with eligible payment matching)
6. Bank reconciliation queue UI
7. Reports: cash position, IGV, outstanding receivables
8. Partner view — restricted to assigned projects, their costs, their profit share
9. Exchange rate alert banner (from health endpoint)

**Commit:** `feat: dashboard UI — admin and partner views`

---

### Step 14 — Submissions (Scan App Staging)

- Submissions table UI for admin — review queue, approve/reject
- Partner submission form — upload image/PDF/XML, review extracted data
- Approval flow — engine promotes to `incoming_invoices` or `transactions`

**Commit:** `feat: submissions — staging workflow for partner scan uploads`

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
| Budget vs actual | Per-partida cost tracking against budgeted amounts |
| Recurring cost templates | For predictable periodic vendor payments |
| Document generation via CLI | Agent generates and registers documents from terminal |

---

*Last updated: April 2026*
