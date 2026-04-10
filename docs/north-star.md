# North Star — What This System Must Solve

> This document describes the real-world problems Korakuen faces, what
> the system must do about each one, and what "done" looks like from
> the perspective of the people using it. It is the reference for
> every feature decision: if a feature doesn't trace back to a problem
> listed here, it doesn't belong in scope.
>
> Related: `domain-model.md` · `architecture.md` · `roadmap.md`

---

## Who uses this system

Three people. Alex (admin, managing partner at Korakuen) and two
partner engineers who run their own companies but collaborate on
shared construction projects. An external accountant receives
exported data but does not log in.

---

## Core philosophy: cash over accrual

**This system is cash-basis first.** We focus on payments, bank
balances, and cash flow. The invoices and accrual-basis accounting
are handled by outsourced accountants — we still register and track
every invoice, but primarily as supporting documentation for the
cash movements, not as the source of financial truth.

This means:

- **Payments are the primary records.** Every sol and dollar that
  moves through a bank account is captured.
- **Invoices are the paper trail.** They support and document what
  the payments were for, but the system doesn't depend on perfect
  invoice matching to function.
- **Reporting is cash-based.** "How much have we spent on this
  project?" means sum of outbound payments, not sum of invoices
  received.
- **Accrual reports are a courtesy.** We keep enough invoice data
  that the accountant can do their job, but we don't build around it.

---

## The problems

### 1. I don't know where my money is

Korakuen operates across multiple bank accounts in two currencies
(PEN and USD), including Banco de la Nacion accounts that only
receive detraccion deposits. At any given moment, I need to know:

- How much cash sits in each bank account, right now
- What my total cash position is across all accounts, in soles
- What's in Banco de la Nacion (usable only for tax payments)
- Which payments have been reconciled against bank statements and
  which haven't

**What the system does:** Bank account balances are derived from
payment records — never manually entered, never stale. A
reconciliation view lets me match system payments against bank
statement entries using the bank's operation code (`bank_reference`).
Unreconciled payments are immediately visible.

---

### 2. I can't answer "how much does this client/vendor owe us?"

With multiple projects, partial payments, detracciones split across
two bank accounts, and dual-currency invoicing, answering this
question today requires a spreadsheet and 30 minutes.

**What the system does:** For every contact — whether client,
vendor, or partner — the system shows:

- Total billed to them / total they've billed us
- Total paid / total outstanding
- Breakdown by project (receivable and payable per project)
- RUC/DNI and official razon social, verified against SUNAT

I open a contact and in 10 seconds I see everything: who they are,
what we owe each other, across which projects.

---

### 3. I can't see the health of my projects at a glance

I need a single view of all projects — prospects we're chasing,
active jobs, completed work, and rejected bids — with key numbers
visible without clicking into each one.

**What the system does:** A project list view showing for each
project:

- Status (prospect, active, completed, rejected, archived)
- Client name
- Contract value (revenue)
- Estimated cost (our internal budget for what we expect to spend)
- Actual spend so far (derived from outbound payments)
- Start date and expected end date
- Which partners are involved and their profit split percentages
- Which providers are involved and how much we've paid each

Clicking into a project shows the full detail: quotes, invoices
(outgoing and incoming), payments, and the profit/loss position.

---

### 4. Quotes are disconnected from invoices

We receive vendor quotes and send client quotes. An approved quote
should naturally evolve into work that generates invoices. Today
there's no connection — I approve a quote in my head and manually
create invoices later.

**What the system does:** Two separate quote workflows:

- **Outgoing quotes** (to clients): `draft -> sent -> approved | rejected | expired`.
  An approved outgoing quote becomes the basis for the project
  contract. The contract value flows from the winning quote.

- **Incoming quotes** (from vendors): `draft -> approved | cancelled`.
  An approved incoming quote sets the expectation for incoming
  invoices from that vendor. When the vendor's factura arrives, it
  links back to the original quote.

Both show in a unified quotes view: all quotes, their status, who
they're from/to, amounts, and which project they belong to.

---

### 5. Invoice tracking is a nightmare

