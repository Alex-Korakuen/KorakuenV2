import { describe, it, expect } from "vitest";
import {
  autoSplitOnOverflow,
  signedContributionForInvoice,
} from "../payment-helpers";
import { PAYMENT_DIRECTION } from "../types";

// ---------------------------------------------------------------------------
// signedContributionForInvoice
// ---------------------------------------------------------------------------

describe("signedContributionForInvoice", () => {
  const { inbound, outbound } = PAYMENT_DIRECTION;

  describe("outgoing invoice (money flows toward Korakuen)", () => {
    it("inbound payment contributes positively", () => {
      expect(signedContributionForInvoice(inbound, 100, "outgoing")).toBe(100);
    });

    it("outbound payment contributes negatively (refund / self-detracción leg)", () => {
      expect(signedContributionForInvoice(outbound, 100, "outgoing")).toBe(-100);
    });

    it("returns 0 for unknown direction", () => {
      expect(signedContributionForInvoice(99, 100, "outgoing")).toBe(0);
    });
  });

  describe("incoming invoice (money flows toward the vendor)", () => {
    it("outbound payment contributes positively", () => {
      expect(signedContributionForInvoice(outbound, 100, "incoming")).toBe(100);
    });

    it("inbound payment contributes negatively (vendor refund)", () => {
      expect(signedContributionForInvoice(inbound, 100, "incoming")).toBe(-100);
    });

    it("returns 0 for unknown direction", () => {
      expect(signedContributionForInvoice(99, 100, "incoming")).toBe(0);
    });
  });

  it("handles zero amount cleanly", () => {
    expect(signedContributionForInvoice(inbound, 0, "outgoing")).toBe(0);
    expect(signedContributionForInvoice(outbound, 0, "incoming")).toBe(0);
  });

  it("preserves magnitude for large amounts", () => {
    expect(signedContributionForInvoice(inbound, 123456.78, "outgoing")).toBe(
      123456.78,
    );
    expect(signedContributionForInvoice(outbound, 123456.78, "outgoing")).toBe(
      -123456.78,
    );
  });
});

// ---------------------------------------------------------------------------
// autoSplitOnOverflow
// ---------------------------------------------------------------------------

