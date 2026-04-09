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

## Status Lifecycles

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
    "paid_regular": 88000.00,
    "paid_bn": 12000.00,
    "total_paid": 100000.00,
    "outstanding_regular": 0.00,
    "outstanding_bn": 0.00,
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

### SUNAT Exchange Rate — `fetch_exchange_rates.py`

Daily cron job that fetches the official USD/PEN rate from SUNAT's XML endpoint.
No fallback. Fails loudly. Surfaces as a dashboard alert when missing.

**Source:** `https://www.sunat.gob.pe/cl-at-ittipcam/tcS01Alias`
**Script:** `fetch_exchange_rates.py` (in `korakuen-engine/jobs/`)
**Schedule:** Render Cron Job — `0 14 * * 1-5` (09:00 Lima time, weekdays only)
**Environment variable required:** `SUPABASE_DB_URL`

What it stores per weekday:
- `rate_type = 'compra'` — bank buy rate
- `rate_type = 'venta'` — bank sell rate
- `rate_type = 'promedio'` — arithmetic mean, used as default throughout the system

Failure behaviour: exits with code 1, Render logs the failure, dashboard shows a
persistent red banner until a rate for today is stored. Manual entry available via
the dashboard at Settings → Tipos de Cambio → Registrar manualmente.

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
  "nombre": "EMPRESA EJEMPLO S.A.C.",
  "tipoDocumento": "6",
  "numeroDocumento": "20601030013",
  "estado": "ACTIVO",
  "condicion": "HABIDO",
  "direccion": "AV. JAVIER PRADO ESTE NRO. 4600",
  "distrito": "LA MOLINA",
  "provincia": "LIMA",
  "departamento": "LIMA",
  "ubigeo": "150112"
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
  "nombre": "JUAN CARLOS",
  "apellidoPaterno": "GARCIA",
  "apellidoMaterno": "LOPEZ",
  "tipoDocumento": "1",
  "numeroDocumento": "46027897"
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
| `nombre` | `razon_social` |
| `numeroDocumento` | `ruc` |
| `estado` + `condicion` | displayed as warnings if not ACTIVO/HABIDO |
| `direccion` | `address` |
| `distrito` + `provincia` + `departamento` | `address` (concatenated) |
| `tipoDocumento = "6"` | `tipo_persona = 2` (juridica) |
| `tipoDocumento = "1"` | `tipo_persona = 1` (natural) |

**Field mapping — DNI to contact:**

| Decolecta field | Korakuen field |
|---|---|
| `nombre` + `apellidoPaterno` + `apellidoMaterno` | `razon_social` (full name) |
| `numeroDocumento` | stored in `dni` field (separate from `ruc`) |
| `tipoDocumento = "1"` | `tipo_persona = 1` (natural) |

**`sunat_verified` flag:** Contacts created via lookup are flagged
`sunat_verified = true` + `sunat_verified_at = now()`. Contacts entered manually
have `sunat_verified = false`. This lets you identify which contacts have been
validated against the official registry.

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
