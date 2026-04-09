import {
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
  ACCOUNT_TYPE,
  withinTolerance,
  success,
  failure,
} from "@/lib/types";
import type {
  ValidationResult,
  CreatePaymentInput,
  CreatePaymentLineInput,
  BankAccountRow,
} from "@/lib/types";
import { validateCurrencyExchangeRate } from "./shared";

// ---------------------------------------------------------------------------
// Payment header validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating a payment.
 */
export function validateCreatePayment(
  data: CreatePaymentInput,
): ValidationResult<CreatePaymentInput> {
  const fields: Record<string, string> = {};

  // Direction must be valid
  if (
    data.direction !== PAYMENT_DIRECTION.inbound &&
    data.direction !== PAYMENT_DIRECTION.outbound
  ) {
    fields.direction = "Must be 1 (inbound) or 2 (outbound)";
  }

  // Bank account is required
  if (!data.bank_account_id) {
    fields.bank_account_id = "Required";
  }

  // Currency validation
  Object.assign(fields, validateCurrencyExchangeRate(data.currency, data.exchange_rate));
  const currency = data.currency ?? "PEN";

  // paid_by_partner_id only allowed on outbound (DB constraint: pay_direction_partner)
  if (data.paid_by_partner_id && data.direction !== PAYMENT_DIRECTION.outbound) {
    fields.paid_by_partner_id = "Only allowed on outbound payments";
  }

  // is_detraction requires PEN (DB constraint: pay_bn_detraction)
  if (data.is_detraction && currency !== "PEN") {
    fields.is_detraction = "Detraction payments must be in PEN";
  }

  // Payment date is required
  if (!data.payment_date) {
    fields.payment_date = "Required";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Payment validation failed", fields);
  }

  return success(data);
}

// ---------------------------------------------------------------------------
// Payment line validation
// ---------------------------------------------------------------------------

/**
 * Validate a single payment line.
 */
export function validatePaymentLine(
  line: CreatePaymentLineInput,
): ValidationResult<CreatePaymentLineInput> {
  const fields: Record<string, string> = {};

  // Amount must be positive (DB constraint: pl_positive)
  if (line.amount <= 0) {
    fields.amount = "Must be greater than 0";
  }

  // At most one document link (DB constraint: pl_invoice_exclusive)
  const docLinks = [
    line.outgoing_invoice_id,
    line.incoming_invoice_id,
    line.loan_id,
  ].filter((v) => v != null);

  if (docLinks.length > 1) {
    fields.outgoing_invoice_id =
      "At most one of outgoing_invoice_id, incoming_invoice_id, loan_id can be set";
  }

  // Bank fee lines cannot link to documents (DB constraint: pl_bank_fee_no_invoice)
  if (line.line_type === PAYMENT_LINE_TYPE.bank_fee && docLinks.length > 0) {
    fields.line_type =
      "Bank fee lines (line_type=2) cannot link to invoices or loans";
  }

  // Loan lines must have loan_id (DB constraint: pl_loan_type)
  if (line.line_type === PAYMENT_LINE_TYPE.loan && !line.loan_id) {
    fields.loan_id = "Required when line_type is loan (4)";
  }

  // line_type must be valid
  const validLineTypes = Object.values(PAYMENT_LINE_TYPE);
  if (!validLineTypes.includes(line.line_type as typeof validLineTypes[number])) {
    fields.line_type = `Must be one of: ${validLineTypes.join(", ")}`;
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Payment line validation failed", fields);
  }

  return success(line);
}

// ---------------------------------------------------------------------------
// Bank account consistency
// ---------------------------------------------------------------------------

/**
 * Validate that a payment is consistent with its target bank account.
 * Banco de la Nacion accounts enforce PEN currency and is_detraction = true.
 */
export function validateBankAccountConsistency(
  payment: CreatePaymentInput,
  bankAccount: BankAccountRow,
): ValidationResult<void> {
  const fields: Record<string, string> = {};

  if (bankAccount.account_type === ACCOUNT_TYPE.banco_de_la_nacion) {
    const currency = payment.currency ?? "PEN";
    if (currency !== "PEN") {
      fields.currency =
        "Banco de la Nacion accounts only accept PEN payments";
    }
    if (!payment.is_detraction) {
      fields.is_detraction =
        "Payments to/from Banco de la Nacion must be marked as detraction";
    }
  }

  if (Object.keys(fields).length > 0) {
    return failure(
      "VALIDATION_ERROR",
      "Payment is inconsistent with bank account rules",
      fields,
    );
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Payment totals
// ---------------------------------------------------------------------------

/**
 * Validate that payment header totals match the sum of payment lines.
 */
export function validatePaymentTotals(
  totalAmount: number,
  totalAmountPen: number,
  lines: CreatePaymentLineInput[],
): ValidationResult<void> {
  const fields: Record<string, string> = {};

  const sumAmount = lines.reduce((acc, l) => acc + l.amount, 0);
  const sumAmountPen = lines.reduce((acc, l) => acc + l.amount_pen, 0);

  if (!withinTolerance(totalAmount, sumAmount)) {
    fields.total_amount =
      `Header total_amount (${totalAmount.toFixed(2)}) does not match lines sum (${sumAmount.toFixed(2)})`;
  }

  if (!withinTolerance(totalAmountPen, sumAmountPen)) {
    fields.total_amount_pen =
      `Header total_amount_pen (${totalAmountPen.toFixed(2)}) does not match lines sum (${sumAmountPen.toFixed(2)})`;
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Payment totals do not match lines", fields);
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Over-allocation check
// ---------------------------------------------------------------------------

/**
 * Check that allocating a new amount to an invoice does not exceed the invoice total.
 */
export function validateNoOverAllocation(
  invoiceTotal: number,
  currentAllocated: number,
  newAmount: number,
): ValidationResult<void> {
  const afterAllocation = currentAllocated + newAmount;

  if (afterAllocation > invoiceTotal + 0.01) {
    return failure(
      "VALIDATION_ERROR",
      "Allocation would exceed invoice total",
      {
        amount: `Invoice total: ${invoiceTotal.toFixed(2)}, already allocated: ${currentAllocated.toFixed(2)}, new: ${newAmount.toFixed(2)}, total after: ${afterAllocation.toFixed(2)}`,
      },
    );
  }

  return success(undefined);
}
