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
  ValidationResult,
  LineItemInput,
  DocumentTotals,
  CreateOutgoingInvoiceInput,
  CreateIncomingInvoiceInput,
  SunatFieldsInput,
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

// ---------------------------------------------------------------------------
// Incoming invoice validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating an incoming invoice.
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

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Incoming invoice validation failed", fields);
  }

  return success(data);
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
