/**
 * Pure helpers for payment line math — used by `app/actions/payments.ts`.
 *
 * This module exists because the actions file carries a `"use server"`
 * directive, which marks every exported function as a server action.
 * Non-action pure functions must live outside that file so they can be
 * imported both from the actions file and from unit tests.
 *
 * Canonical formulas live in `docs/api-design-principles.md` under
 * "Invoice payment progress".
 */

import { PAYMENT_DIRECTION } from "@/lib/types";

export type InvoiceType = "outgoing" | "incoming";

/**
 * Signed contribution of a payment line to an invoice's `paid` total.
 *
 * Positive when the money flows toward the invoice's owner — inbound
 * for outgoing invoices (money toward Korakuen), outbound for incoming
 * invoices (money toward the vendor). Negative in the opposite case,
 * which is how refunds and self-detracción legs self-cancel.
 */
export function signedContributionForInvoice(
  paymentDirection: number,
  amountPen: number,
  invoiceType: InvoiceType,
): number {
  if (invoiceType === "outgoing") {
    if (paymentDirection === PAYMENT_DIRECTION.inbound) return amountPen;
    if (paymentDirection === PAYMENT_DIRECTION.outbound) return -amountPen;
    return 0;
  }
  if (paymentDirection === PAYMENT_DIRECTION.outbound) return amountPen;
  if (paymentDirection === PAYMENT_DIRECTION.inbound) return -amountPen;
  return 0;
}

export type AutoSplitDecision =
  | { kind: "no_split" }
  | {
      kind: "split";
      fillAmount: number;
      fillAmountPen: number;
      remainderAmount: number;
      remainderAmountPen: number;
    };

/**
 * Decide whether linking a payment line to an invoice should auto-split
 * it into a "fill exactly" Part A and a "remainder as general line"
 * Part B.
 *
 * Triggers only when:
 *   - The line's contribution to the invoice is positive-direction
 *     (matches the money-toward-owner side), AND
 *   - The invoice has remaining outstanding (`total_pen - currentPaid > 0`), AND
 *   - The line's `amount_pen` exceeds that remaining outstanding.
 *
 * Negative-direction contributions (refunds, self-detracción legs) never
 * split — their full amount is preserved as history. Lines that fit
 * exactly don't split either (Part A would equal the original).
 *
 * Split math:
 *   fillAmountPen     = invoiceTotalPen - currentPaid  (rounded to 2dp)
 *   remainderAmountPen = line.amount_pen - fillAmountPen
 *   fillAmount        = round(line.amount × fillAmountPen / line.amount_pen)
 *   remainderAmount   = line.amount - fillAmount  (exact subtraction to
 *                                                  preserve fill + remainder
 *                                                  = original)
 *
 * Pure function. No DB access.
 */
export function autoSplitOnOverflow(
  line: { amount: number; amount_pen: number },
  invoiceTotalPen: number,
  currentPaid: number,
  signedContribution: number,
): AutoSplitDecision {
  if (signedContribution <= 0) return { kind: "no_split" };
  const remaining = invoiceTotalPen - currentPaid;
  if (remaining <= 0) return { kind: "no_split" };
  if (line.amount_pen <= remaining) return { kind: "no_split" };

  const fillAmountPen = Math.round(remaining * 100) / 100;
  const remainderAmountPen =
    Math.round((line.amount_pen - fillAmountPen) * 100) / 100;
  const ratio = fillAmountPen / line.amount_pen;
  const fillAmount = Math.round(line.amount * ratio * 100) / 100;
  const remainderAmount = Math.round((line.amount - fillAmount) * 100) / 100;

  return {
    kind: "split",
    fillAmount,
    fillAmountPen,
    remainderAmount,
    remainderAmountPen,
  };
}
