# Korakuen — API Design Principles

> Locked architectural decisions for the Korakuen application layer.
>
> **Phase 1 (current):** These principles apply to Next.js server actions.
> Business logic lives in `lib/validators/` and `lib/lifecycle.ts`.
>
> **Phase 2 (future):** The same principles apply to the FastAPI engine.
> Server actions become API clients. Logic migrates from TypeScript to Python.
> The principles themselves do not change between phases.
>
> Related: `architecture.md` · `schema-reference.md` · `domain-model.md`

---

## Base Conventions

**Phase 1 (Next.js server actions):**
- Server actions live in `app/actions/`
- Every action validates input via `lib/validators/` before touching the database
- Every action checks status transitions via `lib/lifecycle.ts`
- Responses follow the shape conventions below

**Phase 2 (FastAPI engine):**
- Base URL: `https://korakuen-engine.onrender.com/v1` (production) / `http://localhost:8000/v1` (local)
- Authentication: every request requires `Authorization: Bearer <token>`
- Content type: `application/json`
- Versioning: all endpoints prefixed `/v1`

**In both phases, the following conventions are identical:**

---

## Amount Conventions

### Amounts are stored as numeric, not integers

Unlike a personal finance app where amounts are always in one currency and cents are clean,
Korakuen deals with Peruvian construction contracts where amounts routinely have decimal
places (e.g. S/ 45,832.50). All monetary amounts are stored as `numeric(15,2)` — up to
13 digits before the decimal, always 2 decimal places. Never floating point.

### Every amount has a PEN equivalent

Every monetary field that could be in USD is stored with two values:
- `amount` + `currency` — the original agreed value
- `amount_pen` + `exchange_rate` — the PEN equivalent at transaction time

The engine is exclusively responsible for currency conversion. No client ever performs
currency math. Reports always aggregate `amount_pen`.

### Subtotal, IGV, and total are always three separate fields

Never store just the total. Never derive subtotal from total minus IGV. All three are stored
explicitly because:
1. IGV input/output position is a SUNAT reporting requirement
2. Some transactions may have IGV exemptions (the rate is not always 18%)
3. Rounding behavior between subtotal × 0.18 and the actual IGV on a SUNAT document
   can differ — the XML value is authoritative

```
subtotal    — net amount before tax (valor de venta)
igv_amount  — tax amount (always from the SUNAT document, not computed)
total       — subtotal + igv_amount (stored for convenience, always validated against the sum)
```

### Detracciones are stored as rate + amount, both

```
detraction_rate    — the % applied (e.g. 0.04 for 4%, 0.12 for 12%)
detraction_amount  — the PEN amount (always PEN, even for USD invoices)
```

The detraction amount on a USD invoice requires a currency conversion. The engine handles
this using the `exchange_rate` at the time of the transaction. The rate is stored
explicitly on the record — never looked up retroactively.

---

## Error Format

All errors return a consistent shape regardless of error type:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description in English.",
    "fields": {
      "igv_amount": "Must equal subtotal × igv_rate. Expected 8100.00, received 8000.00."
    }
  }
}
```

Standard error codes:
- `VALIDATION_ERROR` — request body failed validation (400)
- `NOT_FOUND` — resource does not exist or is not accessible to this user (404)
- `FORBIDDEN` — authenticated but insufficient role (403)
- `UNAUTHORIZED` — missing or invalid token (401)
- `CONFLICT` — state transition not allowed (e.g. editing an approved invoice) (409)
- `IMMUTABLE_FIELD` — attempting to update a locked field (422)

---

## Pagination

All list endpoints accept `?limit=50&offset=0`. Default limit: 50. Maximum limit: 200.

Response envelope for all list endpoints:
```json
{
  "data": [...],
  "total": 142,
  "limit": 50,
  "offset": 0
}
```

---

## Soft Deletes

All mutable tables carry `deleted_at` (nullable timestamptz). Hard deletion is never
performed on any financial record. Soft-deleted records are excluded from all list
responses by default. Pass `?include_deleted=true` to include them.

Deletion of an approved financial record returns `409 CONFLICT`. Records must be voided
before deletion, and voiding is preferred over deletion in almost all cases.

---

## Formulas (Derived Calculations)

The system stores payments as primary records and derives everything else at
query time. These are the canonical formulas — any reporting endpoint must use
the same math. They live here so every implementer reaches for the same
reference instead of rederiving them per-feature.

### Bank account balance

```
balance_pen(account) =
  SUM(payments.total_amount_pen WHERE direction = inbound  AND bank_account_id = account)
