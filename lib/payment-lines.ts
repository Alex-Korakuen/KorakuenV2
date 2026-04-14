import type { PaymentLineRow } from "@/lib/types";

type LineLinkShape = Pick<
  PaymentLineRow,
  "outgoing_invoice_id" | "incoming_invoice_id" | "loan_id"
>;

/**
 * A line is "unlinked" when it does not reference any invoice or loan.
 * Dangling lines like these are the ones the reconciliation UI flags as
 * "sin vincular" because they carry cash that has not been attributed to
 * any document.
 */
export function lineIsUnlinked(line: LineLinkShape): boolean {
  return (
    line.outgoing_invoice_id == null &&
    line.incoming_invoice_id == null &&
    line.loan_id == null
  );
}

/**
 * Sum of the unsigned PEN amounts across all unlinked lines in a payment.
 * Used by the payments list to show how much cash still needs to be
 * reconciled against invoices.
 */
export function unlinkedAmountPen(
  lines: Array<LineLinkShape & { amount_pen: number }>,
): number {
  let total = 0;
  for (const line of lines) {
    if (lineIsUnlinked(line)) {
      total += Math.abs(Number(line.amount_pen));
    }
  }
  return Math.round(total * 100) / 100;
}
