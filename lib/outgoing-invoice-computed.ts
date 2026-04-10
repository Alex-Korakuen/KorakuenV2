/**
 * Derived fields for outgoing invoices — the `_computed` block.
 *
 * Three dimensions live here, none of which are stored on the row:
 *   - payment progress (derived from payment_lines)
 *   - SUNAT registration (derived from estado_sunat)
 *   - split paid/outstanding across regular + Banco de la Nación accounts
 *
 * In Step 8, payment_lines always returns zero rows (no payment line CRUD
 * exists yet), so paid_regular/paid_bn are zero and the outstanding values
 * equal the invoice totals. When Step 10 lands and payment lines become
 * real, the same helper starts returning non-zero values with zero other
 * changes to the server actions.
 *
 * Canonical formulas live in docs/api-design-principles.md under
 * "Outgoing invoice payment progress" and "Outgoing invoice SUNAT registration".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutgoingInvoiceRow } from "@/lib/types";

// Supabase returns foreign-table joins as arrays by default in the generated
// types, even for m:1 relations. We accept either shape and normalize.
type JoinedPayment = { is_detraction: boolean | null };
type LineWithPayment = {
  amount_pen: number;
  payments: JoinedPayment | JoinedPayment[] | null;
};

function isDetractionPayment(row: LineWithPayment): boolean {
  const p = row.payments;
  if (p == null) return false;
  if (Array.isArray(p)) return p.length > 0 && p[0]?.is_detraction === true;
  return p.is_detraction === true;
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
  paid_regular: number;
  paid_bn: number;
  outstanding_regular: number;
  outstanding_bn: number;
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

/**
 * Compute the full `_computed` block for a single outgoing invoice.
 *
 * Queries payment_lines joined on payments to get the split between
 * regular receipts and Banco de la Nación (detracción) receipts.
 * Zero rows in Step 8; real values once Step 10 ships payment line CRUD.
 */
export async function computeOutgoingInvoicePaymentProgress(
  supabase: SupabaseClient,
  invoice: Pick<
    OutgoingInvoiceRow,
    "id" | "total_pen" | "detraction_amount" | "estado_sunat"
  >,
): Promise<OutgoingInvoiceComputed> {
  const totalPen = Number(invoice.total_pen);
  const detractionAmount = Number(invoice.detraction_amount ?? 0);
  const expectedRegular = totalPen - detractionAmount;
  const expectedBn = detractionAmount;

  // Step 10 hook: sum linked payment_lines split by payments.is_detraction.
  // Keeping the query live (rather than hard-coding zeros) so Step 10
  // doesn't need to touch this file — payment_lines table is empty today,
  // so the query naturally returns zeros.
  const { data: lines } = await supabase
    .from("payment_lines")
    .select("amount_pen, payments!inner(is_detraction, deleted_at)")
    .eq("outgoing_invoice_id", invoice.id)
    .is("payments.deleted_at", null);

  let paidRegular = 0;
  let paidBn = 0;
  for (const row of (lines ?? []) as unknown as LineWithPayment[]) {
    const amt = Number(row.amount_pen);
    if (isDetractionPayment(row)) {
      paidBn += amt;
    } else {
      paidRegular += amt;
    }
  }

  const outstandingRegular = Math.max(expectedRegular - paidRegular, 0);
  const outstandingBn = Math.max(expectedBn - paidBn, 0);
  const totalPaid = paidRegular + paidBn;

  let paymentState: OutgoingInvoicePaymentState;
  if (totalPaid === 0) {
    paymentState = "unpaid";
  } else if (totalPaid < totalPen) {
    paymentState = "partially_paid";
  } else {
    paymentState = "paid";
  }

  return {
    payment_state: paymentState,
    sunat_state: deriveSunatState(invoice.estado_sunat),
    paid_regular: paidRegular,
    paid_bn: paidBn,
    outstanding_regular: outstandingRegular,
    outstanding_bn: outstandingBn,
    is_fully_paid: outstandingRegular === 0 && outstandingBn === 0,
  };
}

/**
 * Batch version: compute the `_computed` block for many invoices in one
 * pair of queries. Used by getOutgoingInvoices to avoid an N+1 pattern.
 */
export async function computeOutgoingInvoicePaymentProgressBatch(
  supabase: SupabaseClient,
  invoices: Array<
    Pick<
      OutgoingInvoiceRow,
      "id" | "total_pen" | "detraction_amount" | "estado_sunat"
    >
  >,
): Promise<Map<string, OutgoingInvoiceComputed>> {
  const result = new Map<string, OutgoingInvoiceComputed>();
  if (invoices.length === 0) return result;

  const ids = invoices.map((i) => i.id);

  // One query for all payment lines linked to any of the invoices
  const { data: lines } = await supabase
    .from("payment_lines")
    .select("outgoing_invoice_id, amount_pen, payments!inner(is_detraction, deleted_at)")
    .in("outgoing_invoice_id", ids)
    .is("payments.deleted_at", null);

  const paidByInvoice = new Map<string, { regular: number; bn: number }>();
  for (const row of (lines ?? []) as unknown as Array<
    LineWithPayment & { outgoing_invoice_id: string }
  >) {
    const bucket = paidByInvoice.get(row.outgoing_invoice_id) ?? {
      regular: 0,
      bn: 0,
    };
    const amt = Number(row.amount_pen);
    if (isDetractionPayment(row)) {
      bucket.bn += amt;
    } else {
      bucket.regular += amt;
    }
    paidByInvoice.set(row.outgoing_invoice_id, bucket);
  }

  for (const inv of invoices) {
    const totalPen = Number(inv.total_pen);
    const detractionAmount = Number(inv.detraction_amount ?? 0);
    const expectedRegular = totalPen - detractionAmount;
    const expectedBn = detractionAmount;
    const paid = paidByInvoice.get(inv.id) ?? { regular: 0, bn: 0 };
    const outstandingRegular = Math.max(expectedRegular - paid.regular, 0);
    const outstandingBn = Math.max(expectedBn - paid.bn, 0);
    const totalPaid = paid.regular + paid.bn;

    let paymentState: OutgoingInvoicePaymentState;
    if (totalPaid === 0) paymentState = "unpaid";
    else if (totalPaid < totalPen) paymentState = "partially_paid";
    else paymentState = "paid";

    result.set(inv.id, {
      payment_state: paymentState,
      sunat_state: deriveSunatState(inv.estado_sunat),
      paid_regular: paid.regular,
      paid_bn: paid.bn,
      outstanding_regular: outstandingRegular,
      outstanding_bn: outstandingBn,
      is_fully_paid: outstandingRegular === 0 && outstandingBn === 0,
    });
  }

  return result;
}
