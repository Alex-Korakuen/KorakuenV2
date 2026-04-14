# Korakuen — Domain Model

> The conceptual model. Explains what each entity is, why it exists, and how entities
> relate to each other. Read this before reading the schema reference.
>
> Related: `architecture.md` · `api-design-principles.md` · `schema-reference.md`

---

## Overview

The Korakuen domain has six conceptual areas:

```
1. Contacts          — everyone Korakuen transacts with
2. Projects          — the work being done, its lifecycle and economics
3. Revenue documents — the money coming in (quotes, outgoing invoices)
4. Cost documents    — the money going out (incoming quotes, incoming invoices)
5. Payments          — actual cash movements, in both directions
6. Bank accounts     — where the cash lives
```

These six areas are not independent — they are connected by a clear dependency hierarchy.
Understanding the hierarchy is essential before reading the schema.

---

## 1. Contacts

**What it is:** A unified directory of every person or company Korakuen has a financial
relationship with. Clients, vendors (subcontractors, suppliers, equipment rental companies),
and partner companies all live in the same table.

**Why unified:** In practice, the same company can be a vendor on one project and a partner
on another. A separate table per contact type would create duplication and prevent this
flexibility.

**Type field:** `is_client`, `is_vendor`, `is_partner` — boolean flags, not an enum.
A contact can hold multiple roles simultaneously.

**Mandatory SUNAT/RENIEC verification:** Every contact must be verified against the
official Peruvian registries before it can be created. There is no manual entry path.

- Companies (juridica) → verified via RUC against SUNAT padrón reducido
- Individuals (natural) → verified via DNI against RENIEC padrón reducido

The engine calls the decolecta API internally on `POST /contacts`. If the RUC or DNI
is not found, the contact cannot be created. The `razon_social`, `ruc`/`dni`,
`tipo_persona`, `sunat_estado`, and `sunat_condicion` fields are populated from SUNAT
data and are immutable after creation. Only contact details (`email`, `phone`, role
flags, `notes`, `nombre_comercial`) can be edited after creation.

**Key fields:**
- `ruc` — 11-digit Peruvian tax ID (juridica) or 8-digit (natural with RUC)
- `dni` — 8-digit national ID (natural persons without RUC)
- `razon_social` — legal company name or full personal name
- `nombre_comercial` — trading name (optional, user-entered)
- `sunat_estado` — ACTIVO, BAJA DE OFICIO, etc.
- `sunat_condicion` — HABIDO, NO HABIDO, etc.
- `sunat_verified` — always `true` (enforced by DB constraint)
- `sunat_verified_at` — timestamp of the SUNAT lookup

---

## 2. Projects

**What it is:** The central organizing entity. Almost everything in the system links to
a project. A project represents a defined scope of work for a specific client, with a
known revenue target and a defined set of participating partner companies.

**Lifecycle:**
```
prospect → active → completed
       ↘         ↘
       rejected  rejected
```

- `prospect` — opportunity being pursued. A quote may exist. No contract yet.
- `active` — contract signed. Invoicing has begun or will begin.
- `completed` — terminal. All work done, all invoices issued, all payments received (or written off).
- `rejected` — terminal. For prospects that never converted (lost bids, dead leads)
  or active projects that were cancelled.

**One contract per project.** The relationship is always 1:1. If scope changes
significantly enough to require a new contract, it is a new project.

### Estimated Cost and Budgets

A project's estimated cost is not stored as a column on `projects`. It is the sum
of the project's `project_budgets` rows. Budgets are tagged with a top-level
`cost_category_id` (Materiales, Mano de Obra, Alquiler de Equipos, etc.) and
amounts are always in PEN — budgets are internal planning and the reporting
currency is PEN. Purchases in USD convert to PEN at payment time and show up
against the PEN budget naturally.

```
project_budgets
  project_id            — which project
  cost_category_id      — must be a top-level category (parent_id IS NULL)
  budgeted_amount_pen   — always PEN
```

