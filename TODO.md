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

### Step 7 — Exchange Rate Job
- [ ] Deploy `fetch_exchange_rates.py` on Render cron
- [ ] Health endpoint (`/api/health`)
- [ ] Dashboard exchange rate alert banner

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
