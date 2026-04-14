import { describe, it, expect } from "vitest";
import {
  validateCreatePayment,
  validatePaymentLine,
  validateBankAccountConsistency,
  validatePaymentInvoiceCurrency,
  validateSplitSumToOriginal,
  validatePaymentMutable,
  validateUpdatePayment,
  validateReconcilePayment,
  validateUnreconcilePayment,
} from "../payments";
import {
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
  ACCOUNT_TYPE,
} from "../../types";
import type {
  CreatePaymentInput,
  CreatePaymentLineInput,
  BankAccountRow,
  PaymentRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHeader(overrides?: Partial<CreatePaymentInput>): CreatePaymentInput {
  return {
    direction: PAYMENT_DIRECTION.inbound,
    bank_account_id: "acc-1",
    // Every payment must now carry a partner attribution. Tests use a dummy
    // UUID; the real FK liveness check lives in the server action, not the
    // pure validator.
    paid_by_partner_id: "00000000-0000-0000-0000-000000000aaa",
    currency: "PEN",
    payment_date: "2026-04-11",
    ...overrides,
  };
}

function makeLine(
  overrides?: Partial<CreatePaymentLineInput>,
): CreatePaymentLineInput {
  return {
    amount: 100,
    amount_pen: 100,
    line_type: PAYMENT_LINE_TYPE.general,
    ...overrides,
  };
}

function makeBankAccount(
  overrides?: Partial<BankAccountRow>,
): BankAccountRow {
  return {
    id: "acc-1",
    name: "BCP Regular",
    bank_name: "BCP",
    account_number: "194-xxx",
    currency: "PEN",
    account_type: ACCOUNT_TYPE.regular,
    is_active: true,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makePaymentRow(overrides?: Partial<PaymentRow>): PaymentRow {
  return {
    id: "pay-1",
    direction: PAYMENT_DIRECTION.inbound,
    bank_account_id: "acc-1",
    project_id: null,
    contact_id: null,
    paid_by_partner_id: "00000000-0000-0000-0000-000000000aaa",
    total_amount: 100,
    currency: "PEN",
    exchange_rate: null,
    total_amount_pen: 100,
    is_detraction: false,
    reconciled: false,
    bank_reference: null,
    reconciled_at: null,
    reconciled_by: null,
    source: 1,
    submission_id: null,
    drive_file_id: null,
    payment_date: "2026-04-11",
    title: null,
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCreatePayment — header
// ---------------------------------------------------------------------------

describe("validateCreatePayment — header rules", () => {
  it("accepts a minimal valid inbound payment with one line", () => {
    const result = validateCreatePayment(makeHeader(), [makeLine()]);
    expect(result.success).toBe(true);
  });

  it("rejects invalid direction", () => {
    const result = validateCreatePayment(makeHeader({ direction: 99 }), [
      makeLine(),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.direction).toBeDefined();
    }
  });

  it("accepts null bank_account_id (off-book partner payment)", () => {
    // bank_account_id became optional when we introduced off-book partner
    // payments — a non-Korakuen consortium partner paying a vendor from
    // their own funds leaves the bank account blank. The validator just
    // lets null through; the "partner must be non-self" half of the rule
    // lives in the createPayment server action because it needs a DB
    // lookup on contacts.is_self.
    const result = validateCreatePayment(
      makeHeader({ bank_account_id: null }),
      [makeLine()],
    );
    expect(result.success).toBe(true);
  });

  it("rejects USD without exchange_rate", () => {
    const result = validateCreatePayment(makeHeader({ currency: "USD" }), [
      makeLine(),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.exchange_rate).toBeDefined();
    }
  });

  it("accepts USD with exchange_rate", () => {
    const result = validateCreatePayment(
      makeHeader({ currency: "USD", exchange_rate: 3.8 }),
      [makeLine({ amount: 100, amount_pen: 380 })],
    );
    expect(result.success).toBe(true);
  });

  it("accepts paid_by_partner_id on inbound payment", () => {
    // Both directions now require partner attribution — an inbound payment
    // to Partner B's account is Partner B's collection for settlement.
    const result = validateCreatePayment(
      makeHeader({
        direction: PAYMENT_DIRECTION.inbound,
        paid_by_partner_id: "partner-1",
      }),
      [makeLine()],
    );
    expect(result.success).toBe(true);
  });

  it("accepts paid_by_partner_id on outbound payment", () => {
    const result = validateCreatePayment(
      makeHeader({
        direction: PAYMENT_DIRECTION.outbound,
        paid_by_partner_id: "partner-1",
      }),
      [makeLine()],
    );
    expect(result.success).toBe(true);
  });

  it("rejects missing paid_by_partner_id", () => {
    const result = validateCreatePayment(
      // Cast through unknown so we can force-omit a now-required field
      makeHeader({ paid_by_partner_id: undefined as unknown as string }),
      [makeLine()],
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.paid_by_partner_id).toBeDefined();
    }
  });

  it("rejects missing payment_date", () => {
    const result = validateCreatePayment(
      makeHeader({ payment_date: "" }),
      [makeLine()],
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.payment_date).toBeDefined();
    }
  });

  it("rejects empty lines array", () => {
    const result = validateCreatePayment(makeHeader(), []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.lines).toBeDefined();
    }
  });

  it("scopes line errors to lines[i].field", () => {
    const result = validateCreatePayment(makeHeader(), [
      makeLine(),
      makeLine({ amount: -5, amount_pen: -5 }),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.["lines[1].amount"]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validatePaymentLine
// ---------------------------------------------------------------------------

describe("validatePaymentLine", () => {
  it("accepts a minimal general line", () => {
    const result = validatePaymentLine(makeLine());
    expect(result.success).toBe(true);
  });

  it("rejects non-positive amount", () => {
    const result = validatePaymentLine(makeLine({ amount: 0 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.amount).toBeDefined();
    }
  });

  it("rejects non-positive amount_pen", () => {
    const result = validatePaymentLine(makeLine({ amount_pen: -1 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.amount_pen).toBeDefined();
    }
  });

  it("rejects a line with two document links set", () => {
    const result = validatePaymentLine(
      makeLine({
        outgoing_invoice_id: "out-1",
        incoming_invoice_id: "in-1",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.outgoing_invoice_id).toBeDefined();
    }
  });

  it("rejects bank_fee line with an invoice link", () => {
    const result = validatePaymentLine(
      makeLine({
        line_type: PAYMENT_LINE_TYPE.bank_fee,
        outgoing_invoice_id: "out-1",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.line_type).toBeDefined();
    }
  });

  it("rejects loan line without loan_id", () => {
    const result = validatePaymentLine(
      makeLine({ line_type: PAYMENT_LINE_TYPE.loan }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.loan_id).toBeDefined();
    }
  });

  it("accepts loan line with loan_id", () => {
    const result = validatePaymentLine(
      makeLine({ line_type: PAYMENT_LINE_TYPE.loan, loan_id: "loan-1" }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects invalid line_type", () => {
    const result = validatePaymentLine(makeLine({ line_type: 99 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.line_type).toBeDefined();
    }
  });

  it("accepts a general line with a cost_category_id", () => {
    const result = validatePaymentLine(
      makeLine({ cost_category_id: "cat-1" }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateBankAccountConsistency
// ---------------------------------------------------------------------------

describe("validateBankAccountConsistency", () => {
  it("accepts a regular account with PEN currency", () => {
    const result = validateBankAccountConsistency(
      makeHeader({ currency: "PEN" }),
      makeBankAccount(),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a regular account with USD currency", () => {
    const result = validateBankAccountConsistency(
      makeHeader({ currency: "USD", exchange_rate: 3.8 }),
      makeBankAccount({ currency: "USD" }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a BN account with PEN currency", () => {
    const result = validateBankAccountConsistency(
      makeHeader({ currency: "PEN" }),
      makeBankAccount({
        account_type: ACCOUNT_TYPE.banco_de_la_nacion,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a BN account with USD currency", () => {
    const result = validateBankAccountConsistency(
      makeHeader({ currency: "USD", exchange_rate: 3.8 }),
      makeBankAccount({
        account_type: ACCOUNT_TYPE.banco_de_la_nacion,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.currency).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validatePaymentInvoiceCurrency
// ---------------------------------------------------------------------------

describe("validatePaymentInvoiceCurrency", () => {
  const regular = ACCOUNT_TYPE.regular;
  const bn = ACCOUNT_TYPE.banco_de_la_nacion;

  it("accepts PEN ↔ PEN", () => {
    expect(
      validatePaymentInvoiceCurrency("PEN", "PEN", false, regular).success,
    ).toBe(true);
  });

  it("accepts USD ↔ USD", () => {
    expect(
      validatePaymentInvoiceCurrency("USD", "USD", false, regular).success,
    ).toBe(true);
  });

  it("rejects PEN ↔ USD on a regular account", () => {
    const result = validatePaymentInvoiceCurrency("PEN", "USD", false, regular);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.currency).toBeDefined();
    }
  });

  it("rejects USD ↔ PEN on a regular account", () => {
    const result = validatePaymentInvoiceCurrency("USD", "PEN", false, regular);
    expect(result.success).toBe(false);
  });

  it("accepts PEN from a BN account with is_detraction=true linked to a USD invoice", () => {
    const result = validatePaymentInvoiceCurrency("PEN", "USD", true, bn);
    expect(result.success).toBe(true);
  });

  it("rejects PEN from a BN account on a USD invoice when is_detraction=false", () => {
    // This combination is not actually reachable at runtime (BN accounts
    // always have is_detraction=true by server derivation), but the
    // validator is pure and we exercise the logic directly.
    const result = validatePaymentInvoiceCurrency("PEN", "USD", false, bn);
    expect(result.success).toBe(false);
  });

  it("rejects PEN from a regular account on a USD invoice even with is_detraction=true", () => {
    // Again not runtime-reachable, but the rule is "must be BN account".
    const result = validatePaymentInvoiceCurrency("PEN", "USD", true, regular);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateSplitSumToOriginal
// ---------------------------------------------------------------------------

describe("validateSplitSumToOriginal", () => {
  it("accepts splits that sum exactly to the original", () => {
    const result = validateSplitSumToOriginal(100, 100, [
      { amount: 60, amount_pen: 60 },
      { amount: 40, amount_pen: 40 },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts splits that sum within tolerance (0.01)", () => {
    const result = validateSplitSumToOriginal(100, 100, [
      { amount: 33.33, amount_pen: 33.33 },
      { amount: 33.33, amount_pen: 33.33 },
      { amount: 33.34, amount_pen: 33.34 },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects empty splits array", () => {
    const result = validateSplitSumToOriginal(100, 100, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.splits).toBeDefined();
    }
  });

  it("rejects splits whose amount sum doesn't match", () => {
    const result = validateSplitSumToOriginal(100, 100, [
      { amount: 60, amount_pen: 60 },
      { amount: 30, amount_pen: 40 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.amount).toBeDefined();
    }
  });

  it("rejects splits whose amount_pen sum doesn't match", () => {
    const result = validateSplitSumToOriginal(100, 380, [
      { amount: 50, amount_pen: 190 },
      { amount: 50, amount_pen: 200 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.amount_pen).toBeDefined();
    }
  });

  it("accepts asymmetric currency splits where amount_pen matches but amounts differ proportionally", () => {
    // USD line $100 at 3.80 = S/380 — splitting 60/40 on the PEN side
    // would be amount_pen 228/152. Corresponding amount splits need not
    // preserve the 60/40 split exactly; the validator just checks sums.
    const result = validateSplitSumToOriginal(100, 380, [
      { amount: 60, amount_pen: 228 },
      { amount: 40, amount_pen: 152 },
    ]);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePaymentMutable
// ---------------------------------------------------------------------------

describe("validatePaymentMutable", () => {
  it("accepts an unreconciled payment", () => {
    const result = validatePaymentMutable(makePaymentRow({ reconciled: false }));
    expect(result.success).toBe(true);
  });

  it("rejects a reconciled payment with CONFLICT", () => {
    const result = validatePaymentMutable(makePaymentRow({ reconciled: true }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.reconciled).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateUpdatePayment
// ---------------------------------------------------------------------------

describe("validateUpdatePayment", () => {
  const existing = makePaymentRow();

  it("accepts a patch with only mutable fields", () => {
    const result = validateUpdatePayment(
      {
        payment_date: "2026-04-12",
        bank_reference: "TRF-00293847",
        title: "Test title",
      },
      existing,
    );
    expect(result.success).toBe(true);
  });

  it("accepts a no-op patch (empty)", () => {
    const result = validateUpdatePayment({}, existing);
    expect(result.success).toBe(true);
  });

  it("rejects changing direction", () => {
    const result = validateUpdatePayment(
      { direction: PAYMENT_DIRECTION.outbound },
      existing,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("IMMUTABLE_FIELD");
      expect(result.error.fields?.direction).toBeDefined();
    }
  });

  it("rejects changing bank_account_id", () => {
    const result = validateUpdatePayment(
      { bank_account_id: "acc-2" },
      existing,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.bank_account_id).toBeDefined();
    }
  });

  it("rejects changing currency", () => {
    const result = validateUpdatePayment({ currency: "USD" }, existing);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.currency).toBeDefined();
    }
  });

  it("rejects changing exchange_rate", () => {
    const result = validateUpdatePayment({ exchange_rate: 3.9 }, existing);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.exchange_rate).toBeDefined();
    }
  });

  it("rejects flipping is_detraction", () => {
    const result = validateUpdatePayment({ is_detraction: true }, existing);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.is_detraction).toBeDefined();
    }
  });

  it("accepts a patch that 'sets' an immutable field to its current value", () => {
    // validateImmutableFields skips the field when the new value equals
    // the existing value — useful for callers that blindly include
    // the full row in the patch.
    const result = validateUpdatePayment(
      {
        direction: existing.direction,
        currency: existing.currency,
        payment_date: "2026-04-12",
      },
      existing,
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateReconcilePayment
// ---------------------------------------------------------------------------

describe("validateReconcilePayment", () => {
  it("accepts an unreconciled payment with a non-empty reference", () => {
    const result = validateReconcilePayment(
      "TRF-20260411-001",
      makePaymentRow({ reconciled: false }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bankReference).toBe("TRF-20260411-001");
    }
  });

  it("trims surrounding whitespace from the bank reference", () => {
    const result = validateReconcilePayment(
      "  TRF-001  ",
      makePaymentRow({ reconciled: false }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bankReference).toBe("TRF-001");
    }
  });

  it("rejects an already-reconciled payment with CONFLICT", () => {
    const result = validateReconcilePayment(
      "TRF-001",
      makePaymentRow({ reconciled: true }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.reconciled).toBeDefined();
    }
  });

  it("rejects a soft-deleted payment with NOT_FOUND", () => {
    const result = validateReconcilePayment(
      "TRF-001",
      makePaymentRow({ deleted_at: "2026-04-11T00:00:00Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("rejects an empty bank reference", () => {
    const result = validateReconcilePayment("", makePaymentRow());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.fields?.bank_reference).toBeDefined();
    }
  });

  it("rejects a whitespace-only bank reference", () => {
    const result = validateReconcilePayment("   ", makePaymentRow());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.fields?.bank_reference).toBeDefined();
    }
  });

  it("rejects a bank reference longer than 100 characters", () => {
    const result = validateReconcilePayment("x".repeat(101), makePaymentRow());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.fields?.bank_reference).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateUnreconcilePayment
// ---------------------------------------------------------------------------

describe("validateUnreconcilePayment", () => {
  it("accepts a reconciled payment", () => {
    const result = validateUnreconcilePayment(
      makePaymentRow({ reconciled: true }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an unreconciled payment with CONFLICT", () => {
    const result = validateUnreconcilePayment(
      makePaymentRow({ reconciled: false }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.reconciled).toBeDefined();
    }
  });

  it("rejects a soft-deleted payment with NOT_FOUND", () => {
    const result = validateUnreconcilePayment(
      makePaymentRow({
        reconciled: true,
        deleted_at: "2026-04-11T00:00:00Z",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
