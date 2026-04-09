# Lessons from Korakuen V1

> What worked, what didn't, and what V2 does differently.
> Written April 2026, after V1 ran in production since February 2026.

---

## What Worked Well

### 1. Schema-first approach
Designing the database before writing any application code paid off. The 15-table
schema was stable throughout V1 and rarely required structural changes. V2 continues
this: deploy the full schema before writing a single server action.

### 2. Exchange rate per transaction
Storing the exchange rate on every financial record (not looking it up retroactively)
was the right call. It enabled reliable PEN/USD display without fear of rate changes
invalidating historical data. V2 keeps this pattern and adds `amount_pen` on every
monetary record for consistent aggregation.

### 3. Partner tracking on every financial record
`partner_id` on invoices and payments made settlement calculations straightforward.
V2 renames this to `paid_by_partner_id` on payments and keeps it as a first-class
field — the settlement page was one of the most-used features.

### 4. Soft deletes everywhere
Never lost data. The `deleted_at` pattern prevented accidental permanent deletions.
Financial records should never be hard-deleted. V2 keeps this rule.

### 5. Derived totals (no stored balances)
Views like `v_invoice_totals` and `v_invoice_balances` computed totals and payment
status at query time. This eliminated consistency bugs — there was never a "stored
total doesn't match the sum of items" problem. V2 formalizes this as the `_computed`
pattern in API responses.

### 6. Free stack
Supabase free tier + Vercel free tier + no paid licensing. The three-user scale
never needed more. V2 stays on the same free stack for Phase 1.

---

## What Didn't Work Well

### 1. Unified invoice model (direction column)
V1 merged payable and receivable invoices into one `invoices` table with a `direction`
column. In theory this reduced duplication. In practice:

- Queries always filtered by direction anyway — no benefit from unification
- Outgoing invoices need SUNAT XML fields; incoming invoices need `factura_number`
  and commitment matching — the column sets diverged significantly
- UI components needed different forms for AP vs AR — the shared table didn't simplify
  the frontend either
- Confusion when reading SQL: "is this an incoming or outgoing invoice?"

**V2 fix:** Separate `outgoing_invoices` and `incoming_invoices` tables. Each has
exactly the columns it needs. Clearer queries, clearer code, no wasted nullable columns.

### 2. Quotes as invoices
V1 stored quotes in the `invoices` table with `quote_status` and `invoice_items.quote_date`.
This was awkward:

- A quote is not an invoice — different lifecycle, different purpose
- `quote_status` (pending/accepted/rejected) coexisted with invoice `status` on the
  same row, creating confusion about which status mattered
- Accepting a quote didn't naturally create an invoice — it just changed a status field
- Migration was complex when merging the separate `quotes` table into `invoices`

**V2 fix:** Separate `outgoing_quotes` and `incoming_quotes` tables with their own
line items, lifecycles, and statuses. Quotes and invoices are linked by reference
(quote → contract → project → invoices) but live in their own tables.

### 3. No contracts table
V1 had no explicit contract representation. Contract data was implied by the project
and its associated invoices. This made it hard to answer: "what's the total contract
value?" or "how much of the contract has been invoiced?"

**V2 fix:** Contract terms live directly on the `projects` table (`contract_value`,
`billing_frequency`, `signed_date`, etc.). One contract per project, always 1:1.

### 4. Payments without line items
V1's `payments` table was flat — one payment settled one invoice. In reality:
- A single bank transfer often covers multiple invoices
- Bank fees are part of the same cash event
- Detracción deposits are a separate line on the same logical payment

This led to awkward workarounds: splitting a multi-invoice payment into multiple
payment records, losing the 1:1 relationship with the bank statement entry.

**V2 fix:** `payments` (header) + `payment_lines` (detail). One payment = one bank
statement entry. Payment lines say what the money was for — invoices, bank fees,
detracciones, loan repayments, or general expenses. Bank account balance is derived
from payment headers; invoice outstanding is derived from payment lines.

### 5. No cost categories
V1 had no way to categorize costs (materials, labor, equipment rental, etc.). All
costs were flat, making it impossible to answer "how much did we spend on materials
for project X?"

**V2 fix:** `cost_categories` reference table. Both incoming invoices and payment
lines can be tagged with a category. Cost breakdown reports aggregate by category.

### 6. No activity log
V1 had no audit trail. Changes to financial records were invisible. When a payment
amount was wrong, there was no way to see what it was before the edit.

**V2 fix:** `activity_log` table populated by a Postgres trigger. Every INSERT,
UPDATE, DELETE on financial tables produces an immutable audit row with before/after
state. Automatic, zero application code needed.

### 7. No bank reconciliation
V1 had no way to mark payments as reconciled with the bank statement. This made
month-end reconciliation a manual process outside the system.

**V2 fix:** `reconciled`, `bank_reference`, `reconciled_at`, `reconciled_by` fields
on payments. Dedicated reconciliation workflow in the UI.

### 8. SharePoint file references were fragile
The document reference naming convention (`PRY001-AP-001`) linking database records
to SharePoint files was manual and error-prone. Files got renamed, moved, or the
naming convention wasn't followed consistently.

**V2 fix:** Google Drive with `drive_file_id` (stable identifier that survives
renames and moves) + `pdf_url` (shareable link for display). Phase 3 adds an AI
agent that automatically classifies and moves files.

---

## Architectural Lessons

### Build API-shaped from the start
V1's server actions mixed validation, data access, and business logic. When considering
a FastAPI migration, the entanglement made it clear this would be a rewrite, not a
lift-and-shift.

**V2 rule:** Server actions are thin. All validation lives in `lib/validators/`. All
status transition logic lives in `lib/lifecycle.ts`. When Phase 2 arrives (FastAPI),
the logic migrates cleanly.

### Don't build what you don't need yet
V1 built a CLI that was later removed when the website took over all data entry.
Wasted effort.

**V2 rule:** Phase 1 builds only the web dashboard. CLI and AI agent are Phase 2
and 3 respectively, triggered only when actually needed.

### Contact verification was worth the effort
Using the decolecta API for RUC/DNI lookup in V1 prevented bad data from entering
the system. Every contact had verified SUNAT data.

**V2 expands this:** Mandatory SUNAT verification with immutable fields after creation.
No manual contact entry path.

---

*This document is reference only. The authoritative V2 design is in the other docs/ files.*
