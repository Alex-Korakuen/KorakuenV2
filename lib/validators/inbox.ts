import Papa from "papaparse";
import {
  success,
  failure,
  SUBMISSION_STATUS,
  SUBMISSION_SOURCE_TYPE,
} from "@/lib/types";
import type {
  ValidationResult,
  PaymentSubmissionHeader,
  PaymentSubmissionLine,
  PaymentSubmissionExtractedData,
  SubmissionFieldError,
  SubmissionValidationReport,
  SubmissionRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// CSV template contract
// ---------------------------------------------------------------------------
//
// A single flat CSV. Rows sharing the same `group_id` belong to the same
// payment (one header + N lines). Header fields repeat across rows of a
// group; we error if they disagree. Line fields are unique per row.
//
// Validation happens in two passes:
//   1. Structural (parseCsvPaymentRows + groupRowsByGroupId + buildFromGroup):
//      shape, enum normalization, header consistency within a group.
//   2. Semantic (validatePaymentSubmissionData): cross-field rules, totals,
//      structural constraints that depend on FK resolution performed by the
//      caller. Called again at approval time against live DB state.
//
// FK resolution (bank_account, project, contact, invoices) is done by the
// action layer — this file only deals with shape and pure rules.
// ---------------------------------------------------------------------------

export const CSV_HEADER_COLUMNS = [
  "group_id",
  "payment_date",
  "direction",
  "bank_account",
  "currency",
  "exchange_rate",
  "bank_reference",
  "is_detraction",
  "contact_ruc",
  "partner_ruc",
  "title",
  "line_amount",
  "line_type",
  "project_code",
  "invoice_number",
  "cost_category",
  "line_description",
] as const;

export type CsvColumn = (typeof CSV_HEADER_COLUMNS)[number];

export type RawCsvRow = {
  row_number: number; // 1-indexed, matches what a spreadsheet user sees
  group_id: string;
  payment_date: string;
  direction: string;
  bank_account: string;
  currency: string;
  exchange_rate: string;
  bank_reference: string;
  is_detraction: string;
  contact_ruc: string;
  partner_ruc: string;
  title: string;
  line_amount: string;
  line_type: string;
  project_code: string;
  invoice_number: string;
  cost_category: string;
  line_description: string;
};

// ---------------------------------------------------------------------------
// parseCsvPaymentRows
// ---------------------------------------------------------------------------

/**
 * Parse a CSV blob into an array of raw rows. Verifies header presence and
 * discards fully empty rows. Does NOT do semantic validation — every cell
 * is returned as a trimmed string, even if obviously wrong.
 */
export function parseCsvPaymentRows(
  csvText: string,
): ValidationResult<RawCsvRow[]> {
  if (!csvText || !csvText.trim()) {
    return failure("VALIDATION_ERROR", "CSV is empty");
  }

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });

  if (parsed.errors.length > 0) {
    // Only report the first structural parse error — row-level issues are
    // handled downstream.
    const first = parsed.errors[0];
    return failure(
      "VALIDATION_ERROR",
      `Error al leer el CSV: ${first.message} (fila ${first.row ?? "?"})`,
    );
  }

  const fields = parsed.meta.fields ?? [];
  const missing = CSV_HEADER_COLUMNS.filter((col) => !fields.includes(col));
  if (missing.length > 0) {
    return failure(
      "VALIDATION_ERROR",
      `Faltan columnas requeridas: ${missing.join(", ")}`,
    );
  }

  const rows: RawCsvRow[] = parsed.data.map((raw, i) => {
    const row: RawCsvRow = {
      row_number: i + 2, // +2 for header row + 1-indexing
      group_id: (raw.group_id ?? "").toString(),
      payment_date: (raw.payment_date ?? "").toString(),
      direction: (raw.direction ?? "").toString(),
      bank_account: (raw.bank_account ?? "").toString(),
      currency: (raw.currency ?? "").toString(),
      exchange_rate: (raw.exchange_rate ?? "").toString(),
      bank_reference: (raw.bank_reference ?? "").toString(),
      is_detraction: (raw.is_detraction ?? "").toString(),
      contact_ruc: (raw.contact_ruc ?? "").toString(),
      partner_ruc: (raw.partner_ruc ?? "").toString(),
      title: (raw.title ?? "").toString(),
      line_amount: (raw.line_amount ?? "").toString(),
      line_type: (raw.line_type ?? "").toString(),
      project_code: (raw.project_code ?? "").toString(),
      invoice_number: (raw.invoice_number ?? "").toString(),
      cost_category: (raw.cost_category ?? "").toString(),
      line_description: (raw.line_description ?? "").toString(),
    };
    return row;
  });

  if (rows.length === 0) {
    return failure("VALIDATION_ERROR", "El CSV no contiene filas de datos");
  }

  return success(rows);
}

