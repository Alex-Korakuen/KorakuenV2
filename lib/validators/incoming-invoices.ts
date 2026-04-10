import { success, failure, INCOMING_INVOICE_FACTURA_STATUS } from "@/lib/types";
import type { ValidationResult, IncomingInvoiceRow } from "@/lib/types";
import { assertTransition } from "@/lib/lifecycle";

// ---------------------------------------------------------------------------
// factura_status transition validation
// ---------------------------------------------------------------------------

type SunatRequiredFields = Pick<
  IncomingInvoiceRow,
  | "serie_numero"
  | "fecha_emision"
  | "tipo_documento_code"
  | "ruc_emisor"
  | "ruc_receptor"
>;

/**
 * Validate a factura_status transition on an incoming invoice.
 *
 * Current lifecycle map (from `lib/lifecycle.ts`):
 *   expected (1) → received (2)   — one-way
 *
 * When landing on `received`, the five SUNAT identifier fields must all
 * be populated. This mirrors the DB CHECK constraint
 * `ii_received_requires_sunat` so callers see a structured validator
 * error instead of a Postgres failure.
 *
 * `afterState` should be the effective row after the proposed update has
 * been applied (i.e. `{ ...current, ...updates }`).
 */
export function validateFacturaStatusTransition(
  from: number,
  to: number,
  afterState: SunatRequiredFields,
): ValidationResult<void> {
  const transitionResult = assertTransition("incoming_invoice", from, to);
  if (!transitionResult.success) {
    return transitionResult;
  }

  if (to === INCOMING_INVOICE_FACTURA_STATUS.received) {
    const fields: Record<string, string> = {};

    if (!afterState.serie_numero) {
      fields.serie_numero = "Required when factura_status is received";
    }
    if (!afterState.fecha_emision) {
      fields.fecha_emision = "Required when factura_status is received";
    }
    if (!afterState.tipo_documento_code) {
      fields.tipo_documento_code = "Required when factura_status is received";
    }
    if (!afterState.ruc_emisor) {
      fields.ruc_emisor = "Required when factura_status is received";
    }
    if (!afterState.ruc_receptor) {
      fields.ruc_receptor = "Required when factura_status is received";
    }

    if (Object.keys(fields).length > 0) {
      return failure(
        "VALIDATION_ERROR",
        "Cannot mark factura as received without complete SUNAT fields",
        fields,
      );
    }
  }

  return success(undefined);
}