**Why top-level only:** Phase 1 operates the category hierarchy at its root level.
Deeper levels (Item Group, Standard Reference Item) are seeded later from historical
presupuestos and consumed by the future Price Sentinel. Per-partida budgeting —
the full presupuesto model — is explicitly out of scope for Phase 1.

**Margin computation (derived, not stored):**
```
estimated_cost   = SUM(budgeted_amount_pen) for project_budgets where project_id = P
actual_cost      = SUM(total_amount_pen) for payments where project_id = P, direction=outbound
expected_margin  = contract_value_pen − estimated_cost
actual_margin    = contract_value_pen − actual_cost
```

### Project Partners

Each project has one or more participating partner companies, each with a defined
profit split percentage.

```
project_partners
  project_id         — which project
  contact_id         — which partner company (FK → contacts)
  profit_split_pct   — e.g. 33.33 (must sum to 100 across all partners on a project)
  company_label      — e.g. "Korakuen", "Partner B", "Partner C" (display name)
```

**Profit split mechanics:**

When a project generates profit, the split is calculated as follows:

```
Total revenue collected (inbound payments on this project)
  − Total costs (ALL outbound payments on this project, by all partners)
  = Gross profit

Each partner receives:
  Their costs back (sum of outbound payments where paid_by_partner = this partner)
  + Their profit share (gross_profit × their profit_split_pct / 100)
```

This means Korakuen (which collects all revenue) owes each partner:
- Reimbursement of their direct costs
- Their proportional profit share

The system tracks this as a running liability per partner per project, updated every time
a payment is recorded.

---

## 3. Revenue Documents

The money coming in. Three document types, each at a different stage of the commercial
lifecycle.

### Quotes (Cotizaciones)

**What it is:** A formal proposal sent to a prospective client. Defines scope, pricing,
and terms. Not a binding obligation.

**Lifecycle:** `draft → sent → approved → rejected | expired`

When a quote is approved by the client, it is the basis for the contract. The contract
is created from the approved quote — the quote's financial values flow into the contract.

**Key fields:**
- `project_id` — the prospect project this quote belongs to
- `contact_id` — the client being quoted
- `subtotal`, `igv_amount`, `total`
- `valid_until` — expiry date
- `pdf_url` — the quote document

### Contract Terms (on `projects` table)

**What it is:** The signed agreement between Korakuen and the client. Defines the total
project value, billing frequency, and currency. Marks the transition from `prospect` to
`active` on the project.

**One contract per project.** Contract terms live directly on the `projects` table — there
is no separate `contracts` table. The contract's `contract_value` is the revenue target
the project is measured against.

**Key fields (on `projects`):**
- `contract_value`, `contract_currency`, `contract_exchange_rate`
- `igv_included` — whether contract value includes IGV
- `billing_frequency` — weekly | biweekly | monthly | milestone
- `start_date`, `expected_end_date`
- `signed_date`
- `contract_pdf_url`

These fields are nullable — a project can exist in `prospect` status before a contract
is signed. All contract fields must be populated before the project can transition to
`active`.

### Outgoing Invoices (Facturas Emitidas)

**What it is:** A periodic billing event sent to the client. Each invoice covers a defined
period of work. A valorización (progress document) may accompany the invoice as a PDF
attachment — it is not a separate tracked entity in the system.

**Lifecycle:** `draft → sent → void`. Pure workflow state that the admin
controls directly (manual click to mark sent, manual click to void). The
`sent → draft` undo is allowed while no SUNAT fields have been committed
to the invoice. `sent → void` is blocked while any `payment_lines` reference
this invoice — allocations must be unwound first.

Payment progress (`unpaid | partially_paid | paid`) and SUNAT registration
(`not_submitted | pending | accepted | rejected`) are **both derived at
query time** and returned under `_computed`. Neither is stored on the row.
See `api-design-principles.md` → "Outgoing invoice payment progress" and
"Outgoing invoice SUNAT registration" for the canonical formulas.

