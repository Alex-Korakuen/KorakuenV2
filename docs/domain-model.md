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
3. Revenue documents — the money coming in (quotes, contracts, outgoing invoices)
4. Cost documents    — the money going out (commitments, incoming invoices)
5. Transactions      — actual cash movements, in both directions
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
prospect → active → completed → [archived]
```

- `prospect` — opportunity being pursued. A quote may exist. No contract yet.
- `active` — contract signed. Invoicing has begun or will begin.
- `completed` — all work done, all invoices issued, all payments received (or written off).
- `archived` — completed project moved out of active views.

**One contract per project.** The relationship is always 1:1. If scope changes
significantly enough to require a new contract, it is a new project.

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
Total revenue collected (inbound transactions on this project)
  − Total costs (ALL outbound transactions on this project, by all partners)
  = Gross profit

Each partner receives:
  Their costs back (sum of outbound transactions where paid_by_partner = this partner)
  + Their profit share (gross_profit × their profit_split_pct / 100)
```

This means Korakuen (which collects all revenue) owes each partner:
- Reimbursement of their direct costs
- Their proportional profit share

The system tracks this as a running liability per partner per project, updated every time
a transaction is recorded.

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

### Contracts (Contratos)

**What it is:** The signed agreement between Korakuen and the client. Defines the total
project value, billing frequency, and currency. Marks the transition from `prospect` to
`active` on the project.

**One contract per project.** The contract's `total` value is the revenue target the
project is measured against.

**Key fields:**
- `project_id`
- `quote_id` — the approved quote this originated from (nullable — some contracts are
  signed directly without a prior formal quote)
- `contact_id` — the client
- `total_value`, `currency`
- `billing_frequency` — `weekly | biweekly | monthly | milestone`
- `start_date`, `expected_end_date`
- `signed_date`
- `pdf_url`

### Outgoing Invoices (Facturas Emitidas)

**What it is:** A periodic billing event sent to the client. Each invoice covers a defined
period of work. A valorización (progress document) may accompany the invoice as a PDF
attachment — it is not a separate tracked entity in the system.

**Lifecycle:** `draft → sent → partially_paid → paid | void`

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
expected_regular      = total_pen − detraction_amount
expected_bn           = detraction_amount
paid_regular          = SUM(transactions where invoice_id = this AND is_detraction = false)
paid_bn               = SUM(transactions where invoice_id = this AND is_detraction = true)
outstanding_regular   = expected_regular − paid_regular
outstanding_bn        = expected_bn − paid_bn
is_fully_paid         = outstanding_regular = 0 AND outstanding_bn = 0
```

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
detraction_handled_by          — client_deposited | vendor_handled | not_applicable
detraction_constancia_code     — SUNAT operation code (provided by client)
detraction_constancia_fecha    — date of BN deposit
detraction_constancia_url      — PDF of constancia
```

---

## 4. Cost Documents

The money going out. Two document types on the cost side.

### Commitments (Compromisos)

**What it is:** A recorded obligation to pay a vendor. Created when Korakuen approves a
vendor's quote or agrees to a scope of work. The commitment exists before any payment is
made and before any invoice arrives. It represents: "we have agreed to spend this amount."

**Why it exists:** In Korakuen's payment flow, cash often goes out before the formal
invoice arrives. The commitment is the anchor that ties the payment to the right vendor,
project, and scope — even when the invoice is not yet in hand.

**Optional:** Not every outbound payment has a prior commitment. A supplier payment on
delivery may have no prior commitment. In this case, the payment is recorded directly
and matched to the incoming invoice when it arrives.

**Lifecycle:** `draft → approved → partially_paid → fully_paid | cancelled`

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

**What it is:** A SUNAT factura received from a vendor. In Korakuen's workflow, this
almost always arrives AFTER the payment has already been made. The incoming invoice is
registered when it physically arrives — it is matched to the commitment and to the
payment(s) that already settled it.

