# Korakuen — System Architecture

> This document defines the repository structure, technology stack, deployment targets,
> build phases, and non-negotiable architectural principles for the Korakuen business
> management system.
>
> Related: `api-design-principles.md` · `schema-reference.md` · `domain-model.md` · `roadmap.md`

---

## What This System Is

A private business management system for Korakuen (Constructora Korakuen E.I.R.L.) and its
joint venture partners. Not a SaaS product. Designed for three users: the managing partner
(Admin) and two civil engineer partners (Partner role), each operating their own independent
company but sharing project economics.

The system tracks:
- Projects and their full financial lifecycle (prospect → active → completed)
- Revenue documents: outgoing quotes, contracts, outgoing invoices to clients
- Cost documents: incoming quotes, incoming invoices from vendors
- All cash movements: inbound and outbound, across multiple bank accounts
- Partner cost contributions and profit split calculations
- Peruvian tax obligations: IGV position, detracciones, SUNAT document metadata
- Bank reconciliation: matching recorded payments to bank statement entries

---

## Build Phases

The system is built in three phases. The **schema does not change between phases** —
it is designed correctly from the start. Only the application layer evolves.

### Phase 1 — 2-Tier: Next.js → Supabase (Build now)

```
Browser → Next.js (server actions) → Supabase (Postgres)
```

**One repository. One language. Proper patterns. Built to last.**

Business logic lives in `lib/validators/` and `lib/lifecycle.ts`. The activity log
is written by a Postgres trigger — zero application code needed. Server actions are
written API-shaped from the start: thin, centralized validation, no inline business
logic scattered across components.

**What this enables:** Admin dashboard, partner dashboard, SUNAT XML upload,
exchange rate fetch job, RUC/DNI lookup.

**What this defers:** CLI, AI agent, partner scan-and-upload app.

### Phase 2 — 3-Tier: Next.js → FastAPI → Supabase (Add when needed)

```
Browser → Next.js (API client) → FastAPI (engine) → Supabase (Postgres)
CLI    → FastAPI (engine) → Supabase (Postgres)
```

**FastAPI engine added between Next.js and Supabase.**

Server actions become API clients. Business logic migrates from `lib/` TypeScript
files to Python services. FastAPI auto-generates an OpenAPI spec. CLI is built as
a thin Python wrapper over engine endpoints.

**Trigger for this phase:** When CLI or AI agent access is needed.

**Migration cost is low** because Phase 1 server actions are already API-shaped —
the logic is isolated and ready to move. The schema is untouched.

### Phase 3 — AI Agent on Mac Mini (Add when engine is stable)

```
AI Agent (Claude/MCP) → FastAPI (engine) → Supabase (Postgres)
```

An AI agent running on a local Mac Mini calls the same FastAPI endpoints as the
dashboard and CLI. The agent reads the OpenAPI spec to know what endpoints exist,
what parameters they take, and what responses to expect.

**Why the API layer is required for the agent:**
- Direct Supabase access bypasses all business rules, status lifecycles, and immutability
- The API layer is the safety boundary — the agent cannot corrupt data
- Every agent action is captured in the activity log with its own identity
- The agent gets its own auth token with defined permissions
- The OpenAPI spec is the agent's map — it knows exactly what it can do

---

## Repository Structure

### Phase 1: One repository

```
korakuen/
  app/                        — Next.js app directory
    (admin)/                  — admin-only routes
    (partner)/                — partner-restricted routes
    api/                      — route handlers (if needed for webhooks etc.)
  components/
  lib/
    validators/               — all validation logic, one file per domain
      invoices.ts
      payments.ts
      contacts.ts
      ...
    lifecycle.ts              — status transition rules for all document types
    db.ts                     — Supabase client
    exchange-rate.ts          — rate lookup helper
    sunat.ts                  — decolecta API wrapper (RUC/DNI lookup)
  jobs/
    fetch_exchange_rates.py   — daily SUNAT rate cron job (Python, runs on Render)
  supabase/
    migrations/               — all schema migrations
    triggers/                 — activity_log trigger SQL
  .env.local                  — gitignored
  package.json
```

### Phase 2: Two repositories

