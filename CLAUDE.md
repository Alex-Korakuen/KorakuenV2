# CLAUDE.md — Korakuen V2

This file is the entry point for Claude Code. Read this first, then read the specific document relevant to your current task before writing any code.

---

## What This System Is

A private business management system for **Korakuen** (Constructora Korakuen E.I.R.L.), a small Peruvian construction company. Three partner companies collaborate on civil works projects. The system tracks projects, revenue/cost documents, cash movements, partner profit splits, and Peruvian tax obligations.

**This is V2** — a ground-up rebuild replacing V1 (which ran in production since February 2026). The database schema is redesigned based on lessons learned. See `docs/lessons-from-v1.md` for what changed and why.

---

## Core Principle

**The database is the product. The website is how data gets in and out.**
**The schema is the contract. The application layer is replaceable.**

---

## Technology Stack (Phase 1)

| Layer | Tool |
|---|---|
| Database | PostgreSQL on Supabase |
| Website | Next.js + TypeScript on Vercel |
| File storage | Google Drive (URLs stored in DB) |
| Exchange rate job | Python cron job on Render |
| Package manager | npm |

---

## Repository Structure

```
korakuen_v2/
  app/
    (admin)/              — admin-only routes
    (partner)/            — partner-restricted routes
    api/                  — route handlers (webhooks, health)
    actions/              — server actions (API-shaped, thin)
  components/             — reusable UI components
  lib/
    validators/           — all validation logic, one file per domain
    lifecycle.ts          — status transition rules for all document types
    db.ts                 — Supabase client
    exchange-rate.ts      — rate lookup helper
    sunat.ts              — decolecta API wrapper (RUC/DNI lookup)
  jobs/
    fetch_exchange_rates.py — daily SUNAT rate cron job
  supabase/
    migrations/           — timestamped SQL migration files
    triggers/             — activity_log trigger SQL
  docs/                   — all design documentation
```

---

## Database — Key Tables

```
Infrastructure:  users, exchange_rates, activity_log
Core:            contacts, bank_accounts, cost_categories
Projects:        projects, project_partners
Revenue:         outgoing_quotes, outgoing_quote_line_items,
                 outgoing_invoices, outgoing_invoice_line_items
Costs:           incoming_quotes, incoming_quote_line_items,
                 incoming_invoices, incoming_invoice_line_items
Cash:            payments, payment_lines
Loans:           loans, loan_schedule
Staging:         submissions
```

**Never add, remove, or modify tables without reading `docs/schema-reference.md` first and getting explicit approval.**

---

## Critical Business Rules

- **Peruvian tax:** IGV (18%), detraccion (varies %), retencion (3% on receivable only)
- **Separate document tables:** outgoing vs incoming invoices/quotes are separate tables (V1 unified them — it was a mistake)
- **Payment header + lines:** One payment = one bank statement entry. Payment lines say what the money was for
- **Contacts must be SUNAT-verified:** No manual contact creation. RUC/DNI lookup via decolecta API is mandatory
- **No stored balances:** Outstanding amounts, bank balances, partner profit shares — all derived at query time
- **Amounts in original currency + PEN equivalent:** Every monetary record has `amount` + `currency` + `amount_pen`
- **Soft deletes everywhere:** `deleted_at` on all mutable tables. Never hard-delete financial records
- **Activity log is automatic:** Postgres trigger logs every mutation to financial tables
- **Status transitions are centralized:** `lib/lifecycle.ts` is the single source of truth
- **Server actions are API-shaped:** Thin, centralized validation, no inline business logic

---

## Document Map

| Task | Read First |
|---|---|
| Any database work | `docs/schema-reference.md` |
| Understanding business domain | `docs/domain-model.md` |
| Understanding architecture / phases | `docs/architecture.md` |
| API conventions and design rules | `docs/api-design-principles.md` |
| Knowing what to build next | `docs/roadmap.md` |
| Understanding V1 decisions | `docs/lessons-from-v1.md` |

---

## Behavior Rules for Claude Code

### Always do:
- Read the relevant document before starting any task
- Discuss approach before writing code
- Follow snake_case naming for all tables, columns, API params, JSON keys
- Show a summary and ask for confirmation before any database mutation
- Write server actions API-shaped: thin, with validation in `lib/validators/`

### Never do without explicit approval:
- Modify the database schema
- Drop or truncate any table
- Edit migration files that have already been applied
- Add external dependencies without discussion
- Push to `main` branch
- Store credentials in any committed file
- Convert currency amounts at storage time
- Put business logic directly in components or server actions

### When in doubt:
- Ask before building
- Refer to `docs/schema-reference.md` — it is the source of truth
- Prefer simpler solutions over clever ones
- If a task conflicts with a documented decision, raise it before proceeding

---

## Peruvian Context Glossary

| Term | Meaning |
|---|---|
| IGV | Impuesto General a las Ventas — Peru's 18% VAT |
| Detraccion | SPOT system — client withholds % and deposits to supplier's Banco de la Nacion account |
| Retencion | Client withholds 3% and pays to SUNAT — only when client is a designated retention agent |
| Banco de la Nacion | State bank — receives detraccion deposits, balance usable only for tax payments |
| Factura | VAT invoice between registered businesses — gives IGV credit |
| Boleta | Consumer receipt — no IGV credit |
| Recibo por Honorarios | Invoice for professional services by individuals |
| RUC | 11-digit Peruvian company tax ID |
| DNI | 8-digit Peruvian personal ID |
| OxI | Obras por Impuesto — Law 29230, private companies execute public works for tax credits |
| SUNAT | Peru's tax authority |

---

## Current Status

**Phase 1 — Setup.** Repository initialized. Schema and documentation finalized. Next: deploy schema to Supabase, initialize Next.js, build the first server actions.

---

*This file is updated when major phases complete or the stack changes. All detailed decisions live in the docs/ files.*