− SUM(payments.total_amount_pen WHERE direction = outbound AND bank_account_id = account)
```

Scoped to `deleted_at IS NULL`. Returned as a computed field on bank account
responses. Also exposed via the SQL function `get_bank_account_balance(account_id)`.

### Invoice payment progress (outgoing and incoming)

The `status` column on outgoing invoices carries workflow state only
(`draft | sent | void`); `factura_status` on incoming invoices tracks
whether the SUNAT paperwork is in hand (`expected | received`). Payment
progress is **always derived from payment_lines** — never stored on either
side, never conflated with workflow state.

**`paid` is a signed sum.** The sign is positive when money flows **toward**
the invoice's owner (Korakuen for outgoing, the vendor for incoming) and
negative when it flows away. One formula shape handles normal payments,
refunds, self-detracciones, and internal transfers — the direction column
on `payments` carries the semantics.

```
-- Outgoing invoice (money flows toward Korakuen)
paid = SUM(
         CASE WHEN p.direction = 1 (inbound)  THEN  pl.amount_pen
              WHEN p.direction = 2 (outbound) THEN -pl.amount_pen
         END
       )
       FROM payment_lines pl
       JOIN payments p ON p.id = pl.payment_id
       WHERE pl.outgoing_invoice_id = this AND p.deleted_at IS NULL

-- Incoming invoice (money flows toward the vendor)
paid = SUM(
         CASE WHEN p.direction = 2 (outbound) THEN  pl.amount_pen
              WHEN p.direction = 1 (inbound)  THEN -pl.amount_pen
         END
       )
       FROM payment_lines pl
       JOIN payments p ON p.id = pl.payment_id
       WHERE pl.incoming_invoice_id = this AND p.deleted_at IS NULL

outstanding    = MAX(total_pen - paid, 0)  -- clamped for display
is_fully_paid  = (paid >= total_pen)       -- uses raw (unclamped) paid
payment_state  = CASE
                   WHEN paid <= 0             THEN 'unpaid'
                   WHEN paid <  total_pen     THEN 'partially_paid'
                   ELSE                            'paid'
                 END
```

**Why signed, not absolute.** The signed formula handles four real-world
scenarios with one mechanism:

1. **Normal payment** — client pays Alex (inbound → outgoing) or Alex
   pays vendor (outbound → incoming). Positive contribution.
2. **Refund** — Alex refunds a client (outbound linked to outgoing) or a
   vendor refunds Alex (inbound linked to incoming). Negative contribution;
   outstanding goes back up.
3. **Self-detracción** — client pays 100% to the regular account; Alex
   later moves the detracción portion from regular to Banco de la Nación.
   Both legs (outbound from regular, inbound to BN) are linked to the same
   outgoing invoice. They net to zero by construction — invoice paid is
   unchanged, but the transfer shows up in the invoice's history.
4. **Transient half-state** — if Alex records one leg of a self-detracción
   before the other, `outstanding` transiently shows positive. This is
   accepted behavior; the moment the second leg lands, it self-corrects.

**Outstanding is clamped at zero for display.** A cleanly paid invoice
plus a partial outbound reversal would otherwise show negative outstanding
in the UI during the interval between the two legs. `is_fully_paid` uses
the raw unclamped `paid` so a fully-refunded invoice (paid = 0) flips back
to `unpaid` rather than getting stuck as "paid".

**Detraccion columns are informational.** `detraction_rate`,
`detraction_amount`, `detraction_status`, `detraction_handled_by`, and the
`detraction_constancia_*` fields are stored reference data, not inputs to
the formula above. No derivation reads them; no validator gates on them.
Accountants maintain them manually.

### Outgoing invoice SUNAT registration

Derived — never stored as a separate column. Read directly from the
`estado_sunat` value:

```
sunat_state = CASE
                WHEN estado_sunat IS NULL      THEN 'not_submitted'
                WHEN estado_sunat = 'pending'  THEN 'pending'
                WHEN estado_sunat = 'accepted' THEN 'accepted'
                WHEN estado_sunat = 'rejected' THEN 'rejected'
              END