describe("autoSplitOnOverflow", () => {
  describe("negative-direction contributions never split", () => {
    it("refund line with full amount → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 500, amount_pen: 500 },
        1000,
        1000, // fully paid
        -500, // refund
      );
      expect(result).toEqual({ kind: "no_split" });
    });

    it("outbound self-detracción leg → no split even when 'overflowing'", () => {
      // Scenario: invoice 1000, already paid 1000 (fully). Alex records
      // an outbound leg of 120 — contributes -120 under the signed
      // formula. Not a split candidate.
      const result = autoSplitOnOverflow(
        { amount: 120, amount_pen: 120 },
        1000,
        1000,
        -120,
      );
      expect(result).toEqual({ kind: "no_split" });
    });

    it("zero contribution → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 100, amount_pen: 100 },
        1000,
        500,
        0,
      );
      expect(result).toEqual({ kind: "no_split" });
    });
  });

  describe("fully-paid invoice (no room) never splits", () => {
    it("invoice with currentPaid === total → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 100, amount_pen: 100 },
        1000,
        1000,
        100,
      );
      expect(result).toEqual({ kind: "no_split" });
    });

    it("overpaid invoice (currentPaid > total) → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 100, amount_pen: 100 },
        1000,
        1050, // already overpaid
        100,
      );
      expect(result).toEqual({ kind: "no_split" });
    });
  });

  describe("line fitting exactly or under → no split", () => {
    it("line amount exactly equals remaining → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 200, amount_pen: 200 },
        1000,
        800,
        200,
      );
      expect(result).toEqual({ kind: "no_split" });
    });

    it("line amount under remaining → no split", () => {
      const result = autoSplitOnOverflow(
        { amount: 150, amount_pen: 150 },
        1000,
        500,
        150,
      );
      expect(result).toEqual({ kind: "no_split" });
    });
  });

  describe("positive overflow → split", () => {
    it("PEN line: S/12,000 on a S/10,000 invoice with no prior payments", () => {
      const result = autoSplitOnOverflow(
        { amount: 12000, amount_pen: 12000 },
        10000,
        0,
        12000,
      );
      expect(result).toEqual({
        kind: "split",
        fillAmount: 10000,
        fillAmountPen: 10000,
        remainderAmount: 2000,
        remainderAmountPen: 2000,
      });
    });

    it("PEN line: S/5,000 on a S/10,000 invoice with S/8,000 already paid", () => {
      const result = autoSplitOnOverflow(
        { amount: 5000, amount_pen: 5000 },
        10000,
        8000,
        5000,
      );
      expect(result).toEqual({
        kind: "split",
        fillAmount: 2000,
        fillAmountPen: 2000,
        remainderAmount: 3000,
        remainderAmountPen: 3000,
      });
    });

    it("split sum equals original amount exactly (no rounding drift)", () => {
      const result = autoSplitOnOverflow(
        { amount: 333.33, amount_pen: 333.33 },
        250,
        0,
        333.33,
      );
      if (result.kind !== "split") throw new Error("expected split");
      expect(result.fillAmountPen + result.remainderAmountPen).toBeCloseTo(
        333.33,
        2,
      );
      expect(result.fillAmount + result.remainderAmount).toBeCloseTo(333.33, 2);
    });
  });

  describe("foreign-currency (USD) overflow", () => {
    it("USD line: $1,000 (S/3,800) on S/2,000 invoice — splits proportionally", () => {
      // $1,000 at rate 3.80 = S/3,800. Invoice has S/1,500 remaining.
      // fillAmountPen = 1,500; remainderAmountPen = 2,300
      // ratio = 1500 / 3800 = 0.394736...
      // fillAmount = 1000 × 0.394736... = 394.74 (rounded)
      // remainderAmount = 1000 - 394.74 = 605.26
      const result = autoSplitOnOverflow(
        { amount: 1000, amount_pen: 3800 },
        2000,
        500,
        3800,
      );
      if (result.kind !== "split") throw new Error("expected split");
      expect(result.fillAmountPen).toBe(1500);
      expect(result.remainderAmountPen).toBe(2300);
      expect(result.fillAmount).toBe(394.74);
      expect(result.remainderAmount).toBe(605.26);
      // Critical invariant: fill + remainder = original, exactly
      expect(result.fillAmount + result.remainderAmount).toBeCloseTo(1000, 2);
      expect(result.fillAmountPen + result.remainderAmountPen).toBeCloseTo(
        3800,
        2,
      );
    });

    it("foreign-currency exact-subtraction preserves totals even with ugly ratios", () => {
      // $333.33 at rate 3.76 ≈ S/1,253.32. Invoice remaining S/700.
      const result = autoSplitOnOverflow(
        { amount: 333.33, amount_pen: 1253.32 },
        1000,
        300,
        1253.32,
      );
      if (result.kind !== "split") throw new Error("expected split");
      // Sum of fill + remainder must equal original within tolerance
      expect(result.fillAmount + result.remainderAmount).toBeCloseTo(333.33, 2);
      expect(result.fillAmountPen + result.remainderAmountPen).toBeCloseTo(
        1253.32,
        2,
      );
    });
  });

  describe("edge amounts", () => {
    it("tiny overflow (S/0.01 over) still triggers a split", () => {
      const result = autoSplitOnOverflow(
        { amount: 100.01, amount_pen: 100.01 },
        1000,
        900,
        100.01,
      );
      if (result.kind !== "split") throw new Error("expected split");
      expect(result.fillAmountPen).toBe(100);
      expect(result.remainderAmountPen).toBeCloseTo(0.01, 2);
    });

    it("large amounts round cleanly", () => {
      const result = autoSplitOnOverflow(
        { amount: 1_000_000, amount_pen: 1_000_000 },
        500_000,
        0,
        1_000_000,
      );
      expect(result).toEqual({
        kind: "split",
        fillAmount: 500_000,
        fillAmountPen: 500_000,
        remainderAmount: 500_000,
        remainderAmountPen: 500_000,
      });
    });
  });
});