Outgoing invoices (facturas emitidas) and incoming invoices
(facturas recibidas) have completely different lifecycles, fields,
and tax implications. Mixing them in one table was a V1 mistake that
made every query, every form, and every report harder.

**What the system does:**

**Outgoing invoices** (we bill the client):
- Lifecycle: `draft -> sent -> partially_paid -> paid | void`
- Track subtotal, IGV, total, detraccion rate and amount
- SUNAT fields: serie/numero, RUC emisor/receptor, CDR hash
- Outstanding amount = total minus all allocated payments
- Detraccion is part of the total (not additional) — the client
  pays part to our regular account and deposits the detraccion
  portion into our Banco de la Nacion account. Both reduce the
  same outstanding balance.
- Detraccion proof: constancia code, date, URL
- Each invoice shows which payments have been applied to it,
  from which bank accounts, with the bank's operation code

**Incoming invoices** (vendors bill us):
- Lifecycle: `expected -> unmatched -> partially_matched -> matched`
- **`expected`** is for invoices we know are coming but don't have
  yet — a vendor told us "I'll bill you ~S/ 5,000 next week" and we
  want it on our radar before the paper arrives. An `expected` row
  has vendor, project, estimated amount + currency, and an optional
  expected arrival date and linked quote, but no SUNAT fields
  (serie/numero/CDR) because no factura exists yet. It still shows
  up in payables forecasts and the obligation calendar.
- When the real factura arrives, the same record transitions to
  `unmatched` and the SUNAT fields get filled in. No record
  duplication.
- Often arrives AFTER we already paid — the system handles this
  naturally by linking existing payments to the invoice when it
  arrives. Combined with `expected`, this lets us record the four
  real-world flows we see — payment-first, quote-first,
  invoice-first, or any other order — without forcing a sequence.
- Status auto-updates as payment lines are allocated

**Audit trail:** Every mutation to every invoice is logged
automatically with before/after state, who did it, and when. The
accounting department can trace any number back to its origin.

---

### 6. Payments are scattered and untrackable

One bank transfer might cover three invoices and a bank fee. A
vendor payment might happen before their factura arrives. A
partner's payment from their own company account needs to be tracked
for the profit settlement later.

**What the system does:** Every payment is a header + detail lines:

- **Header** = one bank statement entry. Records: bank account,
  date, direction (in/out), contact, total amount, currency,
  exchange rate, bank operation code (`bank_reference`), which
  partner paid (for outbound)

- **Lines** = what the money was for. Each line can be:
  - Invoice payment (linked to outgoing or incoming invoice)
  - Bank fee (no document link)
  - Detraccion (BN deposit/withdrawal)
  - Loan repayment (linked to loan)
  - General expense (informal vendor, no factura)

One payment covering three invoices + a bank fee = one header,
four lines. The header total always equals the sum of the lines.

Informal vendors (no factura) are handled naturally: a payment line
with `line_type = general` and no invoice link. When a factura
eventually arrives, the line gets updated to link to it.

---

### 7. Cost categorization exists but is independent

Both invoices and payments can be tagged with cost categories
(materials, labor, equipment rentals, etc.). This is the same
categorization system — same category list — but the categorization
on invoices and the categorization on payments are independent.
There is no reconciliation between them.

**Why:** Invoices are the accrual-basis view (the accountant's
world). Payments are the cash-basis view (our world). They use the
same vocabulary but serve different masters. An invoice might be
categorized as "Materiales" by the accountant, and the payment that
settled it might also be tagged "Materiales" by us — but the system
doesn't enforce or check that they match.

**What the system does:**

- A shared `cost_categories` reference table used by both invoices
  and payment lines
- Invoice-level categorization: for the accountant's reports and
  for future Price Sentinel features
