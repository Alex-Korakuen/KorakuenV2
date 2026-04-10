import { describe, it, expect } from "vitest";
import {
  validateCreateProject,
  validateUpdateProject,
  validateProfitSplits,
  validateProjectActivation,
} from "../projects";
import { assertTransition, canTransition, getValidTransitions } from "../../lifecycle";
import { PROJECT_STATUS } from "../../types";
import type {
  CreateProjectInput,
  ProjectRow,
  ProjectPartnerRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Helpers — minimal valid objects for testing
// ---------------------------------------------------------------------------

function makeProjectInput(overrides?: Partial<CreateProjectInput>): CreateProjectInput {
  return {
    name: "Obra Lima Norte",
    client_id: "00000000-0000-0000-0000-000000000001",
    ...overrides,
  };
}

function makeProject(overrides?: Partial<ProjectRow>): ProjectRow {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    name: "Obra Lima Norte",
    code: "PRY001",
    status: PROJECT_STATUS.prospect,
    client_id: "00000000-0000-0000-0000-000000000001",
    description: null,
    location: null,
    contract_value: 500000,
    contract_currency: "PEN",
    contract_exchange_rate: null,
    igv_included: true,
    billing_frequency: 3,
    signed_date: "2026-03-01",
    contract_pdf_url: null,
    start_date: null,
    expected_end_date: null,
    actual_end_date: null,
    notes: null,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function makePartner(overrides?: Partial<ProjectPartnerRow>): ProjectPartnerRow {
  return {
    id: "00000000-0000-0000-0000-000000000010",
    project_id: "00000000-0000-0000-0000-000000000099",
    contact_id: "00000000-0000-0000-0000-000000000002",
    company_label: "Korakuen",
    profit_split_pct: 50,
    created_at: "2026-03-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCreateProject
// ---------------------------------------------------------------------------

describe("validateCreateProject", () => {
  it("accepts valid input with minimal fields", () => {
    const result = validateCreateProject(makeProjectInput());
    expect(result.success).toBe(true);
  });

  it("accepts valid input with all optional fields", () => {
    const result = validateCreateProject(
      makeProjectInput({
        code: "PRY001",
        description: "Big project",
        location: "Lima",
        contract_value: 100000,
        contract_currency: "PEN",
        igv_included: false,
        billing_frequency: 3,
        signed_date: "2026-04-01",
        notes: "Important",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = validateCreateProject(makeProjectInput({ name: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.name).toBeDefined();
    }
  });

  it("rejects whitespace-only name", () => {
    const result = validateCreateProject(makeProjectInput({ name: "   " }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.name).toBeDefined();
    }
  });

  it("rejects missing client_id", () => {
    const result = validateCreateProject(makeProjectInput({ client_id: "" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.client_id).toBeDefined();
    }
  });

  it("rejects invalid currency", () => {
    const result = validateCreateProject(
      makeProjectInput({ contract_currency: "EUR" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_currency).toBeDefined();
    }
  });

  it("accepts USD with exchange rate when contract_value is set", () => {
    const result = validateCreateProject(
      makeProjectInput({
        contract_currency: "USD",
        contract_exchange_rate: 3.75,
        contract_value: 50000,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects USD without exchange rate when contract_value is set", () => {
    const result = validateCreateProject(
      makeProjectInput({
        contract_currency: "USD",
        contract_exchange_rate: null,
        contract_value: 50000,
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_exchange_rate).toBeDefined();
    }
  });

  it("accepts PEN without exchange rate", () => {
    const result = validateCreateProject(
      makeProjectInput({ contract_currency: "PEN" }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateProject
// ---------------------------------------------------------------------------

describe("validateUpdateProject", () => {
  it("accepts valid partial update", () => {
    const result = validateUpdateProject({ name: "New name", location: "Cusco" });
    expect(result.success).toBe(true);
  });

  it("accepts empty update (no fields)", () => {
    const result = validateUpdateProject({});
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateUpdateProject({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.name).toBeDefined();
    }
  });

  it("rejects invalid currency", () => {
    const result = validateUpdateProject({ contract_currency: "GBP" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_currency).toBeDefined();
    }
  });

  it("accepts valid currency change to USD", () => {
    const result = validateUpdateProject({ contract_currency: "USD" });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateProfitSplits
// ---------------------------------------------------------------------------

describe("validateProfitSplits", () => {
  it("accepts splits summing to exactly 100", () => {
    const partners = [
      makePartner({ profit_split_pct: 50 }),
      makePartner({ profit_split_pct: 50, contact_id: "00000000-0000-0000-0000-000000000003" }),
    ];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(true);
  });

  it("accepts three-way split summing to 100", () => {
    const partners = [
      makePartner({ profit_split_pct: 33.33 }),
      makePartner({ profit_split_pct: 33.34, contact_id: "00000000-0000-0000-0000-000000000003" }),
      makePartner({ profit_split_pct: 33.33, contact_id: "00000000-0000-0000-0000-000000000004" }),
    ];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(true);
  });

  it("accepts single partner at 100%", () => {
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(true);
  });

  it("rejects splits summing to less than 100", () => {
    const partners = [
      makePartner({ profit_split_pct: 40 }),
      makePartner({ profit_split_pct: 40, contact_id: "00000000-0000-0000-0000-000000000003" }),
    ];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toContain("80.00%");
    }
  });

  it("rejects splits summing to more than 100", () => {
    const partners = [
      makePartner({ profit_split_pct: 60 }),
      makePartner({ profit_split_pct: 60, contact_id: "00000000-0000-0000-0000-000000000003" }),
    ];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toContain("120.00%");
    }
  });

  it("rejects empty partners array", () => {
    const result = validateProfitSplits([]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.partners).toBeDefined();
    }
  });

  it("accepts within tolerance (99.995 rounds close enough)", () => {
    // tolerance is 0.01, so 99.995 is within 0.005 of 100
    const partners = [
      makePartner({ profit_split_pct: 33.33 }),
      makePartner({ profit_split_pct: 33.33, contact_id: "00000000-0000-0000-0000-000000000003" }),
      makePartner({ profit_split_pct: 33.335, contact_id: "00000000-0000-0000-0000-000000000004" }),
    ];
    const result = validateProfitSplits(partners);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateProjectActivation
// ---------------------------------------------------------------------------

describe("validateProjectActivation", () => {
  it("accepts a fully valid prospect project with partners summing to 100%", () => {
    const project = makeProject({ status: PROJECT_STATUS.prospect });
    const partners = [
      makePartner({ profit_split_pct: 60 }),
      makePartner({ profit_split_pct: 40, contact_id: "00000000-0000-0000-0000-000000000003" }),
    ];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(true);
  });

  it("rejects activation of non-prospect project", () => {
    const project = makeProject({ status: PROJECT_STATUS.active });
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("rejects when contract_value is missing", () => {
    const project = makeProject({
      status: PROJECT_STATUS.prospect,
      contract_value: null,
    });
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_value).toBeDefined();
    }
  });

  it("rejects when signed_date is missing", () => {
    const project = makeProject({
      status: PROJECT_STATUS.prospect,
      signed_date: null,
    });
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.signed_date).toBeDefined();
    }
  });

  it("rejects when contract_currency is missing", () => {
    const project = makeProject({
      status: PROJECT_STATUS.prospect,
      contract_currency: "",
    });
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_currency).toBeDefined();
    }
  });

  it("rejects USD without exchange rate", () => {
    const project = makeProject({
      status: PROJECT_STATUS.prospect,
      contract_currency: "USD",
      contract_exchange_rate: null,
    });
    const partners = [makePartner({ profit_split_pct: 100 })];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.contract_exchange_rate).toBeDefined();
    }
  });

  it("rejects when no partners assigned", () => {
    const project = makeProject({ status: PROJECT_STATUS.prospect });
    const result = validateProjectActivation(project, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.partners).toBeDefined();
    }
  });

  it("rejects when partner splits don't sum to 100%", () => {
    const project = makeProject({ status: PROJECT_STATUS.prospect });
    const partners = [
      makePartner({ profit_split_pct: 30 }),
      makePartner({ profit_split_pct: 30, contact_id: "00000000-0000-0000-0000-000000000003" }),
    ];
    const result = validateProjectActivation(project, partners);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.profit_split_pct).toBeDefined();
    }
  });

  it("collects multiple errors at once", () => {
    const project = makeProject({
      status: PROJECT_STATUS.prospect,
      contract_value: null,
      signed_date: null,
    });
    const result = validateProjectActivation(project, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should have errors for contract_value, signed_date, and partners
      expect(Object.keys(result.error.fields!).length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Lifecycle — assertTransition & canTransition for projects
// ---------------------------------------------------------------------------

describe("project lifecycle transitions", () => {
  describe("canTransition", () => {
    it("allows prospect → active", () => {
      expect(canTransition("project", PROJECT_STATUS.prospect, PROJECT_STATUS.active)).toBe(true);
    });

    it("allows active → completed", () => {
      expect(canTransition("project", PROJECT_STATUS.active, PROJECT_STATUS.completed)).toBe(true);
    });

    it("allows completed → archived", () => {
      expect(canTransition("project", PROJECT_STATUS.completed, PROJECT_STATUS.archived)).toBe(true);
    });

    it("rejects prospect → completed (skip)", () => {
      expect(canTransition("project", PROJECT_STATUS.prospect, PROJECT_STATUS.completed)).toBe(false);
    });

    it("rejects prospect → archived (skip)", () => {
      expect(canTransition("project", PROJECT_STATUS.prospect, PROJECT_STATUS.archived)).toBe(false);
    });

    it("rejects active → prospect (backward)", () => {
      expect(canTransition("project", PROJECT_STATUS.active, PROJECT_STATUS.prospect)).toBe(false);
    });

    it("rejects completed → active (backward)", () => {
      expect(canTransition("project", PROJECT_STATUS.completed, PROJECT_STATUS.active)).toBe(false);
    });

    it("rejects archived → anything (terminal)", () => {
      expect(canTransition("project", PROJECT_STATUS.archived, PROJECT_STATUS.prospect)).toBe(false);
      expect(canTransition("project", PROJECT_STATUS.archived, PROJECT_STATUS.active)).toBe(false);
      expect(canTransition("project", PROJECT_STATUS.archived, PROJECT_STATUS.completed)).toBe(false);
    });
  });

  describe("assertTransition", () => {
    it("returns success for valid transition", () => {
      const result = assertTransition("project", PROJECT_STATUS.prospect, PROJECT_STATUS.active);
      expect(result.success).toBe(true);
    });

    it("returns CONFLICT error for invalid transition", () => {
      const result = assertTransition("project", PROJECT_STATUS.prospect, PROJECT_STATUS.completed);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("CONFLICT");
        expect(result.error.fields?.status).toBeDefined();
      }
    });

    it("includes valid options in error message for invalid transition", () => {
      const result = assertTransition("project", PROJECT_STATUS.active, PROJECT_STATUS.prospect);
      expect(result.success).toBe(false);
      if (!result.success) {
        // Should mention completed as the valid option from active
        expect(result.error.fields?.status).toContain("completed");
      }
    });

    it("indicates no transitions for terminal state", () => {
      const result = assertTransition("project", PROJECT_STATUS.archived, PROJECT_STATUS.active);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fields?.status).toContain("No transitions");
      }
    });
  });

  describe("getValidTransitions", () => {
    it("returns [active] from prospect", () => {
      expect(getValidTransitions("project", PROJECT_STATUS.prospect)).toEqual([PROJECT_STATUS.active]);
    });

    it("returns [completed] from active", () => {
      expect(getValidTransitions("project", PROJECT_STATUS.active)).toEqual([PROJECT_STATUS.completed]);
    });

    it("returns [archived] from completed", () => {
      expect(getValidTransitions("project", PROJECT_STATUS.completed)).toEqual([PROJECT_STATUS.archived]);
    });

    it("returns [] from archived", () => {
      expect(getValidTransitions("project", PROJECT_STATUS.archived)).toEqual([]);
    });
  });
});
