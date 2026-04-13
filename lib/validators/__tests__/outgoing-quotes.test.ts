import { describe, it, expect } from "vitest";
import {
  validateOutgoingQuote,
  validateUpdateOutgoingQuote,
  assertOutgoingQuoteHeaderMutable,
  assertQuoteLineItemsMutable,
  validateWinningQuoteUniqueness,
} from "../quotes";
import { assertTransition, canTransition } from "../../lifecycle";
import { OUTGOING_QUOTE_STATUS } from "../../types";
import type {
  CreateOutgoingQuoteInput,
  UpdateOutgoingQuoteInput,
  OutgoingQuoteRow,
} from "../../types";
import { parseOutgoingQuoteNumber } from "../../outgoing-quote-number";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides?: Partial<CreateOutgoingQuoteInput>,
): CreateOutgoingQuoteInput {
  return {
    project_id: "00000000-0000-0000-0000-000000000001",
    contact_id: "00000000-0000-0000-0000-000000000002",
    issue_date: "2026-04-10",
    currency: "PEN",
    ...overrides,
  };
}

function makeQuote(overrides?: Partial<OutgoingQuoteRow>): OutgoingQuoteRow {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    project_id: "00000000-0000-0000-0000-000000000001",
    contact_id: "00000000-0000-0000-0000-000000000002",
    partner_id: null,
    status: OUTGOING_QUOTE_STATUS.draft,
    quote_number: "COT-2026-0001",
    issue_date: "2026-04-10",
    valid_until: null,
    is_winning_quote: false,
    currency: "PEN",
    subtotal: 0,
    igv_amount: 0,
    total: 0,
    pdf_url: null,
    drive_file_id: null,
    notes: null,
    created_at: "2026-04-10T12:00:00Z",
    updated_at: "2026-04-10T12:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateOutgoingQuote
// ---------------------------------------------------------------------------

describe("validateOutgoingQuote", () => {
  it("accepts a minimal valid input", () => {
    const result = validateOutgoingQuote(makeInput());
    expect(result.success).toBe(true);
  });

  it("rejects missing project_id", () => {
    const result = validateOutgoingQuote(makeInput({ project_id: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.project_id).toBeDefined();
    }
  });

  it("rejects missing contact_id", () => {
    const result = validateOutgoingQuote(makeInput({ contact_id: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contact_id).toBeDefined();
    }
  });

  it("rejects missing issue_date", () => {
    const result = validateOutgoingQuote(makeInput({ issue_date: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.issue_date).toBeDefined();
    }
  });

  it("rejects invalid currency", () => {
    const result = validateOutgoingQuote(makeInput({ currency: "EUR" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.currency).toBeDefined();
    }
  });

  it("accepts USD currency (quotes don't require exchange_rate at create)", () => {
    const result = validateOutgoingQuote(makeInput({ currency: "USD" }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateOutgoingQuote
// ---------------------------------------------------------------------------

describe("validateUpdateOutgoingQuote", () => {
  it("accepts an empty patch", () => {
    const result = validateUpdateOutgoingQuote({});
    expect(result.success).toBe(true);
  });

  it("accepts a contact change", () => {
    const result = validateUpdateOutgoingQuote({ contact_id: "new-id" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid currency change", () => {
    const patch: UpdateOutgoingQuoteInput = { currency: "GBP" };
    const result = validateUpdateOutgoingQuote(patch);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertOutgoingQuoteHeaderMutable
// ---------------------------------------------------------------------------

describe("assertOutgoingQuoteHeaderMutable", () => {
  it("allows mutation on draft", () => {
    const result = assertOutgoingQuoteHeaderMutable(
      makeQuote({ status: OUTGOING_QUOTE_STATUS.draft }),
    );
    expect(result.success).toBe(true);
  });

  it("blocks mutation on sent", () => {
    const result = assertOutgoingQuoteHeaderMutable(
      makeQuote({ status: OUTGOING_QUOTE_STATUS.sent }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("blocks mutation on approved", () => {
    const result = assertOutgoingQuoteHeaderMutable(
      makeQuote({ status: OUTGOING_QUOTE_STATUS.approved }),
    );
    expect(result.success).toBe(false);
  });

  it("blocks mutation on soft-deleted", () => {
    const result = assertOutgoingQuoteHeaderMutable(
      makeQuote({ deleted_at: "2026-04-10T12:00:00Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// assertQuoteLineItemsMutable (outgoing)
// ---------------------------------------------------------------------------

describe("assertQuoteLineItemsMutable for outgoing_quote", () => {
  it("allows line-item mutation on draft", () => {
    const result = assertQuoteLineItemsMutable(
      OUTGOING_QUOTE_STATUS.draft,
      "outgoing_quote",
    );
    expect(result.success).toBe(true);
  });

  it("blocks line-item mutation on sent", () => {
    const result = assertQuoteLineItemsMutable(
      OUTGOING_QUOTE_STATUS.sent,
      "outgoing_quote",
    );
    expect(result.success).toBe(false);
  });

  it("blocks line-item mutation on approved, rejected, expired", () => {
    for (const status of [
      OUTGOING_QUOTE_STATUS.approved,
      OUTGOING_QUOTE_STATUS.rejected,
      OUTGOING_QUOTE_STATUS.expired,
    ]) {
      const result = assertQuoteLineItemsMutable(status, "outgoing_quote");
      expect(result.success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// validateWinningQuoteUniqueness
// ---------------------------------------------------------------------------

describe("validateWinningQuoteUniqueness", () => {
  it("allows flagging when no existing winner", () => {
    const result = validateWinningQuoteUniqueness("new-id", null);
    expect(result.success).toBe(true);
  });

  it("allows updating the existing winner itself", () => {
    const result = validateWinningQuoteUniqueness("same-id", "same-id");
    expect(result.success).toBe(true);
  });

  it("rejects a new winner when another winner exists", () => {
    const result = validateWinningQuoteUniqueness("new-id", "other-id");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("allows flagging when there is no existing winner and the quote is new", () => {
    const result = validateWinningQuoteUniqueness(null, null);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

describe("outgoing_quote lifecycle", () => {
  it("allows draft → sent", () => {
    expect(canTransition("outgoing_quote", 1, 2)).toBe(true);
  });

  it("allows sent → draft (undo)", () => {
    expect(canTransition("outgoing_quote", 2, 1)).toBe(true);
  });

  it("allows sent → approved, rejected, expired", () => {
    expect(canTransition("outgoing_quote", 2, 3)).toBe(true);
    expect(canTransition("outgoing_quote", 2, 4)).toBe(true);
    expect(canTransition("outgoing_quote", 2, 5)).toBe(true);
  });

  it("blocks draft → approved (must go through sent)", () => {
    expect(canTransition("outgoing_quote", 1, 3)).toBe(false);
  });

  it("blocks any transition out of terminal states", () => {
    // approved, rejected, expired have no outgoing transitions
    for (const from of [3, 4, 5]) {
      for (const to of [1, 2, 3, 4, 5]) {
        expect(canTransition("outgoing_quote", from, to)).toBe(false);
      }
    }
  });

  it("assertTransition returns a structured CONFLICT on invalid transition", () => {
    const result = assertTransition("outgoing_quote", 1, 3);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });
});

// ---------------------------------------------------------------------------
// parseOutgoingQuoteNumber
// ---------------------------------------------------------------------------

describe("parseOutgoingQuoteNumber", () => {
  it("parses a canonical number", () => {
    expect(parseOutgoingQuoteNumber("COT-2026-0001")).toEqual({
      year: 2026,
      sequence: 1,
    });
  });

  it("parses a multi-digit sequence", () => {
    expect(parseOutgoingQuoteNumber("COT-2026-9999")).toEqual({
      year: 2026,
      sequence: 9999,
    });
  });

  it("returns null for malformed input", () => {
    expect(parseOutgoingQuoteNumber("cot-2026-1")).toBeNull();
    expect(parseOutgoingQuoteNumber("COT-26-1")).toBeNull();
    expect(parseOutgoingQuoteNumber("COT-2026")).toBeNull();
    expect(parseOutgoingQuoteNumber("")).toBeNull();
  });
});