// ---------------------------------------------------------------------------
// groupRowsByGroupId
// ---------------------------------------------------------------------------

/**
 * Group parsed rows by their group_id, preserving first-occurrence order so
 * the downstream list stays deterministic. Rows missing a group_id are
 * collected under a synthetic "__missing__" key so they can be surfaced as
 * errors rather than silently dropped.
 */
export function groupRowsByGroupId(
  rows: RawCsvRow[],
): Map<string, RawCsvRow[]> {
  const groups = new Map<string, RawCsvRow[]>();
  for (const row of rows) {
    const key = row.group_id.trim() || "__missing__";
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// buildSubmissionFromGroup
// ---------------------------------------------------------------------------

/**
 * Turn N raw CSV rows (all sharing one group_id) into a structured
 * `PaymentSubmissionExtractedData` ready for insertion into
 * `submissions.extracted_data`. Does NOT resolve FKs — the caller layers
 * those on top after the shape is valid.
 *
 * Semantic rules (amount>0, is_detraction forces PEN, etc.) are enforced in
 * `validatePaymentSubmissionData`, which is called on the built payload.
 */
export function buildSubmissionFromGroup(
  groupId: string,
  rows: RawCsvRow[],
): PaymentSubmissionExtractedData {
  if (rows.length === 0) {
    return {
      kind: "payment",
      header: blankHeader(),
      lines: [],
      validation: {
        valid: false,
        errors: [{ path: "group", message: "Grupo vacío" }],
      },
      csv_row_numbers: [],
    };
  }

  const first = rows[0];
  const header: PaymentSubmissionHeader = {
    payment_date: normalizeDate(first.payment_date) ?? null,
    direction: normalizeDirection(first.direction),
    bank_account_label: first.bank_account || null,
    bank_account_id: null,
    currency: normalizeCurrency(first.currency),
    exchange_rate: parseNumberOrNull(first.exchange_rate),
    bank_reference: first.bank_reference || null,
    is_detraction: parseBoolean(first.is_detraction),
    contact_ruc: first.contact_ruc || null,
    contact_id: null,
    partner_ruc: first.partner_ruc || null,
    partner_id: null,
    project_code: first.project_code || null,
    project_id: null,
    title: first.title || null,
  };

  const structuralErrors: SubmissionFieldError[] = [];

  if (groupId === "__missing__") {
    structuralErrors.push({
      path: "group_id",
      message: "group_id es requerido en cada fila",
    });
  }

  // Header consistency: every subsequent row in the group must repeat the
  // same header values verbatim.
  const headerFields = [
    "payment_date",
    "direction",
    "bank_account",
    "currency",
    "exchange_rate",
    "bank_reference",
    "is_detraction",
    "contact_ruc",
    "partner_ruc",
    "title",
  ] as const;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    for (const f of headerFields) {
      if (r[f].trim() !== first[f].trim()) {
        structuralErrors.push({
          path: `header.${f}`,
          message: `La columna "${f}" difiere entre filas del mismo group_id (fila ${r.row_number} vs fila ${first.row_number})`,
        });
      }
    }
  }

  const lines: PaymentSubmissionLine[] = rows.map((r) => ({
    amount: parseNumberOrNull(r.line_amount),
    line_type: normalizeLineType(r.line_type),
    invoice_number_hint: r.invoice_number || null,
    outgoing_invoice_id: null,
    incoming_invoice_id: null,
    cost_category_label: r.cost_category || null,
    cost_category_id: null,
    description: r.line_description || null,
  }));

  const extracted: PaymentSubmissionExtractedData = {
    kind: "payment",
    header,
    lines,
    validation: { valid: false, errors: [] },
    csv_row_numbers: rows.map((r) => r.row_number),
  };

  const semantic = validatePaymentSubmissionData(extracted);
  extracted.validation = {
    valid: semantic.valid && structuralErrors.length === 0,
    errors: [...structuralErrors, ...semantic.errors],
  };

  return extracted;
}

// ---------------------------------------------------------------------------
// validatePaymentSubmissionData
// ---------------------------------------------------------------------------

/**
 * Semantic validation of an already-built extracted_data payload. This is
 * the function called both after CSV parsing AND after every inline edit in
 * the Inbox UI. It does not touch the DB — FK checks (contact exists, bank
 * account exists, etc.) are layered on by the server action after this
 * passes.
 *
 * Rules enforced:
 * - Required header fields (date, direction, bank account, currency)
 * - contact_ruc is OPTIONAL (cash-basis: informal vendors may have no RUC)
 * - direction must be inbound|outbound
 * - currency must be PEN|USD
 * - exchange_rate, if supplied, must be > 0; blank is allowed (USD payments
 *   resolve the rate from the exchange_rates table at approval time)
 * - is_detraction=true forces currency=PEN
 * - At least one line; every line has amount>0 and a valid line_type
 * - line_type=loan cannot be resolved from CSV (no loan id) — flagged
 */
export function validatePaymentSubmissionData(
  data: PaymentSubmissionExtractedData,
): SubmissionValidationReport {
  const errors: SubmissionFieldError[] = [];
  const h = data.header;

  if (!h.payment_date) {
    errors.push({
      path: "header.payment_date",
      message: "Fecha de pago es requerida (formato DD/MM/YYYY o YYYY-MM-DD)",
    });
  }
  if (!h.direction) {
    errors.push({
      path: "header.direction",
      message: 'Dirección debe ser "inbound" o "outbound"',
    });
  }
  if (!h.bank_account_label) {
    errors.push({
      path: "header.bank_account",
      message: "Cuenta bancaria es requerida",
    });
  }
  if (!h.currency) {
    errors.push({
      path: "header.currency",
      message: 'Moneda debe ser "PEN" o "USD"',
    });
  }
  // contact_ruc is optional — cash-basis philosophy means we must record
  // that money moved even when the counterparty is unknown (informal
  // vendors, cash purchases, ambiguous bank deposits). When blank, the
  // payment stores contact_id = null and just doesn't show up in the
  // by-vendor/by-client groupings — everything else (cash flow, project
  // attribution, settlement) still works. If supplied, the format must be
  // valid so downstream SUNAT lookup can resolve it.
  if (h.contact_ruc && !/^\d{8}$|^\d{11}$/.test(h.contact_ruc)) {
    errors.push({
      path: "header.contact_ruc",
      message: "El RUC debe tener 8 u 11 dígitos (o dejar vacío si no se conoce)",
    });
  }

  // partner_ruc is optional at the Inbox level — if blank, the approval path
  // defaults to the is_self contact (Korakuen). If supplied, it must be a
  // valid-looking RUC so downstream resolution can match it to a contact.
  if (h.partner_ruc && !/^\d{8}$|^\d{11}$/.test(h.partner_ruc)) {
    errors.push({
      path: "header.partner_ruc",
      message: "El RUC del partner debe tener 8 u 11 dígitos",
    });
  }

  // exchange_rate is optional at Inbox level — if the user provides it, it
  // acts as a manual override (e.g. a bank-quoted rate that differs from
  // BCRP). If blank, the approval path resolves the rate from the
  // exchange_rates table using the payment_date. We only reject here when a
  // non-positive value is explicitly supplied.
  if (h.exchange_rate != null && h.exchange_rate <= 0) {
    errors.push({
      path: "header.exchange_rate",
      message: "Tipo de cambio debe ser mayor a 0",
    });
  }

  if (h.is_detraction && h.currency && h.currency !== "PEN") {
    errors.push({
      path: "header.is_detraction",
      message: "Detracciones solo pueden ser en PEN",
    });
  }

  if (!data.lines || data.lines.length === 0) {
    errors.push({
      path: "lines",
      message: "El pago debe tener al menos una línea",
    });
  } else {
    data.lines.forEach((line, i) => {
      if (line.amount == null || line.amount <= 0) {
        errors.push({
          path: `lines[${i}].amount`,
          message: "Monto debe ser mayor a 0",
        });
      }
      if (!line.line_type) {
        errors.push({
          path: `lines[${i}].line_type`,
          message:
            'Tipo de línea debe ser uno de: invoice, bank_fee, detraction, loan, general',
        });
      }
      if (line.line_type === "loan") {
        errors.push({
          path: `lines[${i}].line_type`,
          message:
            "Líneas de tipo 'loan' no pueden importarse por CSV (requieren un préstamo existente en el sistema). Cambia el tipo o edita después de aprobar.",
        });
      }
      if (
        line.line_type === "bank_fee" &&
        (line.invoice_number_hint || line.cost_category_label)
      ) {
        errors.push({
          path: `lines[${i}].line_type`,
          message:
            "Líneas de tipo 'bank_fee' no pueden enlazar a factura ni categoría",
        });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Normalizers (pure helpers, exported for testing)
// ---------------------------------------------------------------------------

export function normalizeDirection(
  raw: string,
): PaymentSubmissionHeader["direction"] {
  const v = raw.trim().toLowerCase();
  if (v === "inbound" || v === "entrada" || v === "in") return "inbound";
  if (v === "outbound" || v === "salida" || v === "out") return "outbound";
  return null;
}

export function normalizeCurrency(
  raw: string,
): PaymentSubmissionHeader["currency"] {
  const v = raw.trim().toUpperCase();
  if (v === "PEN" || v === "SOL" || v === "SOLES" || v === "S/") return "PEN";
  if (v === "USD" || v === "DOLAR" || v === "DOLARES" || v === "$") return "USD";
  return null;
}

export function normalizeLineType(
  raw: string,
): PaymentSubmissionLine["line_type"] {
  const v = raw.trim().toLowerCase().replace(/[\s-]/g, "_");
  if (
    v === "invoice" ||
    v === "bank_fee" ||
    v === "detraction" ||
    v === "loan" ||
    v === "general"
  ) {
    return v;
  }
  // Spanish aliases
  if (v === "factura") return "invoice";
  if (v === "comision" || v === "comisión") return "bank_fee";
  if (v === "detraccion" || v === "detracción") return "detraction";
  if (v === "prestamo" || v === "préstamo") return "loan";
  return null;
}

export function normalizeDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;

  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  // dd/mm/yyyy or dd-mm-yyyy
  const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }

  return null;
}

export function parseNumberOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  // Accept "1,234.50" or "1234.50" or "1234,50"
  const normalized = v.includes(",") && !v.includes(".")
    ? v.replace(/\./g, "").replace(",", ".")
    : v.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function parseBoolean(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "si" || v === "sí";
}

// ---------------------------------------------------------------------------
// FK resolution (pure, reusable across upload and edit paths)
// ---------------------------------------------------------------------------

type BankAccountRef = {
  id: string;
  name: string;
  account_number: string | null;
};

type ProjectRef = {
  id: string;
  code: string | null;
};

type ContactRef = {
  id: string;
  ruc: string | null;
};

export type ResolutionRefs = {
  bankAccounts: BankAccountRef[];
  projects: ProjectRef[];
  contactsByRuc: Map<string, ContactRef>;
};

/**
 * Resolve the three header labels (bank_account, project, contact_ruc) into
 * UUIDs using preloaded reference data. Pure — no DB calls. Mutates the passed
 * header in place and returns any unresolved-label errors.
 *
 * SUNAT auto-create for unknown contacts is a separate, DB-side step handled
 * by the caller in `app/actions/inbox.ts`.
 */
export function resolveHeaderLabelsToIds(
  header: PaymentSubmissionHeader,
  refs: ResolutionRefs,
): SubmissionFieldError[] {
  const errors: SubmissionFieldError[] = [];

  // Bank account: exact name match → last-4-of-account-number fallback.
  if (header.bank_account_label) {
    const label = header.bank_account_label.trim();
    const byName = refs.bankAccounts.find(
      (b) => b.name.toLowerCase() === label.toLowerCase(),
    );
    if (byName) {
      header.bank_account_id = byName.id;
    } else {
      const last4 = label.replace(/\D/g, "").slice(-4);
      const byLast4 =
        last4.length === 4
          ? refs.bankAccounts.find((b) =>
              (b.account_number ?? "").endsWith(last4),
            )
          : undefined;
      if (byLast4) {
        header.bank_account_id = byLast4.id;
      } else {
        header.bank_account_id = null;
        errors.push({
          path: "header.bank_account",
          message: `Cuenta bancaria "${header.bank_account_label}" no encontrada`,
        });
      }
    }
  } else {
    header.bank_account_id = null;
  }

  // Project: exact match by code. Optional field — missing label = no error.
  if (header.project_code) {
    const byCode = refs.projects.find(
      (p) =>
        p.code != null &&
        p.code.toLowerCase() === header.project_code!.toLowerCase(),
    );
    if (byCode) {
      header.project_id = byCode.id;
    } else {
      header.project_id = null;
      errors.push({
        path: "header.project_code",
        message: `Proyecto "${header.project_code}" no encontrado`,
      });
    }
  } else {
    header.project_id = null;
  }

  // Contact: lookup in preloaded map by RUC. Unknown RUC stays unresolved —
  // the caller decides whether to trigger a SUNAT auto-create.
  if (header.contact_ruc) {
    const found = refs.contactsByRuc.get(header.contact_ruc);
    if (found) {
      header.contact_id = found.id;
    } else {
      header.contact_id = null;
    }
  } else {
    header.contact_id = null;
  }

  // Partner: resolve the optional partner_ruc to a contact id. A blank value
  // is NOT an error here — the caller (app/actions/inbox.ts) falls back to
  // the is_self contact when the id is null at approval time. An unknown
  // non-blank RUC IS surfaced so the user sees a clear fix path.
  if (header.partner_ruc) {
    const found = refs.contactsByRuc.get(header.partner_ruc);
    if (found) {
      header.partner_id = found.id;
    } else {
      header.partner_id = null;
      errors.push({
        path: "header.partner_ruc",
        message: `Partner con RUC "${header.partner_ruc}" no encontrado`,
      });
    }
  } else {
    header.partner_id = null;
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Submission patches (Phase E — inline editing)
// ---------------------------------------------------------------------------

export const HEADER_EDITABLE_FIELDS = [
  "payment_date",
  "bank_account_label",
  "currency",
  "exchange_rate",
  "bank_reference",
  "is_detraction",
  "contact_ruc",
  "partner_ruc",
  "project_code",
  "title",
] as const;

export type HeaderEditableField = (typeof HEADER_EDITABLE_FIELDS)[number];

export const LINE_EDITABLE_FIELDS = [
  "amount",
  "line_type",
  "invoice_number_hint",
  "cost_category_label",
  "description",
] as const;

export type LineEditableField = (typeof LINE_EDITABLE_FIELDS)[number];

export type SubmissionPatch =
  | { kind: "set_header"; field: HeaderEditableField; value: unknown }
  | {
      kind: "set_line";
      index: number;
      field: LineEditableField;
      value: unknown;
    }
  | {
      /**
       * Dedicated patch for invoice combobox picks. Updates the hint
       * text and the resolved id together so they stay in sync. The
       * direction determines which FK column receives the id.
       */
      kind: "set_line_invoice";
      index: number;
      hint: string | null;
      invoiceId: string | null;
      direction: "inbound" | "outbound";
    }
  | { kind: "add_line" }
  | { kind: "delete_line"; index: number };

/**
 * Apply a patch to a submission's extracted_data payload, returning a new
 * payload. Pure — no DB, no FK resolution, no validation. The caller must:
 *   1. Run this to get the merged payload
 *   2. Re-resolve FKs if the patch changed a label field
 *   3. Re-run `validatePaymentSubmissionData` on the result
 *   4. Persist + return to client
 */
export function applyPatchToExtractedData(
  extracted: PaymentSubmissionExtractedData,
  patch: SubmissionPatch,
): ValidationResult<PaymentSubmissionExtractedData> {
  // Deep clone so the caller never mutates the input.
  const next: PaymentSubmissionExtractedData = {
    kind: "payment",
    header: { ...extracted.header },
    lines: extracted.lines.map((l) => ({ ...l })),
    validation: { valid: false, errors: [] },
    csv_row_numbers: extracted.csv_row_numbers,
  };

  switch (patch.kind) {
    case "set_header": {
      const typed = coerceHeaderValue(patch.field, patch.value);
      if (!typed.success) return typed;
      // Assign via a narrow cast — each field on the header is either
      // string|null, number|null, or boolean, so the coercion above
      // already guarantees a safe shape.
      (next.header as unknown as Record<string, unknown>)[patch.field] =
        typed.data;
      // When a label field changes, clear the cached id so the resolver
      // re-runs from scratch on the next step.
      if (patch.field === "bank_account_label") {
        next.header.bank_account_id = null;
      } else if (patch.field === "project_code") {
        next.header.project_id = null;
      } else if (patch.field === "contact_ruc") {
        next.header.contact_id = null;
        // Linked invoices belong to the old contact — wipe every line's
        // resolved id so stale links can't sneak through approval.
        next.lines = next.lines.map((l) => ({
          ...l,
          outgoing_invoice_id: null,
          incoming_invoice_id: null,
          invoice_number_hint: null,
        }));
      } else if (patch.field === "partner_ruc") {
        next.header.partner_id = null;
      }
      return success(next);
    }
    case "set_line": {
      if (patch.index < 0 || patch.index >= next.lines.length) {
        return failure("VALIDATION_ERROR", "Índice de línea fuera de rango", {
          index: `Must be 0..${next.lines.length - 1}`,
        });
      }
      const typed = coerceLineValue(patch.field, patch.value);
      if (!typed.success) return typed;
      const line = { ...next.lines[patch.index] };
      (line as unknown as Record<string, unknown>)[patch.field] = typed.data;
      // Changing the invoice number hint invalidates any previously-resolved
      // invoice id; the editor may re-pick one on the next render.
      if (patch.field === "invoice_number_hint") {
        line.outgoing_invoice_id = null;
        line.incoming_invoice_id = null;
      }
      if (patch.field === "cost_category_label") {
        line.cost_category_id = null;
      }
      next.lines[patch.index] = line;
      return success(next);
    }
    case "set_line_invoice": {
      if (patch.index < 0 || patch.index >= next.lines.length) {
        return failure("VALIDATION_ERROR", "Índice de línea fuera de rango", {
          index: `Must be 0..${next.lines.length - 1}`,
        });
      }
      const line = { ...next.lines[patch.index] };
      line.invoice_number_hint = patch.hint;
      // Exactly one of the two FK columns holds the id depending on
      // direction; the other must stay null (pl_invoice_exclusive CHECK
      // constraint on payment_lines).
      if (patch.direction === "inbound") {
        line.outgoing_invoice_id = patch.invoiceId;
        line.incoming_invoice_id = null;
      } else {
        line.incoming_invoice_id = patch.invoiceId;
        line.outgoing_invoice_id = null;
      }
      next.lines[patch.index] = line;
      return success(next);
    }
    case "add_line": {
      next.lines.push(blankLine());
      return success(next);
    }
    case "delete_line": {
      if (next.lines.length <= 1) {
        return failure(
          "VALIDATION_ERROR",
          "No se puede eliminar la última línea",
          { index: "At least one line is required" },
        );
      }
      if (patch.index < 0 || patch.index >= next.lines.length) {
        return failure("VALIDATION_ERROR", "Índice de línea fuera de rango", {
          index: `Must be 0..${next.lines.length - 1}`,
        });
      }
      next.lines.splice(patch.index, 1);
      return success(next);
    }
  }
}

function coerceHeaderValue(
  field: HeaderEditableField,
  value: unknown,
): ValidationResult<unknown> {
  switch (field) {
    case "payment_date":
    case "bank_account_label":
    case "bank_reference":
    case "contact_ruc":
    case "partner_ruc":
    case "project_code":
    case "title":
      return success(value == null ? null : String(value).trim() || null);
    case "currency": {
      const raw = value == null ? null : String(value).toUpperCase().trim();
      if (raw !== null && raw !== "PEN" && raw !== "USD") {
        return failure("VALIDATION_ERROR", "Moneda debe ser PEN o USD", {
          currency: "Invalid",
        });
      }
      return success(raw);
    }
    case "exchange_rate": {
      if (value === null || value === "" || value === undefined) {
        return success(null);
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        return failure(
          "VALIDATION_ERROR",
          "Tipo de cambio debe ser mayor a 0",
          { exchange_rate: "Invalid" },
        );
      }
      return success(n);
    }
    case "is_detraction":
      return success(Boolean(value));
  }
}

function coerceLineValue(
  field: LineEditableField,
  value: unknown,
): ValidationResult<unknown> {
  switch (field) {
    case "amount": {
      if (value === null || value === "" || value === undefined) {
        return success(null);
      }
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return failure("VALIDATION_ERROR", "Monto inválido", {
          amount: "Invalid",
        });
      }
      return success(n);
    }
    case "line_type": {
      const raw = value == null ? null : String(value).toLowerCase().trim();
      if (
        raw !== null &&
        raw !== "invoice" &&
        raw !== "bank_fee" &&
        raw !== "detraction" &&
        raw !== "loan" &&
        raw !== "general"
      ) {
        return failure("VALIDATION_ERROR", "Tipo de línea inválido", {
          line_type: "Invalid",
        });
      }
      return success(raw);
    }
    case "invoice_number_hint":
    case "cost_category_label":
    case "description":
      return success(value == null ? null : String(value).trim() || null);
  }
}

function blankLine(): PaymentSubmissionLine {
  return {
    amount: null,
    line_type: null,
    invoice_number_hint: null,
    outgoing_invoice_id: null,
    incoming_invoice_id: null,
    cost_category_label: null,
    cost_category_id: null,
    description: null,
  };
}

// ---------------------------------------------------------------------------
// Approval/rejection guards
// ---------------------------------------------------------------------------

/**
 * Gate on approving a submission: must be pending, source_type=payment,
 * not soft-deleted, extracted_data must be a payment payload, and its
 * stored validation must currently pass. Returns the payload on success
 * so the caller can immediately build a CreatePaymentInput from it.
 */
export function validateApproveSubmission(
  submission: SubmissionRow,
): ValidationResult<PaymentSubmissionExtractedData> {
  if (submission.deleted_at) {
    return failure("NOT_FOUND", "Submission no encontrada");
  }
  if (submission.source_type !== SUBMISSION_SOURCE_TYPE.payment) {
    return failure(
      "VALIDATION_ERROR",
      "Solo submissions de tipo pago pueden aprobarse por esta acción",
    );
  }
  if (submission.review_status !== SUBMISSION_STATUS.pending) {
    return failure("CONFLICT", "La submission ya fue aprobada o rechazada");
  }

  const data = submission.extracted_data as PaymentSubmissionExtractedData;
  if (!data || data.kind !== "payment") {
    return failure(
      "VALIDATION_ERROR",
      "La submission no contiene datos de pago válidos",
    );
  }
  if (!data.validation?.valid) {
    return failure(
      "VALIDATION_ERROR",
      "La submission tiene errores pendientes — corrígelos antes de aprobar",
    );
  }

  return success(data);
}

/**
 * Gate on rejecting a submission: must be pending and not soft-deleted.
 * source_type is not enforced — rejection is universal across staging types.
 */
export function validateRejectSubmission(
  submission: SubmissionRow,
): ValidationResult<void> {
  if (submission.deleted_at) {
    return failure("NOT_FOUND", "Submission no encontrada");
  }
  if (submission.review_status !== SUBMISSION_STATUS.pending) {
    return failure("CONFLICT", "La submission ya fue aprobada o rechazada");
  }
  return success(undefined);
}

// ---------------------------------------------------------------------------

function blankHeader(): PaymentSubmissionHeader {
  return {
    payment_date: null,
    direction: null,
    bank_account_label: null,
    bank_account_id: null,
    currency: null,
    exchange_rate: null,
    bank_reference: null,
    is_detraction: false,
    contact_ruc: null,
    contact_id: null,
    partner_ruc: null,
    partner_id: null,
    project_code: null,
    project_id: null,
    title: null,
  };
}
