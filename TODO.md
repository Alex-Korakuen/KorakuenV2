# Korakuen V2 — Deployment Plan

## Pending — Design decisions from April 2026 audit

> A full audit of the codebase and docs against `docs/north-star.md` surfaced
> a set of schema gaps and code drifts. All decisions are final; docs have been
> updated to reflect the target state. The items below are the execution work
> that still needs to land. Execute as four commits in order — each commit is
> self-contained and reviewable.
>
> Related docs: `docs/schema-reference.md` (target schema), `docs/domain-model.md`
> (four invoice arrival flows + new incoming invoice model), `docs/api-design-principles.md`
> ("Formulas" section), `docs/roadmap.md` (Step 6.5, Step 9 updates, Step 11 simplified,
> Step 12 consolidated), `docs/north-star.md` ("Schema gaps identified" section).

### Prerequisite check

- [ ] Confirm `incoming_invoices` table is empty in prod before running the
      column rename + SUNAT nullability migration. If rows exist, the migration
      must map old values safely: `unmatched | partially_matched | matched`
      → `factura_status = 2 (received)` (all old rows had a factura).

### Commit 1 — schema migration

Single new migration file under `supabase/migrations/`. All changes are additive
or rename operations; no destructive changes.

- [ ] `cost_categories`: add `parent_id uuid REFERENCES cost_categories(id)`,
      nullable. Drop the existing `UNIQUE (name)` constraint if present and
      replace with `UNIQUE (parent_id, name)` (uniqueness scoped to a branch)
- [ ] `projects`: no column change; only the status enum gains value
      `5 = rejected` (enforced via CHECK constraint on the smallint column,
      or just update the app-level enum — the DB already accepts any smallint)
- [ ] `incoming_invoice_line_items`: add
      `cost_category_id uuid REFERENCES cost_categories(id)`, nullable
- [ ] `incoming_invoices`:
  - [ ] Rename column `status` → `factura_status`
  - [ ] Change semantics: new enum `1 = expected, 2 = received` (was
        `1 = unmatched, 2 = partially_matched, 3 = matched`)
  - [ ] Data migration: any existing row gets `factura_status = 2 (received)`
        (all existing rows by definition had a factura)
  - [ ] Make the following columns NULLABLE: `serie_numero`, `fecha_emision`,
        `tipo_documento_code`, `ruc_emisor`, `ruc_receptor`, `hash_cdr`,
        `estado_sunat`, `pdf_url`, `xml_url`, `drive_file_id`, `factura_number`
  - [ ] Add constraint `ii_received_requires_sunat`: when
        `factura_status = 2`, all of `serie_numero`, `fecha_emision`,
        `tipo_documento_code`, `ruc_emisor`, `ruc_receptor` must be NOT NULL
- [ ] New table `project_budgets`:
      `id, project_id, cost_category_id, budgeted_amount_pen, notes,
      created_at, updated_at, deleted_at`. Unique `(project_id, cost_category_id)`.
      Check `budgeted_amount_pen >= 0`. Full definition in `schema-reference.md`.
- [ ] Activity log trigger: attach to `project_budgets` so mutations are logged
- [ ] New SQL helper function `get_incoming_invoice_payment_progress(invoice_id)`
      returning `{total_pen, paid, outstanding, payment_state}`. Used by server
      actions to avoid reimplementing the math per query.

**Commit message:** `feat: schema — factura_status, project_budgets, cost_categories hierarchy, rejected status`

### Commit 2 — TypeScript types and lifecycle rules

- [ ] `lib/types.ts`:
  - [ ] Replace `INCOMING_INVOICE_STATUS` with `INCOMING_INVOICE_FACTURA_STATUS`
        (values: `expected = 1, received = 2`). Update all imports.
  - [ ] Add `rejected = 5` to `PROJECT_STATUS`
  - [ ] Update any shape types that include the old incoming invoice status
- [ ] `lib/lifecycle.ts`:
  - [ ] Remove old `incoming_invoice` transitions (`unmatched → matched`, etc.)
  - [ ] Add `incoming_invoice.factura_status` transition: `expected → received`
        (one-way). On transition to `received`, require SUNAT fields present —
        this check belongs in the validator, but the lifecycle rule documents it.
  - [ ] Add `project.status` transitions: `prospect → rejected`, `active → rejected`