```

Both `payment_state` and `sunat_state` are returned under `_computed` on
every outgoing invoice response.

### Incoming invoice "needs factura" flag

Incoming invoices carry one extra derived field — `needs_factura` — which
combines workflow and payment state:

```
needs_factura = (factura_status = 'expected' AND paid > 0)
```

Surfaces invoices where Alex has already sent money and needs to nag the
vendor for the paper trail.

### Project actual spend and margin

```
actual_spend_pen = SUM(payments.total_amount_pen
                       WHERE direction = outbound AND project_id = P)
estimated_cost_pen = SUM(project_budgets.budgeted_amount_pen WHERE project_id = P)
expected_margin_pen = projects.contract_value_pen − estimated_cost_pen
actual_margin_pen   = projects.contract_value_pen − actual_spend_pen
```

Estimated cost is always derived from `project_budgets` — never stored as a
column on `projects`.

### IGV position (net tax)

```
igv_output  = SUM(outgoing_invoices.igv_amount
                  WHERE status = sent
                    AND estado_sunat = 'accepted'
                    AND deleted_at IS NULL)
igv_input   = SUM(incoming_invoices.igv_amount
                  WHERE factura_status = received
                    AND deleted_at IS NULL)
net_igv     = igv_output − igv_input
```

Positive `net_igv` means Korakuen owes SUNAT this amount. Negative means
crédito fiscal. **`expected` incoming invoices are excluded** — they have no
valid SUNAT paperwork so they cannot generate IGV credit. **Outgoing invoices
that are draft, void, or have `estado_sunat != 'accepted'` are excluded** —
the IGV output obligation exists only once the document is legally registered
in SUNAT's system. Sent-but-pending invoices show up in the report as soon as
the billing provider confirms SUNAT acceptance.

### Cash position (all accounts)

```
cash_position_pen = SUM(balance_pen(a)) for all active bank_accounts a
cash_position_regular_pen = SUM(balance_pen(a)) WHERE a.account_type = 1 (regular)
cash_position_bn_pen      = SUM(balance_pen(a)) WHERE a.account_type = 2 (BN)
```

BN balance is reported separately because it can only be used for tax payments.

### Loan balance

```
principal_pen    = loans.principal_amount_pen
total_repaid_pen = SUM(payment_lines.amount_pen WHERE loan_id = this)
balance_pen      = principal_pen − total_repaid_pen
status           = CASE
                     WHEN total_repaid = 0           THEN 'active'
                     WHEN total_repaid < principal   THEN 'partially_repaid'
                     ELSE                                 'settled'
                   END
```

Never stored — always derived from payment lines.

### Partner settlement (liquidación)

At project completion (or at any point for a progress view):

```
revenue_pen      = SUM(payments.total_amount_pen WHERE direction = inbound, project_id = P)
total_costs_pen  = SUM(payments.total_amount_pen WHERE direction = outbound, project_id = P)
gross_profit_pen = revenue_pen − total_costs_pen

For each partner X on project P:
  costs_by_x_pen  = SUM(payments.total_amount_pen WHERE direction = outbound,
                        project_id = P, paid_by_partner_id = X)
  profit_share_x  = gross_profit_pen × (partner.profit_split_pct / 100)
  total_owed_x    = costs_by_x_pen + profit_share_x