**Key behavioral rule:** An incoming invoice does not trigger payment. Payment has
already happened. The invoice is registered for accounting and SUNAT compliance purposes.

**Lifecycle:** `received → matched | mismatched`

- `matched` — the invoice amount reconciles with the recorded payment(s) and commitment
- `mismatched` — the invoice amount differs from what was paid or committed (requires
  review — may need a credit note, an additional payment, or a correction)

**Key fields:**
```
project_id            — nullable
contact_id            — the vendor
commitment_id         — nullable (matched to prior commitment if one exists)
factura_number        — the vendor's invoice number

subtotal, igv_amount, total
currency, exchange_rate, total_pen
detraction_rate, detraction_amount

-- SUNAT document fields (extracted from XML)
serie_numero
fecha_emision
tipo_documento_code
ruc_emisor            — vendor's RUC (should match contact.ruc)
ruc_receptor          — Korakuen's RUC
hash_cdr
estado_sunat

pdf_url, xml_url

-- Detracción proof
detraction_handled_by          — self | vendor_handled | not_applicable
detraction_constancia_code
detraction_constancia_fecha
detraction_constancia_url
```

---

## 5. Transactions

**What it is:** Every actual cash movement — inbound or outbound — recorded in the system.
This is the most important table. Bank account balances, outstanding amounts, partner
contributions, and profit calculations are all derived from this table.

**The fundamental rule:** One transaction = one cash movement on one bank account.

When a single invoice settlement involves two bank accounts (regular + Banco de la Nación
for detracciones), that is TWO transactions — one per account. The invoice links to both.

**Direction:**
- `inbound` — cash coming into a Korakuen bank account (client pays us)
- `outbound` — cash going out of a Korakuen bank account (we pay a vendor)

**The invoice link:**
A transaction optionally links to an outgoing or incoming invoice. This link indicates
which billing event this cash movement settles. An unmatched transaction (no invoice link)
is valid — it represents cash that has moved but not yet been formally linked to a document.

**Unmatched transactions are normal.** In Korakuen's workflow:
- Payment goes out before the invoice arrives → transaction recorded, `incoming_invoice_id = null`
- Invoice arrives later → `incoming_invoice_id` is set on the existing transaction

**One transaction → one invoice.** A single cash movement settles (part of) one invoice.
One invoice can be settled by multiple transactions (partial payments). The inverse is not
supported — one transaction cannot be split across multiple invoices.

**Paid-by partner tracking:**
On outbound transactions, `paid_by_partner_id` records which partner company's money
went out. This is essential for profit split calculations — it determines how much each
partner is owed back from project revenue.

**Key fields:**
```
direction             — inbound | outbound
bank_account_id       — always required
project_id            — nullable (null = general company expense)
contact_id            — who paid us or who we paid
paid_by_partner_id    — nullable, FK → contacts (which partner company paid this)

amount                — original amount
currency              — PEN | USD
exchange_rate         — nullable (required when currency = USD)
amount_pen            — always stored (= amount if PEN, = amount × exchange_rate if USD)

outgoing_invoice_id   — nullable (set when this transaction settles an outgoing invoice)
incoming_invoice_id   — nullable (set when this transaction settles an incoming invoice)
commitment_id         — nullable (set when this transaction pays against a commitment)
is_detraction         — boolean (true = this is a Banco de la Nación deposit/withdrawal)

reconciled            — boolean (true = matched to bank statement entry)
bank_reference        — text, nullable (bank's own transaction reference number)
transaction_date      — the date the cash actually moved
notes                 — optional free text
```

**Constraint:** `outgoing_invoice_id` and `incoming_invoice_id` are mutually exclusive.
A transaction cannot simultaneously settle an outgoing and an incoming invoice. The engine
enforces this with a check constraint.

---

## 6. Bank Accounts

**What it is:** The accounts where Korakuen's cash lives. Every transaction must specify
a bank account. The bank account balance is the sum of all transactions on that account:

```
balance = SUM(amount_pen WHERE direction = 'inbound') 
        − SUM(amount_pen WHERE direction = 'outbound')
```

**Banco de la Nación is just another bank account.** It has `account_type = banco_de_la_nacion`
which distinguishes it in the UI (shown separately from regular accounts), but mechanically
it works identically. Its balance is derived the same way. Transactions on it are marked
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
   a. Transaction recorded: inbound, regular bank account, amount = total − detraction
      outgoing_invoice_id = this invoice, is_detraction = false
   b. Transaction recorded: inbound, Banco de la Nación, amount = detraction_amount
      outgoing_invoice_id = this invoice, is_detraction = true
7. Invoice status becomes: partially_paid → paid (when outstanding = 0)
8. Next billing period → repeat from step 4
9. Final invoice paid → Project status: completed
```

### Cost flow (money out — normal case with commitment)

```
1. Vendor submits quote → Commitment created (status: draft)
2. Commitment approved (status: approved)
3. Payment made before invoice arrives:
   a. Transaction recorded: outbound, bank account, amount paid
      commitment_id = this commitment, incoming_invoice_id = null
      paid_by_partner_id = which partner company's funds were used
   b. If detraction applies:
      Second transaction: outbound, Banco de la Nación, detraction amount
      is_detraction = true
4. Vendor sends factura → Incoming invoice registered (status: received)
   commitment_id = matched commitment
5. Existing transaction(s) matched: incoming_invoice_id = this invoice
6. Amounts validated: invoice total should match sum of transactions
   → status: matched (or mismatched if discrepancy)
```

### Cost flow (no prior commitment — supplier on delivery)

```
1. Supplier delivers materials, payment made on the spot
2. Transaction recorded immediately: outbound, bank account
   commitment_id = null, incoming_invoice_id = null (invoice not yet in hand)
   paid_by_partner_id = paying partner
3. Supplier sends factura (same day or later)
4. Incoming invoice registered
5. Transaction updated: incoming_invoice_id = this invoice
6. Status: matched
```

### Autodetracción (exceptional case)

```
1. Client pays full amount to regular account (should have deducted detraction)
2. Transaction recorded: inbound, regular account, full amount
   outgoing_invoice_id = invoice, is_detraction = false
   [This overstates regular receipts by the detraction amount]
3. SUNAT autodetracts from our Banco de la Nación
4. Transaction recorded: outbound, Banco de la Nación, detraction amount
   outgoing_invoice_id = same invoice, is_detraction = true
5. Invoice detraction_status set to: autodetracted
6. Notes on original transaction updated to flag the irregularity
7. Bank reconciliation will surface the BN debit — reconciled against step 4 transaction
```

---

## General Company Expenses

Not all outbound transactions relate to a project. Rent, utilities, administrative costs,
accounting fees — these are general company expenses. They are recorded as transactions
with `project_id = null`. They may or may not have an associated incoming invoice.

General expenses affect the company's overall cash position but do not affect any
project's profit calculation.

---

## Partner Profit Settlement (Liquidación)

At project completion (or at any point for a progress calculation), the system computes:

```
For project P:

revenue              = SUM(amount_pen, direction=inbound, project_id=P)
total_costs          = SUM(amount_pen, direction=outbound, project_id=P)
gross_profit         = revenue − total_costs

For each partner X:
  costs_by_x         = SUM(amount_pen, direction=outbound, project_id=P, paid_by_partner_id=X)
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
igv_output = SUM(igv_amount on outgoing_invoices, approved)
igv_input  = SUM(igv_amount on incoming_invoices, matched)
net_igv    = igv_output − igv_input
```

Positive `net_igv` = Korakuen owes SUNAT this amount.
Negative `net_igv` = SUNAT owes Korakuen a credit (crédito fiscal).

This is exposed via `GET /reports/igv-position?period_start=&period_end=`.

---

*Last updated: April 2026*
