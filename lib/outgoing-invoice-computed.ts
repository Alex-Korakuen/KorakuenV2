/**
 * Derived fields for outgoing invoices — the `_computed` block.
 *
 * Two dimensions live here, neither stored on the row:
 *   - payment progress (derived from payment_lines via the signed formula)
 *   - SUNAT registration (derived from estado_sunat)
 *
 * Paid is a signed sum: positive contributions come from inbound payments
 * (money flowing toward Korakuen), negative contributions from outbound
 * payments (refunds, self-detracción legs, internal transfers). The same
 * formula handles every scenario — no buckets, no special cases. See
 * docs/api-design-principles.md → "Invoice payment progress" for the
 * canonical derivation and the scenarios it handles.
 *
 * Detraction columns on the row (detraction_rate, detraction_amount,
 * detraction_status, detraction_handled_by, detraction_constancia_*) are
 * informational reference data. This helper ignores them — they do not
 * affect paid or outstanding. Accountants maintain them manually.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAYMENT_DIRECTION,
} from "@/lib/types";
import type { OutgoingInvoiceRow } from "@/lib/types";

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
 * Signed contribution of a payment line to an outgoing invoice's paid:
 * positive for inbound (money toward Korakuen), negative for outbound.
 */
function signedContribution(row: LineWithPayment): number {
  const amt = Number(row.amount_pen);
  const dir = paymentDirection(row);
  if (dir === PAYMENT_DIRECTION.inbound) return amt;
  if (dir === PAYMENT_DIRECTION.outbound) return -amt;
  return 0;
}

export type OutgoingInvoicePaymentState =
  | "unpaid"
  | "partially_paid"
  | "paid";

export type OutgoingInvoiceSunatState =
  | "not_submitted"
  | "pending"
  | "accepted"
  | "rejected";

export type OutgoingInvoiceComputed = {
  payment_state: OutgoingInvoicePaymentState;
  sunat_state: OutgoingInvoiceSunatState;
  paid: number;
  outstanding: number;
  is_fully_paid: boolean;
};

/**
 * Derive the SUNAT registration state from the estado_sunat column value.
 * No DB query — pure function.
 */
export function deriveSunatState(
  estadoSunat: string | null,
): OutgoingInvoiceSunatState {
  if (estadoSunat == null) return "not_submitted";
  const v = estadoSunat.toLowerCase();
  if (v === "accepted" || v === "aceptado") return "accepted";
  if (v === "pending" || v === "pendiente") return "pending";
  if (v === "rejected" || v === "rechazado") return "rejected";
  return "not_submitted";
}

function derivePaymentState(
  totalPen: number,
  paid: number,
): OutgoingInvoicePaymentState {
  if (paid <= 0) return "unpaid";
  if (paid < totalPen) return "partially_paid";
  return "paid";
}

function buildComputed(
  totalPen: number,
  paid: number,
  estadoSunat: string | null,
): OutgoingInvoiceComputed {
  const outstanding = Math.max(totalPen - paid, 0);
  return {
    payment_state: derivePaymentState(totalPen, paid),
    sunat_state: deriveSunatState(estadoSunat),
    paid,
    outstanding,
    is_fully_paid: paid >= totalPen && totalPen > 0,
  };
}

/**
 * Compute the full `_computed` block for a single outgoing invoice.
 *
 * Queries payment_lines joined on (non-deleted) payments and sums the
 * direction-signed contributions of each linked line.
 */
export async function computeOutgoingInvoicePaymentProgress(
  supabase: SupabaseClient,
  invoice: Pick<
    OutgoingInvoiceRow,
    "id" | "total_pen" | "estado_sunat"
  >,
): Promise<OutgoingInvoiceComputed> {
  const totalPen = Number(invoice.total_pen);

  const { data: lines } = await supabase
    .from("payment_lines")
    .select("amount_pen, payments!inner(direction, deleted_at)")
    .eq("outgoing_invoice_id", invoice.id)
    .is("payments.deleted_at", null);

  let paid = 0;
  for (const row of (lines ?? []) as unknown as LineWithPayment[]) {
    paid += signedContribution(row);
  }

  return buildComputed(totalPen, paid, invoice.estado_sunat);
}

/**
 * Batch version: compute the `_computed` block for many invoices in one
 * query. Used by getOutgoingInvoices to avoid an N+1 pattern.
 */
export async function computeOutgoingInvoicePaymentProgressBatch(
  supabase: SupabaseClient,
  invoices: Array<
    Pick<OutgoingInvoiceRow, "id" | "total_pen" | "estado_sunat">
  >,
): Promise<Map<string, OutgoingInvoiceComputed>> {
  const result = new Map<string, OutgoingInvoiceComputed>();
  if (invoices.length === 0) return result;

  const ids = invoices.map((i) => i.id);

  const { data: lines } = await supabase
    .from("payment_lines")
    .select("outgoing_invoice_id, amount_pen, payments!inner(direction, deleted_at)")
    .in("outgoing_invoice_id", ids)
    .is("payments.deleted_at", null);

  const paidByInvoice = new Map<string, number>();
  for (const row of (lines ?? []) as unknown as Array<
    LineWithPayment & { outgoing_invoice_id: string }
  >) {
    const current = paidByInvoice.get(row.outgoing_invoice_id) ?? 0;
    paidByInvoice.set(row.outgoing_invoice_id, current + signedContribution(row));
  }

  for (const inv of invoices) {
    const paid = paidByInvoice.get(inv.id) ?? 0;
    result.set(inv.id, buildComputed(Number(inv.total_pen), paid, inv.estado_sunat));
  }

  return result;
}
