import {
  PROJECT_STATUS,
  OUTGOING_QUOTE_STATUS,
  OUTGOING_INVOICE_STATUS,
  INCOMING_QUOTE_STATUS,
  INCOMING_INVOICE_FACTURA_STATUS,
  SUBMISSION_STATUS,
  failure,
  success,
} from "@/lib/types";
import type { ValidationResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status transition map
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, Record<number, number[]>> = {
  project: {
    [PROJECT_STATUS.prospect]: [PROJECT_STATUS.active, PROJECT_STATUS.rejected],
    [PROJECT_STATUS.active]: [PROJECT_STATUS.completed, PROJECT_STATUS.rejected],
    [PROJECT_STATUS.completed]: [PROJECT_STATUS.archived],
  },
  outgoing_quote: {
    [OUTGOING_QUOTE_STATUS.draft]: [OUTGOING_QUOTE_STATUS.sent],
    [OUTGOING_QUOTE_STATUS.sent]: [
      OUTGOING_QUOTE_STATUS.approved,
      OUTGOING_QUOTE_STATUS.rejected,
      OUTGOING_QUOTE_STATUS.expired,
    ],
  },
  outgoing_invoice: {
    [OUTGOING_INVOICE_STATUS.draft]: [OUTGOING_INVOICE_STATUS.sent],
    [OUTGOING_INVOICE_STATUS.sent]: [
      OUTGOING_INVOICE_STATUS.draft, // undo — validator blocks if SUNAT data committed
      OUTGOING_INVOICE_STATUS.void,  // validator blocks if payment_lines reference this invoice
    ],
  },
  incoming_quote: {
    [INCOMING_QUOTE_STATUS.draft]: [
      INCOMING_QUOTE_STATUS.approved,
      INCOMING_QUOTE_STATUS.cancelled,
    ],
  },
  incoming_invoice: {
    [INCOMING_INVOICE_FACTURA_STATUS.expected]: [
      INCOMING_INVOICE_FACTURA_STATUS.received,
    ],
  },
  submission: {
    [SUBMISSION_STATUS.pending]: [
      SUBMISSION_STATUS.approved,
      SUBMISSION_STATUS.rejected,
    ],
  },
};

// ---------------------------------------------------------------------------
// Status labels (human-readable, for error messages)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, Record<number, string>> = {
  project: {
    [PROJECT_STATUS.prospect]: "prospect",
    [PROJECT_STATUS.active]: "active",
    [PROJECT_STATUS.completed]: "completed",
    [PROJECT_STATUS.archived]: "archived",
    [PROJECT_STATUS.rejected]: "rejected",
  },
  outgoing_quote: {
    [OUTGOING_QUOTE_STATUS.draft]: "draft",
    [OUTGOING_QUOTE_STATUS.sent]: "sent",
    [OUTGOING_QUOTE_STATUS.approved]: "approved",
    [OUTGOING_QUOTE_STATUS.rejected]: "rejected",
    [OUTGOING_QUOTE_STATUS.expired]: "expired",
  },
  outgoing_invoice: {
    [OUTGOING_INVOICE_STATUS.draft]: "draft",
    [OUTGOING_INVOICE_STATUS.sent]: "sent",
    [OUTGOING_INVOICE_STATUS.void]: "void",
  },
  incoming_quote: {
    [INCOMING_QUOTE_STATUS.draft]: "draft",
    [INCOMING_QUOTE_STATUS.approved]: "approved",
    [INCOMING_QUOTE_STATUS.cancelled]: "cancelled",
  },
  incoming_invoice: {
    [INCOMING_INVOICE_FACTURA_STATUS.expected]: "expected",
    [INCOMING_INVOICE_FACTURA_STATUS.received]: "received",
  },
  submission: {
    [SUBMISSION_STATUS.pending]: "pending",
    [SUBMISSION_STATUS.approved]: "approved",
    [SUBMISSION_STATUS.rejected]: "rejected",
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a status transition is valid.
 */
export function canTransition(
  table: string,
  from: number,
  to: number,
): boolean {
  return TRANSITIONS[table]?.[from]?.includes(to) ?? false;
}

/**
 * Assert a status transition is valid, returning a structured error if not.
 */
export function assertTransition(
  table: string,
  from: number,
  to: number,
): ValidationResult<void> {
  if (canTransition(table, from, to)) {
    return success(undefined);
  }

  const fromLabel = getStatusLabel(table, from);
  const toLabel = getStatusLabel(table, to);
  const valid = getValidTransitions(table, from);
  const validLabels = valid.map((s) => `${getStatusLabel(table, s)} (${s})`);

  return failure(
    "CONFLICT",
    `Cannot transition ${table} from ${fromLabel} to ${toLabel}`,
    {
      status: valid.length > 0
        ? `Valid transitions from ${fromLabel} (${from}): ${validLabels.join(", ")}`
        : `No transitions available from ${fromLabel} (${from})`,
    },
  );
}

/**
 * Get the list of valid next statuses from a given status.
 */
export function getValidTransitions(table: string, from: number): number[] {
  return TRANSITIONS[table]?.[from] ?? [];
}

/**
 * Get the human-readable label for a status value.
 */
export function getStatusLabel(table: string, status: number): string {
  return STATUS_LABELS[table]?.[status] ?? `unknown(${status})`;
}