**Key financial fields:**
```
subtotal              — net amount before IGV
igv_amount            — 18% (or applicable rate per the SUNAT document)
total                 — subtotal + igv_amount
currency              — PEN | USD
exchange_rate         — if USD, the rate at issuance date
total_pen             — always in PEN (= total if PEN, = total × exchange_rate if USD)

detraction_rate       — nullable (e.g. 0.12 for 12%)
detraction_amount     — nullable, always in PEN
```

**Derived at query time (not stored):**
```
-- Signed single-bucket formula. Positive contributions = money toward
-- Korakuen (inbound), negative = money away from Korakuen (outbound).
-- Refunds and self-detracción legs flow through the same mechanism.
paid           = SUM(
                   CASE WHEN payment.direction = 1 THEN  payment_line.amount_pen
                        WHEN payment.direction = 2 THEN -payment_line.amount_pen
                   END
                 ) where outgoing_invoice_id = this AND payment.deleted_at IS NULL
outstanding    = MAX(total_pen − paid, 0)
is_fully_paid  = (paid >= total_pen)
```

`detraction_rate` and `detraction_amount` are stored informational
reference data — they do not participate in the derivation above. See
`api-design-principles.md` → "Invoice payment progress" for the canonical
formula and the scenarios it handles.

**SUNAT document fields (extracted from XML at registration):**
```
serie_numero          — e.g. "F001-00000142"
fecha_emision         — issue date per SUNAT
tipo_documento_code   — "01" (factura), "03" (boleta), etc.
ruc_emisor            — Korakuen's RUC
ruc_receptor          — client's RUC
hash_cdr              — SUNAT validation hash
estado_sunat          — accepted | rejected | pending
pdf_url               — the human-readable document
xml_url               — the legally valid SUNAT document
```

**Detracción proof fields:**
```
detraction_handled_by          — smallint: 1=client_deposited, 2=not_applicable
detraction_constancia_code     — SUNAT operation code (provided by client)
detraction_constancia_fecha    — date of BN deposit
detraction_constancia_url      — PDF of constancia
```

---

## 4. Cost Documents

The money going out. Two document types on the cost side.

### Incoming Quotes (Cotizaciones Recibidas)

**What it is:** A vendor quote received by Korakuen. Represents a proposed scope and
price from a vendor before any payment is made or invoice received.

**Why it exists:** In Korakuen's payment flow, cash often goes out before the formal
invoice arrives. The incoming quote is the anchor that ties the payment to the right
vendor, project, and scope — even when the invoice is not yet in hand.

**Optional:** Not every outbound payment has a prior incoming quote. A supplier payment
on delivery may have no prior quote. In this case, the payment is recorded directly
and linked to the incoming invoice when it arrives (or to an `expected` invoice
created at payment time, if the factura is still pending).

**Lifecycle:** `draft → approved | cancelled`

**Key fields:**
```
project_id            — nullable (null = general company expense, not project-specific)
contact_id            — the vendor
description           — what was agreed (scope summary)
subtotal, igv_amount, total
currency, exchange_rate, total_pen
detraction_rate, detraction_amount   — if applicable (when Korakuen detracts from vendor)
```

### Incoming Invoices (Facturas Recibidas)

**What it is:** A row representing a vendor's bill — whether the paper factura
is already in hand, known to be coming, or not yet announced. In Korakuen's
workflow the paperwork and the money movement happen in any order, so this
entity is designed to be created at whichever moment the obligation becomes
real, not at the moment the SUNAT document arrives.

**Key behavioral rule:** An incoming invoice does not trigger payment. Payment
and paperwork are independent events in this system. The invoice exists for
accounting, SUNAT compliance, and to give Korakuen a single record that ties
together the vendor, the amount owed (or paid), and the factura when it eventually
shows up.

**Two independent dimensions:**

