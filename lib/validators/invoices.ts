import {
  OUTGOING_INVOICE_STATUS,
  OUTGOING_QUOTE_STATUS,
  INCOMING_QUOTE_STATUS,
  INCOMING_INVOICE_FACTURA_STATUS,
  withinTolerance,
  success,
  failure,
} from "@/lib/types";
import type {
  SupabaseClient,
} from "@supabase/supabase-js";
import type {
  ValidationResult,
  LineItemInput,
  DocumentTotals,
  CreateOutgoingInvoiceInput,
  UpdateOutgoingInvoiceInput,
  CreateIncomingInvoiceInput,
  UpdateIncomingInvoiceInput,
  SunatFieldsInput,
  OutgoingInvoiceRow,
  IncomingInvoiceRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Line item validation (shared across all document types)
// ---------------------------------------------------------------------------

/**
 * Validate line item math:
 * - subtotal = quantity * unit_price (within tolerance)
 * - total = subtotal + igv_amount (within tolerance)
 * - igv_amount = 0 when igv_applies is false
 */
export function validateLineItemMath(
  item: LineItemInput,
): ValidationResult<LineItemInput> {
  const fields: Record<string, string> = {};

  const expectedSubtotal = item.quantity * item.unit_price;
  if (!withinTolerance(item.subtotal, expectedSubtotal)) {
    fields.subtotal =
      `Must equal quantity × unit_price. Expected ${expectedSubtotal.toFixed(2)}, received ${item.subtotal.toFixed(2)}`;
  }

  const expectedTotal = item.subtotal + item.igv_amount;
  if (!withinTolerance(item.total, expectedTotal)) {
    fields.total =
      `Must equal subtotal + igv_amount. Expected ${expectedTotal.toFixed(2)}, received ${item.total.toFixed(2)}`;
  }

  if (item.igv_applies === false && item.igv_amount !== 0) {
    fields.igv_amount = "Must be 0 when igv_applies is false";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Line item math validation failed", fields);
  }

  return success(item);
}

// ---------------------------------------------------------------------------
// Document totals validation
// ---------------------------------------------------------------------------

/**
 * Validate that header totals match the sum of line items.
 */
export function validateDocumentTotals(
  header: DocumentTotals,
  lineItems: LineItemInput[],
): ValidationResult<DocumentTotals> {
  const fields: Record<string, string> = {};

  const sumSubtotal = lineItems.reduce((acc, li) => acc + li.subtotal, 0);
  const sumIgv = lineItems.reduce((acc, li) => acc + li.igv_amount, 0);
  const sumTotal = lineItems.reduce((acc, li) => acc + li.total, 0);

  if (!withinTolerance(header.subtotal, sumSubtotal)) {
    fields.subtotal =
      `Header subtotal (${header.subtotal.toFixed(2)}) does not match line items sum (${sumSubtotal.toFixed(2)})`;
  }

  if (!withinTolerance(header.igv_amount, sumIgv)) {
    fields.igv_amount =
      `Header igv_amount (${header.igv_amount.toFixed(2)}) does not match line items sum (${sumIgv.toFixed(2)})`;
  }

  if (!withinTolerance(header.total, sumTotal)) {
    fields.total =
      `Header total (${header.total.toFixed(2)}) does not match line items sum (${sumTotal.toFixed(2)})`;
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Document totals do not match line items", fields);
  }

  return success(header);
}

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

import {
  validateCurrencyExchangeRate,
  validateDetractionConsistency,
} from "./shared";

function validateTotalConsistency(
  subtotal: number,
  igv_amount: number,
  total: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const expectedTotal = subtotal + igv_amount;
  if (!withinTolerance(total, expectedTotal)) {
    fields.total =
      `Must equal subtotal + igv_amount. Expected ${expectedTotal.toFixed(2)}, received ${total.toFixed(2)}`;
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Outgoing invoice validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating an outgoing invoice.
 */
export function validateOutgoingInvoice(
  data: CreateOutgoingInvoiceInput,
): ValidationResult<CreateOutgoingInvoiceInput> {
  const fields: Record<string, string> = {};

  if (!data.project_id) {
    fields.project_id = "Required";
  }

  if (!data.issue_date) {
    fields.issue_date = "Required";
  }

  if (!data.period_start) {
    fields.period_start = "Required";
  }

  if (!data.period_end) {
    fields.period_end = "Required";
  }

  if (data.period_start && data.period_end && data.period_start > data.period_end) {
    fields.period_end = "Must be on or after period_start";
  }

  Object.assign(
    fields,
    validateCurrencyExchangeRate(data.currency, data.exchange_rate),
  );

  Object.assign(
    fields,
    validateDetractionConsistency(data.detraction_rate, data.detraction_amount),
  );

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Outgoing invoice validation failed", fields);
  }

  return success(data);
}

/**
 * Validate an outgoing invoice header update, enforcing field-level locks
 * based on the current status.
 *
 * Draft:
 *   - All fields mutable.
 *
 * Sent:
 *   - Financial core is LOCKED: period_start/end, issue_date, currency,
 *     exchange_rate, detraction_rate, detraction_amount. The line-item
 *     driven fields (subtotal, igv_amount, total, total_pen) are never
 *     edited directly anyway — they come from the line items.
 *   - SUNAT fields are MUTABLE: fill them in progressively as the billing
 *     provider response arrives.
 *   - Detracción proof fields are MUTABLE: record the constancia after
 *     the client deposits to Banco de la Nación.
 *   - Notes are MUTABLE.
 *
 * Void:
 *   - Nothing mutable. Voided invoices are frozen.
 */
const OI_FINANCIAL_FIELDS: (keyof UpdateOutgoingInvoiceInput)[] = [
  "period_start",
  "period_end",
  "issue_date",
  "currency",
  "exchange_rate",
  "detraction_rate",
  "detraction_amount",
];

export function validateOutgoingInvoiceHeaderUpdate(
  invoice: Pick<OutgoingInvoiceRow, "status" | "deleted_at">,
  patch: UpdateOutgoingInvoiceInput,
): ValidationResult<UpdateOutgoingInvoiceInput> {
  if (invoice.deleted_at) {
    return failure("NOT_FOUND", "Outgoing invoice has been deleted");
  }

  if (invoice.status === OUTGOING_INVOICE_STATUS.void) {
    return failure(
      "CONFLICT",
      "No se puede modificar una factura anulada",
      { status: "Voided outgoing invoices are frozen" },
    );
  }

  if (invoice.status === OUTGOING_INVOICE_STATUS.sent) {
    const lockedFieldErrors: Record<string, string> = {};
    for (const field of OI_FINANCIAL_FIELDS) {
      if (field in patch) {
        lockedFieldErrors[field as string] =
          `Cannot modify ${String(field)} on a sent invoice. Use unsend to return to draft, or void and create a new invoice.`;
      }
    }
    if (Object.keys(lockedFieldErrors).length > 0) {
      return failure(
        "IMMUTABLE_FIELD",
        "Los campos financieros no se pueden modificar en una factura enviada",
        lockedFieldErrors,
      );
    }
  }

  // Currency/exchange_rate consistency (when both are being changed at once
  // on a draft, or just on a draft)
  if ("currency" in patch || "exchange_rate" in patch) {
    const cur = patch.currency;
    const rate = patch.exchange_rate;
    if (cur === "USD" && rate != null && rate <= 0) {
      return failure("VALIDATION_ERROR", "exchange_rate must be positive", {
        exchange_rate: "Must be > 0",
      });
    }
    if (cur && cur !== "PEN" && cur !== "USD") {
      return failure("VALIDATION_ERROR", "Currency must be PEN or USD", {
        currency: "Must be PEN or USD",
      });
    }
  }

  // Detracción rate/amount consistency (both or neither when both keys appear)
  if ("detraction_rate" in patch && "detraction_amount" in patch) {
    const hasRate = patch.detraction_rate != null;
    const hasAmount = patch.detraction_amount != null;
    if (hasRate !== hasAmount) {
      return failure(
        "VALIDATION_ERROR",
        "Both detraction_rate and detraction_amount must be provided, or neither",
        {
          detraction_rate: "Both or neither",
          detraction_amount: "Both or neither",
        },
      );
    }
  }

  return success(patch);
}

/**
 * Assert that an outgoing invoice can be "unsent" back to draft.
 * The undo is allowed only while no SUNAT data has been committed to the
 * row. `estado_sunat IS NULL` is the strictest reading; we also permit
 * `estado_sunat = 'rejected'` because a rejected XML is not a valid legal
 * document — nothing worth protecting — and the admin likely wants to
 * unsend, fix, and re-emit.
 */
export function assertOutgoingInvoiceUndoable(
  invoice: Pick<OutgoingInvoiceRow, "status" | "estado_sunat">,
): ValidationResult<void> {
  if (invoice.status !== OUTGOING_INVOICE_STATUS.sent) {
    return failure(
      "CONFLICT",
      "Solo se puede deshacer el envío de una factura que está en estado enviado",
      { status: `Current status is ${invoice.status}, expected sent (${OUTGOING_INVOICE_STATUS.sent})` },
    );
  }

  const estado = invoice.estado_sunat?.toLowerCase() ?? null;
  if (estado != null && estado !== "rejected" && estado !== "rechazado") {
    return failure(
      "CONFLICT",
      "No se puede deshacer el envío: la factura ya está registrada en SUNAT. Anúlela en su lugar.",
      {
        estado_sunat: `SUNAT document is committed (${invoice.estado_sunat}). Void and create a new invoice.`,
      },
    );
  }

  return success(undefined);
}

/**
 * Assert that an outgoing invoice can be voided. Blocked if any payment_lines
 * reference the invoice — the admin must unwind allocations first to avoid
 * orphan payment rows pointing at a voided invoice.
 */
export async function assertOutgoingInvoiceVoidable(
  supabase: SupabaseClient,
  invoiceId: string,
): Promise<ValidationResult<void>> {
  const { data: lines, error } = await supabase
    .from("payment_lines")
    .select("id")
    .eq("outgoing_invoice_id", invoiceId)
    .limit(1);

  if (error) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to check payment allocations: ${error.message}`,
    );
  }

  if (lines && lines.length > 0) {
    return failure(
      "CONFLICT",
      "No se puede anular una factura con pagos registrados. Elimine primero las asignaciones de pago.",
      {
        payment_lines:
          "Invoice has existing payment allocations. Remove them before voiding.",
      },
    );
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Incoming invoice validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating an incoming invoice.
 *
 * When `factura_status = received` at creation time (the "manual received"
 * creation path), all five SUNAT identifier fields must be present. This
 * mirrors the DB CHECK constraint `ii_received_requires_sunat` so callers
 * see a structured validator error instead of a Postgres 23514 failure.
 */
export function validateIncomingInvoice(
  data: CreateIncomingInvoiceInput,
): ValidationResult<CreateIncomingInvoiceInput> {
  const fields: Record<string, string> = {};

  if (!data.contact_id) {
    fields.contact_id = "Required";
  }

  Object.assign(
    fields,
    validateTotalConsistency(data.subtotal, data.igv_amount, data.total),
  );

  Object.assign(
    fields,
    validateCurrencyExchangeRate(data.currency, data.exchange_rate),
  );

  Object.assign(
    fields,
    validateDetractionConsistency(data.detraction_rate, data.detraction_amount),
  );

  // ruc_emisor format check (matches DB constraint ii_ruc_format)
  if (data.ruc_emisor && !/^\d{11}$/.test(data.ruc_emisor)) {
    fields.ruc_emisor = "Must be exactly 11 digits";
  }

  // SUNAT field presence check for the manual-received creation path.
  // The transition validator handles expected → received after the fact;
  // this handles the case where factura_status is received from birth.
  if (data.factura_status === INCOMING_INVOICE_FACTURA_STATUS.received) {
    if (!data.serie_numero) {
      fields.serie_numero = "Required when factura_status is received";
    }
    if (!data.fecha_emision) {
      fields.fecha_emision = "Required when factura_status is received";
    }
    if (!data.tipo_documento_code) {
      fields.tipo_documento_code = "Required when factura_status is received";
    }
    if (!data.ruc_emisor) {
      fields.ruc_emisor = "Required when factura_status is received";
    }
    if (!data.ruc_receptor) {
      fields.ruc_receptor = "Required when factura_status is received";
    }
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Incoming invoice validation failed", fields);
  }

  return success(data);
}

/**
 * Validate an incoming invoice header update, enforcing field-level locks
 * based on the current factura_status.
 *
 * Expected:
 *   - All fields mutable. The caller can edit the estimate freely until
 *     the paper factura arrives.
 *
 * Received:
 *   - Financial core is LOCKED: currency, exchange_rate, subtotal,
 *     igv_amount, total, total_pen, detraction_rate, detraction_amount,
 *     contact_id, project_id — these come from the SUNAT document and
 *     must not be edited retroactively.
 *   - SUNAT identifier fields are LOCKED: serie_numero, fecha_emision,
 *     tipo_documento_code, ruc_emisor, ruc_receptor, factura_number.
 *   - SUNAT metadata is MUTABLE: hash_cdr, estado_sunat, pdf_url, xml_url,
 *     drive_file_id — these can be progressively filled as the billing
 *     workflow finishes.
 *   - Detracción proof fields are MUTABLE: the constancia comes later.
 *   - Notes, incoming_quote_id, cost_category_id are MUTABLE: the
 *     quote link can be backfilled and the category can be corrected.
 */
const II_LOCKED_ON_RECEIVED_FIELDS: (keyof UpdateIncomingInvoiceInput)[] = [
  "project_id",
  "contact_id",
  "currency",
  "exchange_rate",
  "subtotal",
  "igv_amount",
  "total",
  "total_pen",
  "detraction_rate",
  "detraction_amount",
  "factura_number",
  "serie_numero",
  "fecha_emision",
  "tipo_documento_code",
  "ruc_emisor",
  "ruc_receptor",
];

export function validateIncomingInvoiceHeaderUpdate(
  invoice: Pick<IncomingInvoiceRow, "factura_status" | "deleted_at">,
  patch: UpdateIncomingInvoiceInput,
): ValidationResult<UpdateIncomingInvoiceInput> {
  if (invoice.deleted_at) {
    return failure("NOT_FOUND", "Incoming invoice has been deleted");
  }

  if (invoice.factura_status === INCOMING_INVOICE_FACTURA_STATUS.received) {
    const lockedFieldErrors: Record<string, string> = {};
    for (const field of II_LOCKED_ON_RECEIVED_FIELDS) {
      if (field in patch) {
        lockedFieldErrors[field as string] =
          `Cannot modify ${String(field)} on a received incoming invoice. The SUNAT document is the source of truth.`;
      }
    }
    if (Object.keys(lockedFieldErrors).length > 0) {
      return failure(
        "IMMUTABLE_FIELD",
        "Los campos del documento SUNAT no se pueden modificar en una factura recibida",
        lockedFieldErrors,
      );
    }
  }

  // Shape checks that apply in both states
  if ("currency" in patch || "exchange_rate" in patch) {
    const fields: Record<string, string> = {};
    Object.assign(
      fields,
      validateCurrencyExchangeRate(patch.currency, patch.exchange_rate),
    );
    if (Object.keys(fields).length > 0) {
      return failure("VALIDATION_ERROR", "Currency/exchange rate invalid", fields);
    }
  }

  if ("detraction_rate" in patch && "detraction_amount" in patch) {
    const fields: Record<string, string> = {};
    Object.assign(
      fields,
      validateDetractionConsistency(patch.detraction_rate, patch.detraction_amount),
    );
    if (Object.keys(fields).length > 0) {
      return failure("VALIDATION_ERROR", "Detracción fields inconsistent", fields);
    }
  }

  if (patch.ruc_emisor != null && !/^\d{11}$/.test(patch.ruc_emisor)) {
    return failure("VALIDATION_ERROR", "ruc_emisor must be 11 digits", {
      ruc_emisor: "Must be exactly 11 digits",
    });
  }

  if (patch.ruc_receptor != null && !/^\d{11}$/.test(patch.ruc_receptor)) {
    return failure("VALIDATION_ERROR", "ruc_receptor must be 11 digits", {
      ruc_receptor: "Must be exactly 11 digits",
    });
  }

  return success(patch);
}

/**
 * Assert that an incoming invoice can be soft-deleted. Delete is the
 * "this was a mistake" escape hatch — only allowed while the row is
 * still expected. Once received, the paper trail is permanent.
 * The caller must also verify no payment_lines reference the invoice
 * (that check lives in the server action because it needs a DB query).
 */
export function assertIncomingInvoiceDeletable(
  invoice: Pick<IncomingInvoiceRow, "factura_status" | "deleted_at">,
): ValidationResult<void> {
  if (invoice.deleted_at) {
    return failure("NOT_FOUND", "Incoming invoice is already deleted");
  }
  if (invoice.factura_status !== INCOMING_INVOICE_FACTURA_STATUS.expected) {
    return failure(
      "CONFLICT",
      "Solo se pueden eliminar facturas en estado esperada. Las facturas recibidas quedan en el registro permanente.",
      {
        factura_status: `Incoming invoice must be expected (${INCOMING_INVOICE_FACTURA_STATUS.expected}) to delete. Current: ${invoice.factura_status}`,
      },
    );
  }
  return success(undefined);
}

// ---------------------------------------------------------------------------
// SUNAT fields validation
// ---------------------------------------------------------------------------

/**
 * Validate SUNAT electronic document metadata fields.
 */
export function validateSunatFields(
  data: SunatFieldsInput,
): ValidationResult<SunatFieldsInput> {
  const fields: Record<string, string> = {};

  // serie_numero format: letter + 3 digits + dash + 1-8 digits (e.g. F001-00000142)
  if (data.serie_numero && !/^[A-Z]\d{3}-\d{1,8}$/.test(data.serie_numero)) {
    fields.serie_numero =
      "Invalid format. Expected pattern like F001-00000142";
  }

  // ruc_emisor: 11 digits
  if (data.ruc_emisor && !/^\d{11}$/.test(data.ruc_emisor)) {
    fields.ruc_emisor = "Must be exactly 11 digits";
  }

  // tipo_documento_code: known values
  const validTipoCodes = ["01", "03", "07", "08"];
  if (
    data.tipo_documento_code &&
    !validTipoCodes.includes(data.tipo_documento_code)
  ) {
    fields.tipo_documento_code =
      `Must be one of: ${validTipoCodes.join(", ")} (01=factura, 03=boleta, 07=nota de credito, 08=nota de debito)`;
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "SUNAT field validation failed", fields);
  }

  return success(data);
}

// ---------------------------------------------------------------------------
// Line item immutability check
// ---------------------------------------------------------------------------

type DocumentType =
  | "outgoing_invoice"
  | "outgoing_quote"
  | "incoming_quote"
  | "incoming_invoice";

const MUTABLE_STATUSES: Record<DocumentType, number[]> = {
  outgoing_invoice: [OUTGOING_INVOICE_STATUS.draft],
  outgoing_quote: [OUTGOING_QUOTE_STATUS.draft],
  incoming_quote: [INCOMING_QUOTE_STATUS.draft],
  incoming_invoice: [INCOMING_INVOICE_FACTURA_STATUS.expected],
};

/**
 * Check that a document is in a status that allows line item mutations.
 * Returns CONFLICT error if the document is locked.
 */
export function assertLineItemsMutable(
  documentStatus: number,
  documentType: DocumentType,
): ValidationResult<void> {
  const allowed = MUTABLE_STATUSES[documentType];
  if (allowed && allowed.includes(documentStatus)) {
    return success(undefined);
  }

  return failure(
    "CONFLICT",
    `Cannot modify line items on ${documentType} in current status`,
    {
      status: `Line items are locked at status ${documentStatus}. Document must be in status: ${allowed?.join(", ")}`,
    },
  );
}
