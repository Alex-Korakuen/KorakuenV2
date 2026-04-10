import { describe, it, expect } from "vitest";
import { validateProjectPartnerInput } from "../project-partners";
import type { CreateProjectPartnerInput } from "../../types";

function makeInput(
  overrides?: Partial<CreateProjectPartnerInput>,
): CreateProjectPartnerInput {
  return {
    contact_id: "00000000-0000-0000-0000-000000000002",
    company_label: "Korakuen",
    profit_split_pct: 50,
    ...overrides,
  };
}

describe("validateProjectPartnerInput", () => {
  it("accepts a valid input", () => {
    const result = validateProjectPartnerInput(makeInput());
    expect(result.success).toBe(true);
  });

  it("rejects empty contact_id", () => {
    const result = validateProjectPartnerInput(makeInput({ contact_id: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contact_id).toBeDefined();
    }
  });

  it("rejects empty company_label", () => {
    const result = validateProjectPartnerInput(makeInput({ company_label: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.company_label).toBeDefined();
    }
  });

  it("rejects whitespace-only company_label", () => {
    const result = validateProjectPartnerInput(makeInput({ company_label: "   " }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.company_label).toBeDefined();
    }
  });

  it("rejects profit_split_pct of 0", () => {
    const result = validateProjectPartnerInput(makeInput({ profit_split_pct: 0 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toBeDefined();
    }
  });

  it("rejects negative profit_split_pct", () => {
    const result = validateProjectPartnerInput(makeInput({ profit_split_pct: -10 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toBeDefined();
    }
  });

  it("accepts profit_split_pct of exactly 100", () => {
    const result = validateProjectPartnerInput(makeInput({ profit_split_pct: 100 }));
    expect(result.success).toBe(true);
  });

  it("rejects profit_split_pct above 100", () => {
    const result = validateProjectPartnerInput(makeInput({ profit_split_pct: 100.01 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toBeDefined();
    }
  });

  it("rejects null profit_split_pct", () => {
    const result = validateProjectPartnerInput(
      makeInput({ profit_split_pct: null as unknown as number }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toBeDefined();
    }
  });

  it("collects multiple errors at once", () => {
    const result = validateProjectPartnerInput({
      contact_id: "",
      company_label: "",
      profit_split_pct: 150,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.fields!).length).toBe(3);
    }
  });

  it("accepts fractional profit_split_pct", () => {
    const result = validateProjectPartnerInput(
      makeInput({ profit_split_pct: 33.33 }),
    );
    expect(result.success).toBe(true);
  });
});
