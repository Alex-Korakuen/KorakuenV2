# Korakuen V2 — Deployment Plan

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

### Step 6.5 — Schema Delta + Project Budgets
> Unblocks Step 9 (Cost Documents), Step 10 (Payments), and the project summary
> in Step 12. Full spec in `docs/roadmap.md`. Four sub-commits in strict order —
> running 6.5a and 6.5b out of order creates a "broken middle" where TypeScript
> types disagree with the database.

- [ ] **Prerequisite:** verify `incoming_invoices` is empty in prod; if rows
      exist, map `unmatched | partially_matched | matched → factura_status = 2`
- [ ] **6.5a — Schema migration.** Single new migration file covering:
      `cost_categories.parent_id`, `projects.status = 5 (rejected)`,
      `incoming_invoice_line_items.cost_category_id`,
      rename `incoming_invoices.status → factura_status` with new two-value
      enum, nullable SUNAT fields, `ii_received_requires_sunat` check constraint,
      new `project_budgets` table, activity log trigger on `project_budgets`,
      new `get_incoming_invoice_payment_progress` SQL helper
- [ ] **6.5b — TypeScript types and lifecycle.** Replace
      `INCOMING_INVOICE_STATUS` with `INCOMING_INVOICE_FACTURA_STATUS`, add
      `rejected = 5` to `PROJECT_STATUS`, update `lib/lifecycle.ts` with
      `expected → received` and `prospect/active → rejected` transitions
- [ ] **6.5c — Validators and validator-debt cleanup.** New
      `lib/validators/project-budgets.ts`, update
      `lib/validators/incoming-invoices.ts` with
      `validateFacturaStatusTransition`, extract inline validation from
      `app/actions/project-partners.ts:54-60` into a new
      `lib/validators/project-partners.ts` (retrofit of Step 6)
- [ ] **6.5d — Project Budgets server actions.** New
      `app/actions/project-budgets.ts` with `getProjectBudgets`,
      `upsertProjectBudget`, `removeProjectBudget`, `getEstimatedCost`.
      Logic only, no UI.

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