```
korakuen-engine/              — Python FastAPI
  app/
    main.py
    routers/                  — one file per resource group
    services/                 — business logic (migrated from lib/)
    models/                   — Pydantic schemas
    db/
  jobs/
    fetch_exchange_rates.py
  tests/
  requirements.txt

korakuen-client/              — Next.js + CLI
  app/                        — dashboard (server actions replaced by API calls)
  lib/
    api-client.ts             — HTTP client wrapping engine endpoints
  cli/
    korakuen/                 — Python Typer CLI
      commands/
      client.py               — thin HTTP client over engine API
  package.json
  requirements-cli.txt
```

---

## Infrastructure

### Phase 1

| Component | Service | Notes |
|---|---|---|
| Database | Supabase (Postgres) | Single source of truth. RLS on all tables. |
| Dashboard | Vercel | Next.js. Free tier sufficient for 3 users. |
| File storage | Google Drive | Invoices, quotes, payment receipts. URLs stored in DB. |
| Exchange rate job | Render Cron Job (free) | `fetch_exchange_rates.py` — weekdays 09:00 Lima. |
| Activity log | Postgres trigger | Automatic. Zero application code. |

### Phase 2 additions

| Component | Service | Notes |
|---|---|---|
| Engine | Render | Stateless FastAPI. $7/mo minimum for always-on. |
| CLI | Local machine (Mac Mini) | No deployment. Runs from terminal. |
| Drive agent | Mac Mini | Watches inbox folder, classifies files, calls engine |

### External APIs (both phases)

| Service | Purpose | Provider | Auth |
|---|---|---|---|
| SUNAT XML endpoint | Daily USD/PEN exchange rate | SUNAT (official, free) | None |
| RUC/DNI lookup | Contact auto-fill from SUNAT padrón | apis.net.pe (decolecta) | Bearer token |
| Google Drive API | File storage and inbox watching | Google | OAuth2 / Service Account |

---

## File Storage — Google Drive

All document files (invoices, quotes, payment receipts, XML files) are stored in
Google Drive. The database stores the Google Drive file ID and URL — it never stores
the file itself.

**Why Google Drive over Supabase Storage:**
- Files are accessible directly by partners and the accountant without logging into the system
- Natural folder structure per project
- Already where most Peruvian construction operations keep documents

**Folder structure:**
```
Korakuen/
  _Inbox/                        ← drop zone for unprocessed files
  PRY001 — [Project Name]/
    Facturas Emitidas/
    Facturas Recibidas/
    Cotizaciones/
    Comprobantes de Pago/
  PRY002 — [Project Name]/
    ...
```

**What the database stores per document:**
```sql
drive_file_id   text    -- Google Drive file ID (never changes even if file is moved/renamed)
pdf_url         text    -- shareable Drive URL (for display in dashboard)
```

The `drive_file_id` is stored separately from the URL because Drive URLs can be
regenerated from the file ID at any time, making the record resilient to permission
changes or URL format updates.

### Phase 1 — Manual URL entry

In Phase 1, there is no automated Drive integration. The workflow is:

```
1. Upload the file manually to the correct Drive folder
2. Copy the shareable link
3. Paste it into the dashboard when registering the document
```

Simple. No API calls, no OAuth setup, no complexity. The `drive_file_id` field can
be left empty in Phase 1 — only the URL is required for the dashboard to render a
"View Document" link.

### Phase 3 — AI Agent inbox workflow

When the AI agent is running on the Mac Mini:

```
You / partners drop files into Drive "_Inbox/" folder
  → Agent detects new file via Drive API polling
    → Agent reads the file (OCR / Claude document parsing)
      → Agent classifies: invoice | quote | receipt | unknown
        → Agent extracts key fields (RUC, total, date, serie_numero, project)
          → Agent moves file to correct project folder in Drive
            → Agent calls POST /submissions (or POST /incoming-invoices directly)
              with extracted fields + drive_file_id + pdf_url
                → Record appears in the system
                  → You review and confirm (or agent proceeds directly if trusted)
```

The `submissions` table is the staging area for agent-processed documents — the same
table used for partner scan uploads. The agent creates a submission with `confidence`
scores on each extracted field. Low-confidence fields are highlighted in the review UI.

**Agent stack (Mac Mini):**
```python
# Core dependencies
google-api-python-client   — Drive API (watch inbox, move files, get file IDs)
anthropic                  — Document parsing and field extraction
httpx                      — Call FastAPI engine endpoints
```

The agent reads the FastAPI OpenAPI spec to know exactly what endpoints are available
and what fields each one expects. This is the primary reason for building FastAPI in
Phase 2 — the spec is the agent's contract with the system.

---

## Environment Variables