1. **Factura state** — does the SUNAT paper physically exist? Stored in
   `factura_status` as a simple two-value enum:
   - `expected` — we know the obligation exists, but no factura is in hand. SUNAT
     fields (`serie_numero`, `fecha_emision`, `ruc_emisor`, `hash_cdr`, etc.) are NULL.
   - `received` — the factura has been registered. SUNAT fields are populated and
     validated.
2. **Payment progress** — how much has been paid against this invoice? **Never
   stored.** Derived at query time from the sum of linked `payment_lines.amount_pen`,
   and returned under `_computed` as one of `unpaid | partially_paid | paid`.

A single row can be, for example, `(expected, paid)` — meaning Korakuen has
already paid the vendor but the factura never arrived and needs chasing. Or
`(received, unpaid)` — factura in hand, payment not yet made. These were
previously impossible to model with a single status field.

**Lifecycle:** `expected → received`. One-way transition. Enforced in
`lib/lifecycle.ts`. The engine requires all SUNAT fields to be populated when
transitioning to `received`.

**The four real-world arrival flows:**

1. **Quote-first** — Vendor sends a quote, Korakuen approves it, an expected
   invoice is created from the quote (one-click), payment is made, factura
   eventually arrives, expected → received. Most common flow.
2. **Payment-first** — Payment is made directly (supplier on delivery, urgent
   purchase). The payment form prompts "No factura yet — create an expected
   invoice to track it?" An expected invoice is created and linked to the payment.
   When the factura arrives later, it transitions to received.
3. **Invoice-first** — Factura arrives before any payment (rare in Korakuen's
   world, but possible). A received invoice is created directly with all SUNAT
   fields filled in. Payment is allocated later.
4. **Announcement-first** — Vendor says "I'll bill you next week" before anything
   else happens. Alex opens the "New Incoming Invoice" form, toggles "Expected",
   enters vendor + estimated amount + project. The obligation is now visible to
   the system before any money or paper has moved.

**Chase lists this enables** (all derived from the two-dimensional model):

| List | Query |
|---|---|
| "Chase the factura" | expected AND paid > 0 |
| "Pay the factura" | received AND outstanding > 0 |
| "Coming soon" | expected AND paid = 0 |
| "Fully closed" | received AND outstanding = 0 |

**Key fields:**
```
project_id            — nullable
contact_id            — the vendor
incoming_quote_id     — nullable (linked to prior incoming quote if one exists)
cost_category_id      — header-level categorization, nullable
factura_status        — 1=expected, 2=received
factura_number        — the vendor's invoice number (nullable while expected)

subtotal, igv_amount, total  — best estimate while expected; authoritative once received
currency, exchange_rate, total_pen
detraction_rate, detraction_amount

-- SUNAT document fields — NULLABLE. Populated only when factura_status = received.
serie_numero
fecha_emision
tipo_documento_code
ruc_emisor            — vendor's RUC (should match contact.ruc)
ruc_receptor          — Korakuen's RUC
hash_cdr
estado_sunat

pdf_url, xml_url

-- Detracción proof
detraction_handled_by          — smallint: 1=self, 2=vendor_handled, 3=not_applicable
detraction_constancia_code
detraction_constancia_fecha
detraction_constancia_url
```

---

## 5. Payments

**What it is:** Every actual cash movement — inbound or outbound — recorded in the system.
The payment model follows a header + lines pattern (like invoices and quotes). Bank account
balances, outstanding amounts, partner contributions, and profit calculations are all
derived from payment data.

**The fundamental rule:** One payment = one bank statement entry. One cash event on one
bank account.

When a single invoice settlement involves two bank accounts (regular + Banco de la Nación
for detracciones), that is TWO payments — one per account.

**Direction:**
- `inbound` — cash coming into a Korakuen bank account (client pays us)
- `outbound` — cash going out of a Korakuen bank account (we pay a vendor)

