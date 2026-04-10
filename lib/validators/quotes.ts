import {
  OUTGOING_QUOTE_STATUS,
  INCOMING_QUOTE_STATUS,
  success,
  failure,
} from "@/lib/types";
import type {
  ValidationResult,
  CreateOutgoingQuoteInput,
  UpdateOutgoingQuoteInput,
  CreateIncomingQuoteInput,
  OutgoingQuoteRow,
} from "@/lib/types";
import {
  validateCurrencyExchangeRate,
  validateDetractionConsistency,
} from "./shared";

// ---------------------------------------------------------------------------
// Outgoing quote validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating an outgoing quote.
 *
 * Note: outgoing_quotes has no exchange_rate column — quotes are
 * pre-contract documents in whatever currency the client asked for,
 * and the PEN equivalent is only computed at invoice time (when the
 * exchange rate for the issue date is auto-filled from exchange_rates).
 * So this validator only checks that currency is PEN or USD; it does
 * not require exchange_rate.
 */
export function validateOutgoingQuote(
  data: CreateOutgoingQuoteInput,
): ValidationResult<CreateOutgoingQuoteInput> {
  const fields: Record<string, string> = {};

  if (!data.project_id) {
    fields.project_id = "Required";
  }

  if (!data.contact_id) {
    fields.contact_id = "Required";
  }

  if (!data.issue_date) {
    fields.issue_date = "Required";
  }

  const currency = data.currency ?? "PEN";
  if (currency !== "PEN" && currency !== "USD") {
    fields.currency = "Must be PEN or USD";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Outgoing quote validation failed", fields);
  }

  return success(data);
}

/**
 * Validate an outgoing quote header update. Only a handful of fields are
 * editable and only while the quote is in draft.
 */
export function validateUpdateOutgoingQuote(
  data: UpdateOutgoingQuoteInput,
): ValidationResult<UpdateOutgoingQuoteInput> {
  const fields: Record<string, string> = {};

  if ("currency" in data) {
    const cur = data.currency ?? "PEN";
    if (cur !== "PEN" && cur !== "USD") {
      fields.currency = "Must be PEN or USD";
    }
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Outgoing quote update validation failed", fields);
  }

  return success(data);
}

/**
 * Assert that an outgoing quote is in a state that allows header mutation.
 * Line item mutations use assertQuoteLineItemsMutable (draft only). Header
 * fields follow the same rule — after the quote leaves draft, the contract
 * basis is frozen.
 */
export function assertOutgoingQuoteHeaderMutable(
  quote: Pick<OutgoingQuoteRow, "status" | "deleted_at">,
): ValidationResult<void> {
  if (quote.deleted_at) {
    return failure("NOT_FOUND", "Outgoing quote has been deleted");
  }
  if (quote.status !== OUTGOING_QUOTE_STATUS.draft) {
    return failure(
      "CONFLICT",
      "No se puede modificar una cotización que no está en borrador",
      {
        status: `Outgoing quote must be in draft (${OUTGOING_QUOTE_STATUS.draft}) to edit. Current: ${quote.status}`,
      },
    );
  }
  return success(undefined);
}

// ---------------------------------------------------------------------------
// Incoming quote validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating an incoming quote.
 */
export function validateIncomingQuote(
  data: CreateIncomingQuoteInput,
): ValidationResult<CreateIncomingQuoteInput> {
  const fields: Record<string, string> = {};

  if (!data.contact_id) {
    fields.contact_id = "Required";
  }

  if (!data.description?.trim()) {
    fields.description = "Required";
  }

  Object.assign(fields, validateCurrencyExchangeRate(data.currency, data.exchange_rate));
  Object.assign(fields, validateDetractionConsistency(data.detraction_rate, data.detraction_amount));

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Incoming quote validation failed", fields);
  }

  return success(data);
}

// ---------------------------------------------------------------------------
// Quote line item immutability
// ---------------------------------------------------------------------------

/**
 * Check that a quote is in a status that allows line item mutations.
 * Returns CONFLICT error if the quote is locked.
 */
export function assertQuoteLineItemsMutable(
  quoteStatus: number,
  quoteType: "outgoing_quote" | "incoming_quote",
): ValidationResult<void> {
  const draftStatus =
    quoteType === "outgoing_quote"
      ? OUTGOING_QUOTE_STATUS.draft
      : INCOMING_QUOTE_STATUS.draft;

  if (quoteStatus === draftStatus) {
    return success(undefined);
  }

  return failure(
    "CONFLICT",
    `Cannot modify line items on ${quoteType} — quote is no longer in draft status`,
    {
      status: `Line items are locked at status ${quoteStatus}. Quote must be in draft (${draftStatus}) to modify line items`,
    },
  );
}

// ---------------------------------------------------------------------------
// Winning quote uniqueness
// ---------------------------------------------------------------------------

/**
 * Validate that at most one quote per project can be flagged as winning.
 *
 * @param currentQuoteId - The quote being updated (null if creating new)
 * @param existingWinnerId - The ID of the current winning quote on this project (null if none)
 */
export function validateWinningQuoteUniqueness(
  currentQuoteId: string | null,
  existingWinnerId: string | null,
): ValidationResult<void> {
  // No conflict if there's no existing winner
  if (!existingWinnerId) {
    return success(undefined);
  }

  // No conflict if the current quote IS the existing winner (updating itself)
  if (currentQuoteId === existingWinnerId) {
    return success(undefined);
  }

  return failure(
    "CONFLICT",
    "Another quote is already flagged as the winning quote for this project",
    {
      is_winning_quote: `Quote ${existingWinnerId} is already the winning quote. Unset it first.`,
    },
  );
}
