/**
 * Derived fields for incoming invoices — the `_computed` block.
 *
 * Two dimensions live here, neither stored on the row:
 *   - payment progress (derived from payment_lines)
 *   - "needs factura" flag (expected invoice with payments already against it)
 *
 * Incoming invoices don't split paid amounts by regular vs Banco de la
 * Nación the way outgoing invoices do — the BN split on the outgoing
 * side exists because clients pay the detracción directly to our BN
 * account, which is a separate bucket of money with its own restrictions.
 * On the incoming side, when WE pay a vendor's detracción ourselves,
 * it's just an ordinary outbound payment from our regular account —
 * no split bucket, no special treatment here.
 *
 * In Step 9, payment_lines always returns zero rows (Step 10 builds
 * payment line CRUD), so `paid` is zero, `outstanding` equals `total_pen`,
 * `payment_state` is "unpaid", and `needs_factura` is always false.
 * Step 10 lights this up without touching this file.
 *
 * Canonical formula lives in docs/api-design-principles.md under
 * "Incoming invoice payment progress" and the SQL equivalent is
 * `get_incoming_invoice_payment_progress(invoice_id)` from the Step 6.5
 * schema delta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INCOMING_INVOICE_FACTURA_STATUS,
} from "@/lib/types";
import type { IncomingInvoiceRow } from "@/lib/types";

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
   * but has at least one payment line against it. This is the "chase the
   * factura" flag — the admin has already sent money and needs to nag
   * the vendor for the paper trail. Used as a list filter and as a row
   * badge on the incoming invoices page.
   */
  needs_factura: boolean;
};

function derivePaymentState(
  totalPen: number,
  paid: number,
): IncomingInvoicePaymentState {
  if (paid === 0) return "unpaid";
  if (paid < totalPen) return "partially_paid";
  return "paid";
}

function buildComputed(
  totalPen: number,
  paid: number,
  facturaStatus: number,
): IncomingInvoiceComputed {
  const outstanding = Math.max(totalPen - paid, 0);
  const paymentState = derivePaymentState(totalPen, paid);
  return {
    payment_state: paymentState,
    paid,
    outstanding,
    is_fully_paid: outstanding === 0 && totalPen > 0,
    needs_factura:
      facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.expected && paid > 0,
  };
}

/**
 * Compute the `_computed` block for a single incoming invoice.
 *
 * Uses the `get_incoming_invoice_payment_progress` SQL helper for the
 * paid/outstanding math so the canonical formula lives in one place.
 * Returns zeros on query failure rather than throwing — the block is
 * best-effort and the server action can still return a usable invoice
 * if the auxiliary query has a transient issue.
 */
export async function computeIncomingInvoicePaymentProgress(
  supabase: SupabaseClient,
  invoice: Pick<IncomingInvoiceRow, "id" | "total_pen" | "factura_status">,
): Promise<IncomingInvoiceComputed> {
  const totalPen = Number(invoice.total_pen);

  const { data, error } = await supabase.rpc(
    "get_incoming_invoice_payment_progress",
    { invoice_id: invoice.id },
  );

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    // RPC returns zero rows when the invoice has no payment_lines AND
    // the join filter collapses the group — same as "paid = 0".
    return buildComputed(totalPen, 0, invoice.factura_status);
  }

  const row = data[0] as {
    total_pen: number | string;
    paid: number | string;
    outstanding: number | string;
    payment_state: string;
  };

  return buildComputed(totalPen, Number(row.paid ?? 0), invoice.factura_status);
}

/**
 * Batch version: compute the `_computed` block for many invoices in one
 * query. Used by getIncomingInvoices to avoid an N+1 pattern.
 *
 * Can't easily batch-call the RPC (PostgREST doesn't expose set-returning
 * function invocation across multiple keys), so we run the raw aggregation
 * inline: one query against payment_lines joined to non-deleted payments,
 * bucketed by incoming_invoice_id, then derive the rest in JS.
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
    .select("incoming_invoice_id, amount_pen, payments!inner(deleted_at)")
    .in("incoming_invoice_id", ids)
    .is("payments.deleted_at", null);

  const paidByInvoice = new Map<string, number>();
  for (const row of (lines ?? []) as Array<{
    incoming_invoice_id: string;
    amount_pen: number | string;
  }>) {
    const current = paidByInvoice.get(row.incoming_invoice_id) ?? 0;
    paidByInvoice.set(row.incoming_invoice_id, current + Number(row.amount_pen));
  }

  for (const inv of invoices) {
    const paid = paidByInvoice.get(inv.id) ?? 0;
    result.set(inv.id, buildComputed(Number(inv.total_pen), paid, inv.factura_status));
  }

  return result;
}
