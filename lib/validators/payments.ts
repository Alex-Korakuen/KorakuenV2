import {
  PAYMENT_DIRECTION,
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
  PaymentRow,
} from "@/lib/types";
import { validateCurrencyExchangeRate, validateImmutableFields } from "./shared";

// ---------------------------------------------------------------------------
// Payment header + lines validation
// ---------------------------------------------------------------------------

/**
 * Validate a payment header together with its lines. createPayment requires
 * a non-empty lines array; line errors are scoped to `lines[i].field`.
 */
export function validateCreatePayment(
  data: CreatePaymentInput,
  lines: CreatePaymentLineInput[],
): ValidationResult<{ data: CreatePaymentInput; lines: CreatePaymentLineInput[] }> {
  const fields: Record<string, string> = {};

  if (
    data.direction !== PAYMENT_DIRECTION.inbound &&
    data.direction !== PAYMENT_DIRECTION.outbound
  ) {
    fields.direction = "Must be 1 (inbound) or 2 (outbound)";
  }

  // bank_account_id is now optional: a payment with no bank_account_id means
  // a non-Korakuen consortium partner paid the vendor (or collected from the
  // client) out of pocket — no Korakuen bank account was involved. The "must
  // be a non-self partner" half of the rule requires a DB lookup on
  // contacts.is_self, so it lives in the createPayment server action; the
  // pure validator just allows null through.

  Object.assign(fields, validateCurrencyExchangeRate(data.currency, data.exchange_rate));

  // Every payment must be attributed to one of the consortium partners —
  // the one whose cash went out (outbound) or was collected (inbound). This
  // drives the settlement formula in getSettlement. The old outbound-only
  // restriction was dropped in migration 20260413000003_partner_attribution.
  if (!data.paid_by_partner_id) {
    fields.paid_by_partner_id = "Required — every payment must be attributed to a partner";
  }

  if (!data.payment_date) {
    fields.payment_date = "Required";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Payment header validation failed", fields);
  }

  if (lines.length === 0) {
    return failure("VALIDATION_ERROR", "At least one payment line is required", {
      lines: "Empty line list",
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const check = validatePaymentLine(lines[i]);
    if (!check.success) {
      const scoped: Record<string, string> = {};
      for (const [k, v] of Object.entries(check.error.fields ?? {})) {
        scoped[`lines[${i}].${k}`] = v;
      }
      return failure(check.error.code, check.error.message, scoped);
    }
  }

  return success({ data, lines });
}

// ---------------------------------------------------------------------------
// Payment line validation
// ---------------------------------------------------------------------------

export function validatePaymentLine(
  line: CreatePaymentLineInput,
): ValidationResult<CreatePaymentLineInput> {
  const fields: Record<string, string> = {};

  if (line.amount <= 0) {
    fields.amount = "Must be greater than 0";
  }
  if (line.amount_pen <= 0) {
    fields.amount_pen = "Must be greater than 0";
  }

  const docLinks = [
    line.outgoing_invoice_id,
    line.incoming_invoice_id,
    line.loan_id,
  ].filter((v) => v != null);

  if (docLinks.length > 1) {
    fields.outgoing_invoice_id =
      "At most one of outgoing_invoice_id, incoming_invoice_id, loan_id can be set";
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
 * Banco de la Nación accounts only accept PEN payments. The is_detraction
 * half of the old check is now structural — the server derives the flag
 * from bank_account.account_type at createPayment time, so it cannot
 * disagree with the account.
 */
export function validateBankAccountConsistency(
  payment: CreatePaymentInput,
  bankAccount: BankAccountRow,
): ValidationResult<void> {
  if (bankAccount.account_type !== ACCOUNT_TYPE.banco_de_la_nacion) {
    return success(undefined);
  }

  const currency = payment.currency ?? "PEN";
  if (currency !== "PEN") {
    return failure(
      "VALIDATION_ERROR",
      "Payment is inconsistent with bank account rules",
      { currency: "Banco de la Nacion accounts only accept PEN payments" },
    );
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Currency rule (payment line linked to an invoice)
// ---------------------------------------------------------------------------

/**
 * A payment line's parent payment currency must match the invoice currency,
 * with exactly one exception: a PEN payment from a Banco de la Nación
 * account (is_detraction = true) may link to a USD invoice. Detracciones
 * are always deposited in PEN even when the underlying invoice is in USD.
 */
export function validatePaymentInvoiceCurrency(
  paymentCurrency: string,
  invoiceCurrency: string,
  isDetraction: boolean,
  bankAccountType: number,
): ValidationResult<void> {
  if (paymentCurrency === invoiceCurrency) {
    return success(undefined);
  }

  const isBnDetractionException =
    paymentCurrency === "PEN" &&
    invoiceCurrency === "USD" &&
    isDetraction === true &&
    bankAccountType === ACCOUNT_TYPE.banco_de_la_nacion;

  if (isBnDetractionException) {
    return success(undefined);
  }

  return failure(
    "VALIDATION_ERROR",
    "Payment currency does not match invoice currency",
    {
      currency: `Payment is ${paymentCurrency} but invoice is ${invoiceCurrency}. The only allowed cross-currency link is a PEN detracción from a Banco de la Nación account against a USD invoice.`,
    },
  );
}

// ---------------------------------------------------------------------------
// Split sum rule
// ---------------------------------------------------------------------------

/**
 * When splitting a payment line into N siblings, the split amounts must sum
 * exactly to the original on both `amount` and `amount_pen` (within tolerance).
 */
export function validateSplitSumToOriginal(
  originalAmount: number,
  originalAmountPen: number,
  splits: Array<{ amount: number; amount_pen: number }>,
): ValidationResult<void> {
  if (splits.length < 1) {
    return failure("VALIDATION_ERROR", "Split must produce at least one line", {
      splits: "Empty split list",
    });
  }

  const sumAmount = splits.reduce((acc, s) => acc + s.amount, 0);
  const sumAmountPen = splits.reduce((acc, s) => acc + s.amount_pen, 0);

  const fields: Record<string, string> = {};
  if (!withinTolerance(originalAmount, sumAmount)) {
    fields.amount = `Split sum (${sumAmount.toFixed(2)}) does not match original line amount (${originalAmount.toFixed(2)})`;
  }
  if (!withinTolerance(originalAmountPen, sumAmountPen)) {
    fields.amount_pen = `Split sum in PEN (${sumAmountPen.toFixed(2)}) does not match original line amount_pen (${originalAmountPen.toFixed(2)})`;
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Split sum does not match original", fields);
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Reconciliation gate
// ---------------------------------------------------------------------------

/**
 * Blocks any mutation against a reconciled payment. Used by every write
 * action on payments and payment_lines.
 */
export function validatePaymentMutable(
  payment: Pick<PaymentRow, "reconciled">,
): ValidationResult<void> {
  if (payment.reconciled) {
    return failure(
      "CONFLICT",
      "Payment is reconciled and cannot be modified",
      { reconciled: "Unreconcile the payment before editing" },
    );
  }
  return success(undefined);
}

const BANK_REFERENCE_MAX_LENGTH = 100;

export function validateReconcilePayment(
  bankReference: string,
  existing: Pick<PaymentRow, "reconciled" | "deleted_at">,
): ValidationResult<{ bankReference: string }> {
  if (existing.deleted_at) {
    return failure("NOT_FOUND", "Payment not found");
  }
  if (existing.reconciled) {
    return failure(
      "CONFLICT",
      "Payment is already reconciled",
      { reconciled: "Use unreconcilePayment to revert first" },
    );
  }

  if (typeof bankReference !== "string") {
    return failure(
      "VALIDATION_ERROR",
      "Bank reference is required",
      { bank_reference: "Bank reference is required" },
    );
  }
  const trimmed = bankReference.trim();
  if (trimmed.length === 0) {
    return failure(
      "VALIDATION_ERROR",
      "Bank reference is required",
      { bank_reference: "Bank reference is required" },
    );
  }
  if (trimmed.length > BANK_REFERENCE_MAX_LENGTH) {
    return failure(
      "VALIDATION_ERROR",
      "Bank reference is too long",
      {
        bank_reference: `Must be ${BANK_REFERENCE_MAX_LENGTH} characters or fewer`,
      },
    );
  }

  return success({ bankReference: trimmed });
}

export function validateUnreconcilePayment(
  existing: Pick<PaymentRow, "reconciled" | "deleted_at">,
): ValidationResult<void> {
  if (existing.deleted_at) {
    return failure("NOT_FOUND", "Payment not found");
  }
  if (!existing.reconciled) {
    return failure(
      "CONFLICT",
      "Payment is not reconciled",
      { reconciled: "Only reconciled payments can be unreconciled" },
    );
  }
  return success(undefined);
}

// ---------------------------------------------------------------------------
// Payment header update guard (immutable fields)
// ---------------------------------------------------------------------------

const IMMUTABLE_PAYMENT_FIELDS: (keyof PaymentRow)[] = [
  "direction",
  "bank_account_id",
  "currency",
  "exchange_rate",
  "is_detraction",
];

/**
 * Rejects changes to fields that are immutable after creation. `is_detraction`
 * is already structurally immutable (it derives from `bank_account_id`, which
 * is also in this list), but we keep it here as belt-and-braces in case a
 * caller tries to flip it directly.
 */
export function validateUpdatePayment(
  patch: Record<string, unknown>,
  existing: PaymentRow,
): ValidationResult<void> {
  const immutableErrors = validateImmutableFields<PaymentRow>(
    patch,
    IMMUTABLE_PAYMENT_FIELDS,
    existing,
  );

  if (Object.keys(immutableErrors).length > 0) {
    const field = Object.keys(immutableErrors)[0];
    return failure(
      "IMMUTABLE_FIELD",
      `Field '${field}' cannot be changed after creation`,
      immutableErrors,
    );
  }

  return success(undefined);
}
