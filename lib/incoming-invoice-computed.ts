/**
 * Derived fields for incoming invoices — the `_computed` block.
 *
 * Two dimensions live here, neither stored on the row:
 *   - payment progress (derived from payment_lines via the signed formula)
 *   - "needs factura" flag (expected invoice with payments already against it)
 *
 * Paid is a signed sum: positive contributions come from outbound payments
 * (money flowing toward the vendor — the normal direction for paying a
 * cost invoice), negative contributions from inbound payments (refunds
 * from the vendor, reversals). The same formula handles every scenario.
 * See docs/api-design-principles.md → "Invoice payment progress" for the
 * canonical derivation.
 *
 * Detraction columns on the row (detraction_rate, detraction_amount,
 * detraction_handled_by, detraction_constancia_*) are informational
 * reference data — this helper does not read them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INCOMING_INVOICE_FACTURA_STATUS,
  PAYMENT_DIRECTION,
} from "@/lib/types";
import type { IncomingInvoiceRow } from "@/lib/types";

type JoinedPayment = { direction: number | null; deleted_at: string | null };
type LineWithPayment = {
  amount_pen: number;
  payments: JoinedPayment | JoinedPayment[] | null;
};

function paymentDirection(row: LineWithPayment): number | null {
  const p = row.payments;
  if (p == null) return null;
  if (Array.isArray(p)) return p.length > 0 ? p[0]?.direction ?? null : null;
  return p.direction ?? null;
}

/**
 * Signed contribution of a payment line to an incoming invoice's paid:
 * positive for outbound (money toward the vendor), negative for inbound
 * (refund from the vendor).
 */
function signedContribution(row: LineWithPayment): number {
  const amt = Number(row.amount_pen);
  const dir = paymentDirection(row);
  if (dir === PAYMENT_DIRECTION.outbound) return amt;
  if (dir === PAYMENT_DIRECTION.inbound) return -amt;
  return 0;
}

export type IncomingInvoicePaymentState =
  | "unpaid"
  | "partially_paid"
  | "paid";

export type IncomingInvoiceComputed = {
  payment_state: IncomingInvoicePaymentState;
  paid: number;
  outstanding: number;
  is_fully_paid: boolean;
  /**
   * True when the invoice is still `expected` (no SUNAT paperwork in hand)
   * but has at least one payment line against it. The "chase the factura"
   * flag — Alex has already sent money and needs to nag the vendor for
   * the paper trail.
   */
  needs_factura: boolean;
};

function derivePaymentState(
  totalPen: number,
  paid: number,
): IncomingInvoicePaymentState {
  if (paid <= 0) return "unpaid";
  if (paid < totalPen) return "partially_paid";
  return "paid";
}

function buildComputed(
  totalPen: number,
  paid: number,
  facturaStatus: number,
): IncomingInvoiceComputed {
  const outstanding = Math.max(totalPen - paid, 0);
  return {
    payment_state: derivePaymentState(totalPen, paid),
    paid,
    outstanding,
    is_fully_paid: paid >= totalPen && totalPen > 0,
    needs_factura:
      facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.expected && paid > 0,
  };
}

/**
 * Compute the `_computed` block for a single incoming invoice. Delegates
 * to the batch helper with a one-element array so both code paths run the
 * same signed-formula aggregation.
 *
 * Note: the stale `get_incoming_invoice_payment_progress` SQL RPC from
 * Step 6.5 uses an unsigned sum and is not called by this helper. The
 * RPC is left in the database for now; a future migration can update or
 * remove it.
 */
export async function computeIncomingInvoicePaymentProgress(
  supabase: SupabaseClient,
  invoice: Pick<IncomingInvoiceRow, "id" | "total_pen" | "factura_status">,
): Promise<IncomingInvoiceComputed> {
  const map = await computeIncomingInvoicePaymentProgressBatch(supabase, [invoice]);
  return (
    map.get(invoice.id) ??
    buildComputed(Number(invoice.total_pen), 0, invoice.factura_status)
  );
}

/**
 * Batch version: compute the `_computed` block for many invoices in one
 * query. Used by getIncomingInvoices to avoid an N+1 pattern.
 */
export async function computeIncomingInvoicePaymentProgressBatch(
  supabase: SupabaseClient,
  invoices: Array<
    Pick<IncomingInvoiceRow, "id" | "total_pen" | "factura_status">
  >,
): Promise<Map<string, IncomingInvoiceComputed>> {
  const result = new Map<string, IncomingInvoiceComputed>();
  if (invoices.length === 0) return result;

  const ids = invoices.map((i) => i.id);

  const { data: lines } = await supabase
    .from("payment_lines")
    .select("incoming_invoice_id, amount_pen, payments!inner(direction, deleted_at)")
    .in("incoming_invoice_id", ids)
    .is("payments.deleted_at", null);

  const paidByInvoice = new Map<string, number>();
  for (const row of (lines ?? []) as unknown as Array<
    LineWithPayment & { incoming_invoice_id: string }
  >) {
    const current = paidByInvoice.get(row.incoming_invoice_id) ?? 0;
    paidByInvoice.set(row.incoming_invoice_id, current + signedContribution(row));
  }

  for (const inv of invoices) {
    const paid = paidByInvoice.get(inv.id) ?? 0;
    result.set(inv.id, buildComputed(Number(inv.total_pen), paid, inv.factura_status));
  }

  return result;
}
