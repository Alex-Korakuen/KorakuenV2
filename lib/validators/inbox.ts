import Papa from "papaparse";
import { success, failure } from "@/lib/types";
import type {
  ValidationResult,
  PaymentSubmissionHeader,
  PaymentSubmissionLine,
  PaymentSubmissionExtractedData,
  SubmissionFieldError,
  SubmissionValidationReport,
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
  "notes",
  "line_amount",
  "line_type",
  "project_code",
  "invoice_number",
  "cost_category",
  "line_notes",
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
  notes: string;
  line_amount: string;
  line_type: string;
  project_code: string;
  invoice_number: string;
  cost_category: string;
  line_notes: string;
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
      notes: (raw.notes ?? "").toString(),
      line_amount: (raw.line_amount ?? "").toString(),
      line_type: (raw.line_type ?? "").toString(),
      project_code: (raw.project_code ?? "").toString(),
      invoice_number: (raw.invoice_number ?? "").toString(),
      cost_category: (raw.cost_category ?? "").toString(),
      line_notes: (raw.line_notes ?? "").toString(),
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
    project_code: first.project_code || null,
    project_id: null,
    notes: first.notes || null,
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
    "notes",
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
    notes: r.line_notes || null,
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
 * - Required header fields (date, direction, bank account, currency, contact)
 * - direction must be inbound|outbound
 * - currency must be PEN|USD
 * - exchange_rate > 0 required when currency=USD
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
  if (!h.contact_ruc) {
    errors.push({
      path: "header.contact_ruc",
      message: "RUC del contacto es requerido",
    });
  } else if (!/^\d{8}$|^\d{11}$/.test(h.contact_ruc)) {
    errors.push({
      path: "header.contact_ruc",
      message: "El RUC debe tener 8 u 11 dígitos",
    });
  }

  if (h.currency === "USD") {
    if (h.exchange_rate == null || h.exchange_rate <= 0) {
      errors.push({
        path: "header.exchange_rate",
        message: "Tipo de cambio requerido para pagos en USD",
      });
    }
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
    project_code: null,
    project_id: null,
    notes: null,
  };
}
