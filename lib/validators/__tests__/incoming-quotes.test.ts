import { describe, it, expect } from "vitest";
import {
  validateIncomingQuote,
  validateUpdateIncomingQuote,
  assertIncomingQuoteHeaderMutable,
} from "../quotes";
import { INCOMING_QUOTE_STATUS } from "../../types";
import type {
  CreateIncomingQuoteInput,
  UpdateIncomingQuoteInput,
  IncomingQuoteRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidCreate(
  overrides?: Partial<CreateIncomingQuoteInput>,
): CreateIncomingQuoteInput {
  return {
    contact_id: "11111111-1111-1111-1111-111111111111",
    description: "Materiales para obra",
    currency: "PEN",
    ...overrides,
  };
}

function makeQuoteRow(
  overrides?: Partial<IncomingQuoteRow>,
): Pick<IncomingQuoteRow, "status" | "deleted_at"> {
  return {
    status: INCOMING_QUOTE_STATUS.draft,
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateIncomingQuote
// ---------------------------------------------------------------------------

describe("validateIncomingQuote", () => {
  it("accepts a valid PEN quote with description and contact", () => {
    const result = validateIncomingQuote(makeValidCreate());
    expect(result.success).toBe(true);
  });

  it("rejects missing contact_id", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ contact_id: "" as unknown as string }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contact_id).toBeDefined();
    }
  });

  it("rejects empty description", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ description: "   " }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.description).toBeDefined();
    }
  });

  it("rejects USD without exchange_rate", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ currency: "USD" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.exchange_rate).toBeDefined();
    }
  });

  it("accepts USD with exchange_rate", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ currency: "USD", exchange_rate: 3.75 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects detraction_rate without detraction_amount", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ detraction_rate: 0.04 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.fields?.detraction_rate ??
          result.error.fields?.detraction_amount,
      ).toBeDefined();
    }
  });

  it("accepts detraction_rate with detraction_amount", () => {
    const result = validateIncomingQuote(
      makeValidCreate({ detraction_rate: 0.04, detraction_amount: 40 }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateIncomingQuote
// ---------------------------------------------------------------------------

describe("validateUpdateIncomingQuote", () => {
  it("accepts an empty patch", () => {
    const result = validateUpdateIncomingQuote({});
    expect(result.success).toBe(true);
  });

  it("accepts a notes-only patch", () => {
    const result = validateUpdateIncomingQuote({ notes: "Revisado" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty description in the patch", () => {
    const result = validateUpdateIncomingQuote({ description: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.description).toBeDefined();
    }
  });

  it("rejects USD without exchange_rate in the patch", () => {
    const result = validateUpdateIncomingQuote({ currency: "USD" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.exchange_rate).toBeDefined();
    }
  });

  it("accepts switching to USD with a rate provided", () => {
    const result = validateUpdateIncomingQuote({
      currency: "USD",
      exchange_rate: 3.8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects mismatched detraction fields", () => {
    const patch: UpdateIncomingQuoteInput = {
      detraction_rate: 0.04,
      detraction_amount: null,
    };
    const result = validateUpdateIncomingQuote(patch);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertIncomingQuoteHeaderMutable
// ---------------------------------------------------------------------------

describe("assertIncomingQuoteHeaderMutable", () => {
  it("accepts a draft quote", () => {
    const result = assertIncomingQuoteHeaderMutable(makeQuoteRow());
    expect(result.success).toBe(true);
  });

  it("rejects an approved quote with CONFLICT", () => {
    const result = assertIncomingQuoteHeaderMutable(
      makeQuoteRow({ status: INCOMING_QUOTE_STATUS.approved }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.status).toBeDefined();
    }
  });

  it("rejects a cancelled quote with CONFLICT", () => {
    const result = assertIncomingQuoteHeaderMutable(
      makeQuoteRow({ status: INCOMING_QUOTE_STATUS.cancelled }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("rejects a soft-deleted quote with NOT_FOUND", () => {
    const result = assertIncomingQuoteHeaderMutable(
      makeQuoteRow({ deleted_at: "2026-04-10T12:00:00Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