```

In plain words: each partner gets reimbursed what they actually spent out of
pocket, plus their agreed share of the gross profit. We split profit, not
revenue — that is the whole point of this formula. Korakuen (which collects
all revenue) owes each partner `total_owed_x`.

Exposed via `GET /projects/{id}/settlement`.

---



Every financial document has a `status` field. Status transitions are enforced by the
engine — clients cannot set arbitrary status values. Dedicated action endpoints handle
transitions:

```
POST /invoices/{id}/approve
POST /invoices/{id}/void
POST /invoices/{id}/mark-sent
```

The general rule: once a document reaches `approved` status, its financial fields
(`subtotal`, `igv_amount`, `total`, `detraction_amount`) become immutable. The engine
returns `422 IMMUTABLE_FIELD` if a client attempts to update these fields on an
approved document.

Voiding is always allowed on approved documents and creates an audit log entry.
A voided document can never be re-approved — a new document must be created.

---

## Null Over Omission

All optional fields are always present in API responses, set to `null` when empty.
The response shape is identical regardless of data presence. Example:

```json
{
  "id": "uuid",
  "incoming_quote_id": null,
  "detraction_rate": null,
  "detraction_amount": null,
  "xml_url": null
}
```

Clients never check for key existence. They always find the key, potentially null.

---

## Derived Values in API Responses

Balances, outstanding amounts, and financial positions are never stored in the database
if they can be derived from payments. However, they ARE included in API responses
as computed fields — the engine calculates them at query time.

Convention: computed fields are clearly labeled in the response:

```json
{
  "id": "uuid",
  "total": 100000.00,
  "_computed": {
    "payment_state": "paid",
    "paid": 100000.00,
    "outstanding": 0.00,
    "is_fully_paid": true
  }
}
```

The `_computed` namespace makes it explicit that these values are derived and should
never be sent back in write requests. Any `_computed` fields in a request body are
silently ignored.

---

## Role-Based Access

Two roles: `admin` and `partner`.

| Resource | Admin | Partner |
|---|---|---|
| All projects (list) | ✓ | Only assigned projects |
| Project financials | ✓ | Only their project |
| All contacts | ✓ | Read-only |
| All bank accounts | ✓ | No access |
| Partner cost contributions | ✓ | Own contributions only |
| Profit split calculations | ✓ | Own share only |
| Activity log | ✓ | No access |
| System settings | ✓ | No access |

Partners are assigned to projects via `project_partners`. A partner attempting to access
a project they are not assigned to receives `404` (not `403`) — we do not confirm the
existence of resources the requester cannot access.

---

## SUNAT Document Validation

When an invoice is created with SUNAT XML metadata, the engine validates that:
1. `total = subtotal + igv_amount` (within S/ 0.01 rounding tolerance)
2. `igv_amount` matches the value in the XML (not recomputed from subtotal)
3. `serie_numero` matches the expected format (e.g. `F001-00000142`)
4. `ruc_emisor` is a valid 11-digit RUC format
5. If `detraction_amount` is present, `detraction_constancia_code` should eventually
   be provided (warned, not blocked — the constancia may arrive later)

Validation failures return `400 VALIDATION_ERROR` with field-level messages.

---

## File Attachments

Files (PDFs, XMLs, images) are stored in Supabase Storage. The engine stores only the
URL reference. File upload is a two-step process:

1. Client uploads file directly to Supabase Storage (bypassing the engine)
2. Client sends the resulting URL to the engine as part of the document create/update request

The engine never handles file bytes. It only stores and returns URLs.

---

## Activity Log

Every mutation to any financial table produces an immutable row in `activity_log`:

```json
{
  "id": "uuid",
  "resource_type": "outgoing_invoice",
  "resource_id": "uuid",
  "action": "approved",
  "actor_user_id": "uuid",
  "before": { ...previous state... },
  "after": { ...new state... },
  "created_at": "2026-04-09T14:32:00Z"
}
```

Activity log rows are never updated or deleted. There is no `deleted_at` on this table.
The activity log is append-only.

---

## No Offline-First, No Sync

This system serves three users on reliable internet connections. There is no sync token
pattern, no version column for delta sync, no client-side conflict resolution. Every
API response reflects current database state. Reload is acceptable and expected.

Consequences:
- No `sync_checkpoints` table
- No `version` column on mutable tables (except as optimistic locking for concurrent edits — low priority, deferred)
- No tombstone delivery in responses
- No idempotency key infrastructure (standard database transactions handle atomicity)

---

## OpenAPI as the System Contract

FastAPI generates an OpenAPI spec automatically from route definitions. This spec is
the formal definition of everything the system can do.

The spec is available at:
- `GET /openapi.json` — machine-readable
- `GET /docs` — Swagger UI (primary testing interface during development)
- `GET /redoc` — ReDoc UI (alternative)

An `llms.txt` file will be maintained at the engine root, summarizing the API surface
for LLM agent consumption. This enables Claude Code and other AI agents to write
correct matching CLI and dashboard code without guesswork.

---

## External API Integrations

### Exchange Rate Cron — `/api/cron/fetch-exchange-rates`

Daily Vercel Cron job that fetches the official USD/PEN rate from BCRP (the
Peruvian central bank) and upserts it into `exchange_rates`. No fallback.
Fails loudly. Surfaces as a dashboard alert when today's rate is missing.

**Source:** BCRP statistics API — `https://estadisticas.bcrp.gob.pe/estadisticas/series/api`
Series `PD04639PD` (compra) + `PD04640PD` (venta) — the same SBS interbank rates
SUNAT publishes for tax purposes. No auth, no rate limits, supports historical
date ranges.