- [ ] Grep for any file importing the removed `INCOMING_INVOICE_STATUS` enum and
      update each site. Expected: nothing yet (CRUD for incoming invoices isn't
      built), but verify.

**Commit message:** `feat: types — factura_status enum, rejected project status, lifecycle rules`

### Commit 3 — validators and action cleanup

- [ ] New file `lib/validators/project-budgets.ts`:
  - [ ] `validateCreateProjectBudget(data)` — amount ≥ 0, cost_category_id
        references a row with `parent_id IS NULL`, no existing row for the
        same `(project_id, cost_category_id)` pair
  - [ ] `validateUpdateProjectBudget(data)` — same rules
- [ ] `lib/validators/incoming-invoices.ts`:
  - [ ] `validateFacturaStatusTransition(from, to, data)` — enforce
        `expected → received` only; on `received`, require all SUNAT fields
  - [ ] Update any existing validators that referenced the old status vocabulary
- [ ] New file (or section) `lib/validators/project-partners.ts`:
  - [ ] Extract the inline validation currently at
        `app/actions/project-partners.ts:54-60` into
        `validateProjectPartnerInput(data)`
- [ ] `app/actions/project-partners.ts`:
  - [ ] Replace the inline validation block with a call to
        `validateProjectPartnerInput`

**Commit message:** `refactor: validators — extract project-partners, add project-budgets, update incoming invoices`

### Commit 4 — server actions for project_budgets

- [ ] New file `app/actions/project-budgets.ts` with the API-shaped surface from
      `docs/roadmap.md` Step 6.5:
  - [ ] `getProjectBudgets(projectId)`
  - [ ] `upsertProjectBudget(projectId, categoryId, amountPen, notes?)`
  - [ ] `removeProjectBudget(projectId, categoryId)` (soft delete)
  - [ ] `getEstimatedCost(projectId)` (returns the derived sum)
- [ ] No UI work — logic only, per Alex's instruction. The data foundation
      needs to exist so the project summary endpoint can include estimated cost
      and margin the moment budgets are entered.

**Commit message:** `feat: project_budgets server actions`

### Out of scope for this sequence

Decided in the same session but requiring no code changes — already landed as
doc edits:

- Retención fields on outgoing_invoices — deferred indefinitely (rare in
  Korakuen's client mix). Noted in `roadmap.md` "Later" table and `north-star.md`.
- Obligation calendar — deferred indefinitely (Korakuen pays vendors upfront,
  no credit terms). Noted in `schema-reference.md`, `roadmap.md`, `north-star.md`.
- IGV position dashboard — consolidated into the new "Financial Position" view
  in `roadmap.md` Step 12.
- `reconcileGroup` — dropped from `roadmap.md` Step 11, no schema change.
- Four invoice arrival flows — documented in `domain-model.md`.
- Settlement formula and all other derived calculations — consolidated in
  `api-design-principles.md` under the new "Formulas" section.

---

## Phase 1 Build Order

Based on `docs/roadmap.md` and lessons from V1. Each step produces a deployable increment.

---

### Step 0 — Infrastructure Setup
- [ ] Create Supabase project: `korakuen-v2-dev` (development)
- [ ] Create Supabase project: `korakuen-v2-prod` (production — later)
- [ ] Fill `.env.local` with Supabase dev credentials
- [ ] Initialize Next.js: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`
- [ ] Install deps: `npm install @supabase/supabase-js @supabase/ssr`
- [ ] Connect Vercel to GitHub repo (auto-deploy on push to main)
- [ ] Register decolecta API token at apis.net.pe
- [ ] First commit + push

### Step 1 — Database Schema
- [ ] Deploy migrations to Supabase dev in order (see `docs/roadmap.md` Step 1):
  1. Extensions (pgcrypto)
  2. Infrastructure: `users`, `exchange_rates`, `activity_log`
  3. Core: `contacts`, `bank_accounts`, `cost_categories`
  4. Projects: `projects`, `project_partners`
  5. Revenue: `outgoing_quotes` + line items, `outgoing_invoices` + line items
  6. Costs: `incoming_quotes` + line items, `incoming_invoices` + line items
  7. Cash: `payments`, `payment_lines`
  8. Loans: `loans`, `loan_schedule`
  9. Staging: `submissions`
  10. All indexes
  11. Activity log trigger
  12. RLS policies
- [ ] Verify all tables in Supabase dashboard
- [ ] Verify activity log trigger fires on test insert

### Step 2 — Project Structure (lib/)
- [ ] `lib/db.ts` — Supabase client (server + client)
- [ ] `lib/lifecycle.ts` — status transition rules
- [ ] `lib/validators/` — one file per domain (contacts, invoices, transactions, projects, quotes)
- [ ] `lib/sunat.ts` — decolecta API wrapper
- [ ] `lib/exchange-rate.ts` — rate lookup helper

### Step 3 — Auth
- [ ] Supabase Auth setup (email/password)
- [ ] `middleware.ts` — session refresh
- [ ] Login page
- [ ] `lib/auth.ts` — get current user + role
- [ ] Admin vs Partner route protection

### Step 4 — Contacts CRUD
- [ ] `lookupContact` (decolecta API)
- [ ] `createContact` (SUNAT-verified only)
- [ ] `updateContact` (editable fields only)
- [ ] `deleteContact` (soft delete)
- [ ] Contacts list page

### Step 5 — Bank Accounts
- [ ] CRUD with derived balance
- [ ] Bank accounts list page

### Step 6 — Projects + Partners
- [ ] Project CRUD with lifecycle transitions
- [ ] Partner management with profit split validation
- [ ] Projects list + detail pages

### Step 7 — Exchange Rate Job ✅
- [x] Vercel Cron route (`/api/cron/fetch-exchange-rates`) fetching from BCRP
- [x] `lib/bcrp.ts` helper with date-shift logic
- [x] Health endpoint (`/api/health`)
- [x] Dashboard exchange rate alert banner

### Step 8 — Revenue Documents
- [ ] Outgoing quotes CRUD + line items
- [ ] Outgoing invoices CRUD + line items
- [ ] Status auto-update on payment allocation

### Step 9 — Cost Documents
- [ ] Incoming quotes CRUD + line items
- [ ] Incoming invoices CRUD + line items

### Step 10 — Payments + Payment Lines
- [ ] Payments CRUD (header + lines)
- [ ] Payment line allocation to invoices
- [ ] Invoice status auto-update
- [ ] Bank account balance derivation

### Step 11 — Bank Reconciliation
- [ ] Reconciliation workflow

### Step 12 — Reporting
- [ ] Project summary (contract value, invoiced, collected, costs, profit)
- [ ] IGV position
- [ ] Cash position
- [ ] Settlement per partner

### Step 13 — Dashboard UI
- [ ] Admin dashboard
- [ ] Partner dashboard (restricted views)

### Step 14 — Submissions (scan staging)
- [ ] Submission review queue
- [ ] Partner upload form
- [ ] Approval → promote to main tables

---

## First Milestone Target

**Steps 0-3 deployed** = authenticated login with empty dashboard connected to a fully schemaed database. This validates the entire infrastructure pipeline (GitHub → Vercel → Supabase) before building any business features.

---

## Immediate Next Actions

1. Create Supabase `korakuen-v2-dev` project
2. Run `npx create-next-app` inside this repo
3. Write and apply the first migration (extensions + infrastructure tables)
4. Deploy to Vercel

---

## Deferred Deployment Tasks

> Code is ready but the operational/Vercel-side setup is deferred until we
> start working on UI and production deployment. Track here so nothing slips.

- [ ] **Step 7 — `CRON_SECRET` on Vercel.** Generate a fresh random value
      (`openssl rand -base64 32`) and set it under
      Vercel → Project → Settings → Environment Variables for both Preview
      and Production. The cron route at `/api/cron/fetch-exchange-rates`
      already enforces it; without this env var the route returns 401 and
      the daily exchange rate fetch will silently fail in production.