**Header + lines architecture:**
The `payments` table is the header — it records the cash event (who, when, which bank
account, how much). The `payment_lines` table records what that cash was for. Each line
can settle an invoice, cover a bank fee, handle a detracción, repay a loan, or be a
general expense.

One payment can cover multiple invoices via multiple payment lines. This solves V1's
limitation where a single bank transfer covering three invoices had to be split into
three separate records.

**Payment lines:**
Each line says what the cash was for via its linkage columns:
- **Settles an invoice** → `outgoing_invoice_id` or `incoming_invoice_id` is set
- **Loan repayment / disbursement** → `loan_id` is set
- **Bank commission** → `cost_category_id` points at the "Comisiones bancarias" node
  (the line may ALSO be linked to an `incoming_invoice_id` when the bank issues a
  factura for the commission)
- **Detraction** → payment header flag (`is_detraction = true`, Banco de la Nación
  account); line shape is identical to a regular payment
- **General (dangling)** → no FK set at all; the line is waiting to be reconciled

Invoice links (`outgoing_invoice_id`, `incoming_invoice_id`, `loan_id`) live on payment
lines, not on the payment header. Each line can link to at most one document.

**Unmatched payments are normal.** In Korakuen's workflow:
- Payment goes out before the invoice arrives → payment recorded with a general line
- Invoice arrives later → payment line updated with `incoming_invoice_id`

**Paid-by partner tracking:**
On outbound payments, `paid_by_partner_id` (on the payment header) records which partner
company's money went out. This is essential for profit split calculations — it determines
how much each partner is owed back from project revenue.

**Payment header key fields:**
```
direction             — inbound | outbound
bank_account_id       — always required
project_id            — nullable (null = general company expense)
contact_id            — who paid us or who we paid
paid_by_partner_id    — nullable, FK → contacts (outbound only)

total_amount          — cached sum of payment_lines.amount
currency              — PEN | USD
exchange_rate         — nullable (required when currency = USD)
total_amount_pen      — cached sum of payment_lines.amount_pen

is_detraction         — boolean (true = this payment goes to/from Banco de la Nación)
reconciled            — boolean (true = matched to bank statement entry)
bank_reference        — text, nullable (bank's own reference number)
payment_date          — the date the cash actually moved
```

**Payment line key fields:**
```
payment_id            — FK → payments
amount                — line amount in original currency
amount_pen            — line amount in PEN
outgoing_invoice_id   — nullable (set when this line settles an outgoing invoice)
incoming_invoice_id   — nullable (set when this line settles an incoming invoice)
loan_id               — nullable (set when this line repays a loan)
cost_category_id      — nullable (for cost breakdown reporting)
description           — nullable, per-line free-text memo
```

**Constraint:** `outgoing_invoice_id`, `incoming_invoice_id`, and `loan_id` are mutually
exclusive on each line — at most one document link per payment line.

---

## 6. Bank Accounts

**What it is:** The accounts where Korakuen's cash lives. Every payment must specify
a bank account. The bank account balance is derived from payment headers on that account:

```
balance = SUM(total_amount_pen WHERE direction = 'inbound') 
        − SUM(total_amount_pen WHERE direction = 'outbound')
```

**Banco de la Nación is just another bank account.** It has `account_type = banco_de_la_nacion`
which distinguishes it in the UI (shown separately from regular accounts), but mechanically
it works identically. Its balance is derived the same way. Payments on it are marked
`is_detraction = true` to indicate the funds are earmarked for SUNAT obligations.

**Currency:** Each bank account has a single currency. A USD account and a PEN account
at the same bank are two separate records. Banco de la Nación is always PEN.

**Key fields:**
```
name                  — e.g. "BCP Cuenta Corriente PEN", "Banco de la Nación Detracciones"
bank_name             — e.g. "BCP", "Interbank", "Banco de la Nación"
account_number        — masked for display (e.g. "****3421")
currency              — PEN | USD
account_type          — regular | banco_de_la_nacion
is_active             — boolean
```