**Route:** `app/api/cron/fetch-exchange-rates/route.ts`
**Helper:** `lib/bcrp.ts` (BCRP fetch, parse, upsert)
**Schedule:** Vercel Cron — `0 14 * * *` (14:00 UTC = 09:00 Lima time)
The cron fires every day; weekends are skipped inside the route.
**Environment variable required:** `CRON_SECRET` (shared secret used by Vercel
to authenticate requests at `/api/cron/*`).

**Date convention:** BCRP labels each rate by SBS closing date. SUNAT publishes
that same rate on the *next* business day. Korakuen stores rates by SUNAT
publication date (the date you would write on a tax document), so the cron
shifts BCRP dates forward by one business day before upserting.

What it stores per weekday:
- `rate_type = 'compra'` — bank buy rate
- `rate_type = 'venta'` — bank sell rate
- `rate_type = 'promedio'` — arithmetic mean, used as default throughout the system

Failure behaviour: route returns HTTP 500 with an error payload, Vercel logs
the failure, dashboard shows a persistent red banner until a rate for today
is stored. Manual entry available via the dashboard at
Settings → Tipos de Cambio → Registrar manualmente.

---

### RUC / DNI Lookup — Contact Auto-fill

SUNAT does not offer an official public API for RUC or DNI queries. Their data is
published as a "padrón reducido" (daily file). A small ecosystem of Peruvian
third-party services mirror this data and expose clean REST APIs.

**Recommended provider: apis.net.pe (decolecta)**

Reasons: most established provider in Peru, generous free tier, same provider
ecosystem as the tipo de cambio tooling, one token covers both if needed.

**RUC lookup endpoint:**
```
GET https://api.decolecta.com/v1/sunat/ruc?numero={ruc}
Authorization: Bearer {DECOLECTA_TOKEN}
```

**RUC response fields used by Korakuen:**
```json
{
  "razon_social": "DAJOYA S.A.C",
  "numero_documento": "20607291668",
  "estado": "ACTIVO",
  "condicion": "HABIDO",
  "direccion": "AV. PARQUE DE LAS LEYENDAS NRO 210 DEP. 902A URB. PANDO",
  "distrito": "SAN MIGUEL",
  "provincia": "LIMA",
  "departamento": "LIMA",
  "ubigeo": "150136"
}
```

**DNI lookup endpoint:**
```
GET https://api.decolecta.com/v1/reniec/dni?numero={dni}
Authorization: Bearer {DECOLECTA_TOKEN}
```

**DNI response fields used by Korakuen:**
```json
{
  "full_name": "TERNERO FERREIRA ALEX SEBASTIAN",
  "first_name": "ALEX SEBASTIAN",
  "first_last_name": "TERNERO",
  "second_last_name": "FERREIRA",
  "document_number": "74096613"
}
```

**Engine endpoint:**

```
GET /contacts/lookup?ruc=20601030013
GET /contacts/lookup?dni=46027897
```

The engine acts as the intermediary — the dashboard never calls the third-party API
directly. The API key (`DECOLECTA_TOKEN`) lives only in the engine's environment
variables. This allows swapping providers without any frontend changes.

**Flow — the only way to create a contact:**
```
User types a RUC or DNI in the New Contact form
  → Dashboard calls GET /contacts/lookup?ruc=...
    → Engine calls decolecta API
      → If identifier not found: return 404 — contact cannot be created
      → If found: return pre-filled contact object (NOT yet saved)
        → User reviews, adds optional fields (email, phone, role flags)
          → Dashboard calls POST /contacts with the verified data
            → Engine re-verifies sunat_verified = true, saves contact
```

**There is no manual contact creation path.** `POST /contacts` requires a valid
`ruc` or `dni` that was looked up via the decolecta API in the same session.
The engine sets `sunat_verified = true` and `sunat_verified_at = now()` itself —
these fields cannot be set by the client. Any attempt to create a contact without
a SUNAT-verified identifier returns `422 VALIDATION_ERROR`.