### Phase 1 (Next.js)

```
NEXT_PUBLIC_SUPABASE_URL      — Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon key (public)
SUPABASE_SERVICE_ROLE_KEY     — Service role key (server-side only, never exposed)
SUPABASE_DB_URL               — Direct Postgres connection (for cron job)
DECOLECTA_TOKEN               — RUC/DNI lookup API key
```

### Phase 2 additions (FastAPI engine)

```
SUPABASE_JWT_SECRET           — JWT validation secret
DECOLECTA_TOKEN               — Same key, now lives in engine env only
```

---

## Authentication

### Phase 1

Authentication is delegated to Supabase Auth. Server actions verify the session
server-side. Supabase RLS is the final safety layer — partners can only access
rows for projects they are assigned to, enforced at the database level.

Role is stored on the `users` table (`1=admin, 2=partner`). Server actions check
role before executing privileged operations.

### Phase 2

FastAPI validates Supabase JWTs. The engine extracts `user_id` and `role` from
the verified payload and passes them to all downstream logic. Same RLS policies
remain active in Supabase — defense in depth.

**AI agent auth:** The agent gets a Personal Access Token (PAT) generated from the
dashboard. The engine treats a PAT identically to a Supabase JWT. The agent's PAT
has a defined role (`admin`) and is revocable. Every action the agent takes is
captured in the activity log under its own identity.

---

## The One Rule That Never Changes

**The schema is the contract. The application layer is replaceable.**

Every decision in `schema-reference.md` — the table structure, the constraints, the
status lifecycles, the allocation model — is valid across all three phases. Phase 1
enforces these rules in TypeScript. Phase 2 enforces them in Python. Phase 3 enforces
them via API guardrails. The rules themselves never change.

This means the work done in Phase 1 is never wasted. It is the foundation.

---

## Core Architectural Principles

These apply regardless of phase.

### 1. Business logic is centralized

Phase 1: all validation and lifecycle logic lives in `lib/validators/` and
`lib/lifecycle.ts`. No inline business logic in components or server actions.

Phase 2: the same logic migrates to Python services. The centralization discipline
from Phase 1 makes migration straightforward.

The rule in both phases: **if a computation needs to happen, it happens in one place.**

### 2. No offline-first, no sync complexity

Three users on reliable internet. Reload is acceptable. No sync tokens, no version
columns for delta sync, no client-side conflict resolution. Every response reflects
current database state.

### 3. The database is the source of truth for balances

No balance, outstanding amount, or financial position is stored as a column if it
can be derived from payments. Bank account balances, invoice outstanding amounts,
partner profit shares — all derived at query time. Storing derived values creates
inconsistency risk with no arbiter.

The only exception: amounts agreed at document creation time (contract value, invoice
subtotal, IGV amount, detraction amount) are stored because they reflect a point-in-time
agreement, not a running computation.

### 4. Soft deletes everywhere, hard deletes never

All mutable tables carry `deleted_at`. Financial records are never hard-deleted.
Corrections are made by voiding and reissuing — the original record is preserved.

### 5. Activity log is a correctness requirement

Every mutation to every financial table produces an immutable row in `activity_log`.
In Phase 1 this is a Postgres trigger. In Phase 2 it is engine middleware. Either way
it is automatic and cannot be bypassed.

### 6. Amounts always stored in original currency with PEN equivalent

Every monetary amount is stored as `amount` + `currency` (original) and `amount_pen`
(PEN equivalent at payment time). Reports aggregate `amount_pen`. Original amounts
are immutable once recorded.

### 7. IGV and detracciones are first-class fields

Every invoice stores `subtotal`, `igv_amount`, and `total` separately. SUNAT XML
metadata is extracted and stored in the database — documents are queryable without
opening any file.

### 8. Null over omission

Optional fields in responses are always present, set to `null` when empty. Response
shapes never change based on data presence.

### 9. snake_case everywhere

All table names, column names, API parameters, and JSON keys use snake_case.

---

## What This System Does Not Do

- **Accounting / contabilidad formal** — handled by an external accountant.
- **SUNAT electronic invoice emission** — issued via a separate OSE/PSE. This system
  stores metadata and files after issuance.
- **Payroll** — out of scope.
- **Inventory management** — materials tracking at unit level is out of scope.
- **Multi-company consolidation** — each partner's independent company has its own
  accounting. This system tracks cost contributions to shared projects only.

---

*Last updated: April 2026*