---

## Financial Flows — End to End

### Revenue flow (money in)

```
1. Project created (status: prospect)
2. Quote issued to client (status: draft → sent)
3. Client approves quote → Contract created → Project becomes active
4. Billing period ends → Outgoing invoice created (status: draft)
5. Invoice reviewed → status: sent (PDF + XML issued via OSE/PSE, not by this system)
6. Client pays (normal case):
   a. Payment recorded: inbound, regular bank account
      Payment line: outgoing_invoice_id = this invoice, amount = total − detraction
   b. Detracción payment recorded: inbound, Banco de la Nación, is_detraction = true
      Payment line: outgoing_invoice_id = this invoice, amount = detraction_amount
7. Invoice `_computed.payment_state` moves from `partially_paid` to `paid`
   as the sum of linked payment_lines reaches `total_pen`. The `status`
   column stays at `sent` — payment progress is derived, not stored.
8. Next billing period → repeat from step 4
9. Final invoice paid → Project status: completed
```

### Cost flow — quote-first (money out with incoming quote)

```
1. Vendor submits quote → Incoming quote created (status: draft)
2. Incoming quote approved (status: approved)
3. Expected invoice created from the approved quote (one-click):
   Incoming invoice row inserted with factura_status = expected
   SUNAT fields NULL. Vendor, project, amounts carried over from the quote.
4. Payment made:
   a. Payment recorded: outbound, bank account
      paid_by_partner_id = which partner company's funds were used
      Payment line: incoming_invoice_id = the expected invoice
   b. If detraction applies:
      Second payment: outbound, Banco de la Nación, is_detraction = true
      Payment line: detraction amount, same expected invoice
5. Invoice is now (expected, paid) — shows up on the "chase the factura" list
6. Vendor sends factura → existing row transitioned to factura_status = received
   SUNAT fields populated. No new record created.
7. Invoice is now (received, paid) — fully closed.
```

### Cost flow — payment-first (no prior quote, supplier on delivery)

```
1. Supplier delivers materials, payment made on the spot
2. Payment recorded immediately: outbound, bank account,
   paid_by_partner_id = paying partner. At this stage the line is a
   general expense with no invoice link — the factura doesn't exist yet.
3. From the payment detail menu, Alex clicks "Create expected invoice
   from this line". One atomic server action
   (createExpectedInvoiceFromPaymentLine) both creates a new
   incoming_invoice with factura_status = expected (pre-filled from the
   payment: vendor, amount, project) and flips the payment line from
   general to invoice with incoming_invoice_id pointing at the new
   expected invoice. These never happen as two separate steps.
4. Invoice is now (expected, paid) — on the chase list
5. Supplier sends factura later → transition to received, SUNAT fields
   populated
6. Invoice is now (received, paid) — fully closed
```

### Cost flow — announcement-first (vendor pre-warns a bill)

```
1. Vendor says on WhatsApp "I'll bill you ~S/ 5,000 next week"
2. Alex manually creates an expected invoice: New Incoming Invoice,
   Expected toggle on, enters vendor + estimated amount + project
3. Invoice is (expected, unpaid) — shows up on "coming soon" list
4. Payment made at some later point → linked via payment line
   Invoice becomes (expected, paid) or (expected, partially_paid)
5. Factura arrives → transition to received
6. Final state: (received, paid)
```

### Cost flow — invoice-first (rare: factura arrives before payment)

```
1. Vendor sends factura with no prior quote or payment
2. New Incoming Invoice form used directly in "received" mode
   SUNAT fields populated from the XML, factura_status = received
3. Invoice is (received, unpaid) — shows up on "pay the factura" list
4. Payment made later → linked via payment line
5. Final state: (received, paid)
```

### Autodetracción (exceptional case)