- Payment-line-level categorization: for our cash-basis cost
  breakdown reports ("how much did we spend on materials for
  project X?")
- Reporting primarily uses payment-level categories (cash basis)
- No cross-validation between invoice and payment categories

---

### 8. I don't know what we owe or what we're owed

Receivables, payables, upcoming loan payments — they're in different
places and I can't see them together.

**What the system does:**

- **Receivables:** All outstanding outgoing invoices, by client,
  with aging
- **Payables:** All outstanding incoming invoices, by vendor
- **Loan obligations:** All active loans with remaining balances
  and upcoming scheduled payments
- **Obligation calendar:** A single chronological view of
  everything that needs to be paid, sorted by due date

---

### 9. Loans are tracked on paper

Partners borrow money from individuals to fund their share of
project costs. Each loan has a return commitment — either a fixed
percentage (typically 10% minimum) or a fixed amount at the end of
the period. Repayments come from the partner's profit share. Today
this is tracked in notebooks and WhatsApp messages.

**What the system does:**

- Record each loan: who borrowed, who lent, amount, currency,
  return rate/type, disbursement date, due date
- Optional repayment schedule with individual due dates
- Track repayments through the normal payment system (payment
  line with `line_type = loan`)
- Loan balance always derived: principal minus sum of repayments
- Status always derived: active / partially_repaid / settled

---

### 10. Partner settlement is done on the back of a napkin

After a project completes, we need to figure out: how much profit
was made, how much each partner spent out of pocket, and how much
each partner is owed. This calculation is simple in theory but
requires pulling data from invoices, payments, and profit split
agreements — which today means hours in a spreadsheet.

**What the system does:** A settlement dashboard showing, per
project.

In plain words: each partner gets reimbursed for what they spent out
of pocket, and the remaining profit is split by the agreed
percentages. We split **profit, not revenue.** The formula below is
the math version of that — reimbursement and profit-share collapsed
into a single per-partner number.

```
Total revenue (sum of inbound payments)
- Total costs (sum of ALL outbound payments by ALL partners)
= Gross profit

For each partner:
  Their expenses (outbound payments where paid_by_partner = them)
  + Their profit share (gross_profit x their split %)
  = Total owed to them
```

All numbers derived at query time. Never stored. Always current.

---

### 11. Peru is dual-currency and the tax rules are complex

Every transaction can be in PEN or USD. SUNAT requires soles
equivalents. Exchange rates change daily. IGV (18%) creates tax
credits and obligations. Detracciones split payments across
accounts. Retenciones reduce what clients actually pay us.

**What the system does:**

- **Exchange rates:** Fetched daily from SUNAT. Every monetary
  record stores amount + currency + PEN equivalent + the rate
  used. Historical amounts never recalculated — the rate at the
  time of the transaction is preserved forever.

- **IGV position:** Output IGV (our outgoing invoices) minus
  input IGV (matched incoming invoices) = net position. Positive
  means we owe SUNAT; negative means credito fiscal.

- **Detracciones:** Properly modeled as part of the invoice
  total, not an addition. Client pays `total - detraccion` to our
  regular account and deposits `detraccion` to our BN account.
  Both payments reduce the same invoice's outstanding balance.

- **Dashboard alert:** Red banner when today is a weekday and no
  exchange rate exists — blocks invoice creation in wrong currency.

---

## Future-ready: the data foundation we must build now

The following features are NOT in Phase 1 scope, but the database
must be structured to support them without retroactive
reclassification of thousands of records. The cost of adding these
hooks now is low; the cost of not having them later is enormous.

### The Price Sentinel (Variance Analysis)

**Problem it solves:** We can't tell if a vendor is overcharging us
until after the project is done and we've already lost margin. By
then it's too late.

**What it will do:** Compare every incoming quote or invoice price
against a reference price. Flag anomalies at the point of data
entry before they're committed to the project's costs. Instead of
reviewing 1,000 invoices, we investigate the 5% the Sentinel flags.

**The data architecture it requires (5 levels):**

**Level 1 — Taxonomy (the "family tree"):**
Not a flat list of 5,000 items. A hierarchy that groups items by
economic behavior:
- **Category** (macro): e.g., "02. Structural" — used for
  high-level budget tracking
- **Item Group** (sub-category): e.g., "Cement" — used for
  parametric estimator recipes
- **Standard Reference Item** (the "virtual item"): e.g.,
  "Portland Cement Bag (42.5kg)" — the statistical anchor. You
  don't buy this directly; it's the average of all actual SKUs

**Level 2 — SKU Layer (the "physical truth"):**
Handles variations without breaking statistics. Partners select
from pre-defined attributes instead of typing descriptions:

| Base Item | Type | Brand | SKU ID |
|---|---|---|---|
| Portland Cement | Type I | Pacasmayo | SKU-101-A |
| Portland Cement | Type V | UNACEM | SKU-101-B |

When Partner A buys "Pacasmayo Type I" and Partner B buys "UNACEM
Type I," the system knows both are children of "Portland Cement
(42.5kg)" and can compare prices accurately.

**Level 3 — Calculation Engine (establishing the "price"):**
Three reference price methods:
- **Budgeted Price:** The price used in the initial quote (the plan)
- **Last Price Paid (LPP):** Most recent successful purchase price
- **Volume-Weighted Average Price (VWAP):**
  `Reference = SUM(Price_i x Quantity_i) / SUM(Quantity_i)`
  — prevents small urgent buys from skewing the reference

**Level 4 — Sentinel Logic (the "trigger"):**
- Green (<5% variance): auto-approve
- Yellow (5-15%): flag for review, require a reason code
  (e.g., "Supplier Shortage," "Urgent Delivery")
- Red (>15%): block entry or immediate alert to admin

**Level 5 — Partner-proof UI:**
- Partner types "Cem..." and gets a filtered list of standard items
- Selects "Portland Cement Type I" — system pre-fills UOM and
  expected price
- Types "104" in price field — field turns red: "Warning: 30%
  above partner average of 80"

**Seeding from existing budgets:**
We don't need to invent the taxonomy from scratch. Korakuen already
has 6 detailed project budgets (presupuestos) as Excel files —
each one a line-by-line breakdown of partidas, units of measure,
quantities, and per-unit prices we successfully bid. Once Phase 1 is
stable, we'll mine those files to extract:

1. **The taxonomy.** Categories, item groups, and item descriptions
   as they actually appear in our work. Items that recur across 3+
   budgets become Standard Reference Items. This gives us a
   real-world starting tree instead of a theoretical one.
2. **Outgoing reference prices.** The per-unit *sale* prices we've
   bid become the reference for *outgoing* quotes — so the Sentinel
   can also flag when we're under-bidding a partida vs. our own
   historical pricing. This reframes the Sentinel as bidirectional:
   it polices vendor overcharges (cost side) AND warns when our own
   quotes drift below historical sale prices (revenue side).
3. **Cost references must come from incoming invoices, not budgets.**
   The presupuesto prices include markup, so they are not valid
   vendor-cost references. The Sentinel's vendor-overcharge function
   only becomes accurate after we've recorded enough real incoming
   invoices to build a VWAP. Until that history exists, the Sentinel
   runs in "observe-only" mode for cost prices — logging variance
   but not blocking entry.

The 6 budgets are the cheapest way to bootstrap the taxonomy without
months of manual classification.

### The Parametric Estimator (Project Forecasting)

**Problem it solves:** We guess at project costs instead of using
data. Each partner estimates differently. There's no consistency
in our bids.

**What it will do:** Use standardized "recipes" tied to project
archetypes to forecast costs based on physical dimensions.

**Archetypes:** Templates for our most common project types:
roads, sidewalks, small police stations.

**Cost drivers:** Key variables that scale with cost — linear
meters for roads, square meters for buildings.

**Recipe logic:** Each archetype links to a Bill of Materials per
unit of measure.
Example: 1 meter of road = X bags of cement + Y kg of rebar + Z
labor hours.

**How it works:** Input dimensions for a new project. System
multiplies recipe quantities by current reference prices. Generates
a categorized estimate (Materials, Labor, Equipment) instantly.

### The integrated flywheel

The Sentinel ensures historical data is clean and current costs are
controlled. The Estimator uses that clean historical data to create
accurate future quotes. The database standardizes everything across
all three partner companies, revealing where one company is more
efficient (or expensive) than the others.

### What this means for Phase 1

We don't build the Sentinel or Estimator now. But we must:

1. **Tag every incoming invoice and payment line with a cost
   category** — using the same shared category list, even though
   invoice and payment categorizations are independent
2. **Design the cost_categories table to support future hierarchy**
   — it's currently flat, but it will need to become the Category
   layer of the taxonomy
3. **Keep item descriptions structured** on line items — free-text
   descriptions are the enemy of future categorization
4. **Store unit and unit_price on every line item** — not just
   totals. The Sentinel and Estimator need price-per-unit data
5. **Record which partner paid for each outbound payment** — already
   in the schema via `paid_by_partner_id`

The cost of these hooks is near zero today. The cost of
retroactively classifying thousands of entries later is prohibitive.

---

## What's explicitly NOT in scope

These are real needs but belong elsewhere or in later phases:

| Not in scope | Why |
|---|---|
| Formal accounting (contabilidad) | External accountant handles this |
| SUNAT electronic invoice emission | Done through separate OSE/PSE |
| Payroll | Not relevant to project-based construction work |
| Unit-level inventory | Materials tracked by cost, not by unit |
| Multi-company consolidation | Each partner has own books; we only track contributions |
| Budget vs. actual per line item | Future phase (per-partida tracking) |
| Mobile app for document scanning | Phase 3 — submissions table is ready, app comes later |
| AI agent for document processing | Phase 3 — API-shaped design makes this possible later |
| Price Sentinel implementation | Future phase — data hooks built now, logic built later |
| Parametric Estimator implementation | Future phase — requires clean historical data first |
| Invoice-to-payment category reconciliation | Not needed — they serve different masters |

---

## Schema gaps identified

The following items from this north star are not yet reflected in the
current database schema and will need discussion before
implementation:

1. **`estimated_cost` on `projects`** — The system tracks contract
   value (revenue) but has no field for the internal cost estimate
   we set. Adding a `numeric(15,2)` column would let the project
   list show expected margin alongside actual spend.

2. **Project status `rejected`** — Current statuses are `prospect ->
   active -> completed -> archived`. A rejected/lost status (for
   bids we didn't win or prospects that fell through) is needed.

3. **Cost category hierarchy** — `cost_categories` is currently
   flat. The Price Sentinel future feature requires at minimum a
   `parent_id` self-reference to support Category -> Item Group ->
   Standard Reference Item. This could be added now at zero cost.

4. **Item master / SKU tables** — Not needed in Phase 1, but the
   Sentinel and Estimator will eventually require:
   - `items` (standard reference items with UOM)
   - `item_attributes` (type, brand, etc.)
   - `item_skus` (specific purchasable variants)
   - `item_prices` (historical price records for VWAP calculation)
   These tables can be added later without breaking existing data,
   as long as line items preserve structured `unit` and `unit_price`
   fields (which they already do).

5. **`expected` status on incoming invoices** — Current incoming
   invoice lifecycle starts at `unmatched`. We need a prior
   `expected` state for invoices we know are coming but don't have
   yet (vendor told us "I'll bill you next week"). Schema changes
   required: add `expected` to the incoming invoice status enum, and
   make SUNAT fields (`serie`, `numero`, CDR hash) nullable so an
   `expected` row can exist without them. The lifecycle rules in
   `lib/lifecycle.ts` must enforce that the SUNAT fields become
   required on the transition to `unmatched`.

These require schema changes and need explicit approval per project
rules.

---

## The test

When this system is done, I should be able to:

1. Open the dashboard and in 30 seconds know my cash position across
   all accounts
2. Click on any client or vendor and instantly see what they owe me
   or what I owe them, broken down by project and invoice
3. Click on any project and see: contract value, estimated cost,
   actual spend, profit so far, partner splits, and every document
   associated with it
4. Record a payment that covers three invoices and a bank fee in
   under two minutes
5. Reconcile a week's worth of bank statements in 15 minutes
6. At project completion, generate the partner settlement numbers
   without touching a spreadsheet
7. At tax time, know my IGV position instantly
8. Show the accountant a clean trail of invoices, payments, and
   categories without them needing to log into the system
9. Trust every number because every change is logged and nothing
   can be manually corrupted
10. Know that when we're ready to build the Price Sentinel, the
    data is already categorized and structured — no retroactive
    cleanup needed

---

*This document is the "why." The schema reference is the "what." The
architecture doc is the "how." When they conflict, this document wins
on intent, the schema wins on structure.*