**What the user can edit after lookup:**
- `nombre_comercial` — trading name (not in SUNAT data)
- `email`, `phone` — contact details
- `is_client`, `is_vendor`, `is_partner` — role flags
- `notes` — internal notes

**What the user cannot edit:**
- `ruc`, `dni`, `razon_social`, `tipo_persona` — locked from SUNAT data
- `sunat_estado`, `sunat_condicion`, `sunat_verified`, `sunat_verified_at` — engine-only

**Inactive/non-habido contacts:** If SUNAT returns `estado != 'ACTIVO'` or
`condicion != 'HABIDO'`, the lookup returns the data with a `warning` field:
```json
{
  "ruc": "20601030013",
  "razon_social": "EMPRESA BAJA SAC",
  "sunat_estado": "BAJA DE OFICIO",
  "sunat_condicion": "NO HABIDO",
  "warning": "Este contribuyente tiene estado BAJA DE OFICIO y condición NO HABIDO en SUNAT. ¿Desea continuar?"
}
```
The user sees the warning and explicitly confirms before the contact is saved.
Creation is not blocked — a vendor may be inactive in SUNAT but still owe you a
payment or have historical transactions. The warning is surfaced, the decision is yours.

**Field mapping — RUC to contact:**

| Decolecta field | Korakuen field |
|---|---|
| `razon_social` | `razon_social` |
| (input RUC) | `ruc` (stored as the input we provided) |
| `estado` + `condicion` | displayed as warnings if not ACTIVO/HABIDO |
| `direccion` | `address` |
| `distrito` + `provincia` + `departamento` | `address` (concatenated) |
| RUC prefix `"20"` | `tipo_persona = 2` (juridica) |
| RUC prefix other | `tipo_persona = 1` (natural) |

**Field mapping — DNI to contact:**

| Decolecta field | Korakuen field |
|---|---|
| `full_name` | `razon_social` |
| (input DNI) | `dni` (stored as the input we provided) |
| always | `tipo_persona = 1` (natural) |

**`sunat_verified` flag:** All contacts are created via lookup and flagged
`sunat_verified = true` + `sunat_verified_at = now()`. There is no manual
creation path — the DB constraint `contact_must_be_verified` enforces this.

**Fallback providers** (if decolecta is down or rate-limited):
- `apiinti.dev` — 200 free queries/month, good docs
- `apiperu.dev` — similar feature set
- `api.migo.pe` — also covers tipo de cambio

All pull from the same SUNAT padrón so data is identical across providers.

**Environment variable required:** `DECOLECTA_TOKEN`

---

### `GET /system/health`

No authentication required. Returns the operational status of critical system
dependencies. Used by the dashboard to surface alerts to the admin.

**Response:**

```json
{
  "status": "degraded",
  "checks": {
    "database": {
      "ok": true
    },
    "exchange_rate": {
      "ok": false,
      "last_rate_date": "2026-04-07",
      "last_rate_promedio": 3.7482,
      "days_since_last_rate": 2,
      "alert": "No exchange rate for today (2026-04-09). Transactions in USD cannot be converted. Enter the rate manually."
    }
  }
}
```

**`status` values:**
- `"ok"` — all checks pass
- `"degraded"` — one or more non-critical checks failing (system still usable)
- `"down"` — database unreachable (system unusable)

**Exchange rate check logic:**
```python
today = date.today()
if today.weekday() >= 5:
    # Weekend — no rate expected, not an alert
    ok = True
else:
    # Weekday — rate must exist for today
    last_rate = query most recent exchange_rate row (rate_type = 'promedio')
    ok = (last_rate.rate_date == today)
    days_since = (today - last_rate.rate_date).days
```

**Dashboard behaviour:**
- If `exchange_rate.ok = false` and today is a weekday: show a persistent banner
  at the top of every page (not just a settings page). Red background.
  Message: "Tipo de cambio no disponible para hoy. Los montos en USD no pueden
  convertirse. [Registrar manualmente →]"
- The banner includes a direct link to the manual rate entry form.
- The banner disappears automatically once a rate for today is stored.
- Partners see a softer version of the alert (yellow, no action link) since
  they cannot enter rates.

---

*Last updated: April 2026*