When a client pays the full invoice amount to the regular account
without withholding the detracción, Alex is responsible for depositing
the detracción portion into Banco de la Nación himself. The system
records this as the real bank movements (one outbound from regular,
one inbound to BN) and both legs can be linked to the invoice for
history. The signed formula keeps the paid/outstanding math correct
automatically — it does not require a special case.

```
1. Client pays full amount to regular account (should have deducted detraction)
2. Payment recorded: inbound, regular account, full amount
   Payment line: outgoing_invoice_id = invoice
   [Invoice paid = total_pen, outstanding = 0 — the cash side is settled]
3. Alex makes the detracción transfer: two real bank movements, opposite
   directions, different accounts, same amount (the detracción amount)
4. Payment 2 recorded: outbound, regular account, detracción amount
   Payment line: outgoing_invoice_id = same invoice (preserved as history)
   [Contributes −detraction_amount under the signed formula]
5. Payment 3 recorded: inbound, Banco de la Nación, detracción amount
   (is_detraction = true auto-derived from the BN bank account)
   Payment line: outgoing_invoice_id = same invoice (preserved as history)
   [Contributes +detraction_amount under the signed formula]
6. Net effect: paid is unchanged (e.g. 100 − 12 + 12 = 100), outstanding
   stays at zero, and both transfer legs appear in the invoice's
   payment history for audit purposes
7. Accountant fills detraction_constancia_code, detraction_constancia_fecha,
   and detraction_constancia_url via updateOutgoingInvoice; optionally
   sets detraction_status to "autodetracted". These are informational
   flags — the system never enforces a state machine around them.
8. Bank reconciliation surfaces each leg as its own statement entry —
   the regular-account outbound on the BCP statement and the BN inbound
   on the Banco de la Nación statement. Each reconciles independently.
```

Between steps 4 and 5 (the window between recording the outbound leg
and the inbound leg), `outstanding` will transiently show the detracción
amount. This is accepted — the moment the second leg lands, the signed
sum self-corrects. Alex can record both legs in either order.

---

## General Company Expenses

Not all outbound payments relate to a project. Rent, utilities, administrative costs,
accounting fees — these are general company expenses. They are recorded as payments
with `project_id = null`. They may or may not have an associated incoming invoice.

General expenses affect the company's overall cash position but do not affect any
project's profit calculation.

---

## Partner Profit Settlement (Liquidación)

At project completion (or at any point for a progress calculation), the system computes:

```
For project P:

revenue              = SUM(total_amount_pen FROM payments WHERE direction=inbound, project_id=P)
total_costs          = SUM(total_amount_pen FROM payments WHERE direction=outbound, project_id=P)
gross_profit         = revenue − total_costs

For each partner X:
  costs_by_x         = SUM(total_amount_pen FROM payments WHERE direction=outbound,
                           project_id=P, paid_by_partner_id=X)
  profit_share_x     = gross_profit × partner.profit_split_pct / 100
  total_owed_to_x    = costs_by_x + profit_share_x

Korakuen owes partner X: total_owed_to_x
(Korakuen has collected all revenue and must distribute accordingly)
```

This calculation is always derived — never stored. The engine exposes a
`GET /projects/{id}/settlement` endpoint that returns this calculation on demand.

---

## IGV Position

The system can compute Korakuen's net IGV position at any time:

```
igv_output = SUM(igv_amount on outgoing_invoices WHERE status = sent AND estado_sunat = 'accepted')
igv_input  = SUM(igv_amount on incoming_invoices WHERE factura_status = received)
net_igv    = igv_output − igv_input
```

Positive `net_igv` = Korakuen owes SUNAT this amount.
Negative `net_igv` = SUNAT owes Korakuen a credit (crédito fiscal).

**`expected` incoming invoices are excluded** — they have no valid SUNAT
paperwork and cannot generate IGV credit. They become eligible for IGV input
only when they transition to `received`.

This is exposed via `GET /reports/igv-position?period_start=&period_end=`.

---

*Last updated: April 2026*
