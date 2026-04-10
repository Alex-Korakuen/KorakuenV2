import { describe, it, expect } from "vitest";
import {
  validateCreateProjectBudget,
  validateUpdateProjectBudget,
} from "../project-budgets";
import type {
  CreateProjectBudgetInput,
  UpdateProjectBudgetInput,
  CostCategoryRow,
  ProjectBudgetRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Helpers — minimal valid objects for testing
// ---------------------------------------------------------------------------

function makeCreateInput(
  overrides?: Partial<CreateProjectBudgetInput>,
): CreateProjectBudgetInput {
  return {
    project_id: "00000000-0000-0000-0000-000000000099",
    cost_category_id: "00000000-0000-0000-0000-000000000001",
    budgeted_amount_pen: 15000,
    ...overrides,
  };
}

function makeTopLevelCategory(
  overrides?: Partial<CostCategoryRow>,
): CostCategoryRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    parent_id: null,
    name: "Materiales",
    description: null,
    is_active: true,
    sort_order: 1,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

function makeSubCategory(
  overrides?: Partial<CostCategoryRow>,
): CostCategoryRow {
  return makeTopLevelCategory({
    id: "00000000-0000-0000-0000-000000000050",
    parent_id: "00000000-0000-0000-0000-000000000001",
    name: "Cemento",
    ...overrides,
  });
}

function makeExistingBudget(
  overrides?: Partial<ProjectBudgetRow>,
): ProjectBudgetRow {
  return {
    id: "00000000-0000-0000-0000-000000000200",
    project_id: "00000000-0000-0000-0000-000000000099",
    cost_category_id: "00000000-0000-0000-0000-000000000001",
    budgeted_amount_pen: 10000,
    notes: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateCreateProjectBudget
// ---------------------------------------------------------------------------

describe("validateCreateProjectBudget", () => {
  it("accepts a valid top-level budget with no existing row", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput(),
      makeTopLevelCategory(),
      null,
    );
    expect(result.success).toBe(true);
  });

  it("accepts budgeted_amount_pen = 0 (edge of >= 0 rule)", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ budgeted_amount_pen: 0 }),
      makeTopLevelCategory(),
      null,
    );
    expect(result.success).toBe(true);
  });

  it("rejects missing project_id", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ project_id: "" }),
      makeTopLevelCategory(),
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.project_id).toBeDefined();
    }
  });

  it("rejects missing cost_category_id", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ cost_category_id: "" }),
      null,
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.cost_category_id).toBeDefined();
    }
  });

  it("rejects null budgeted_amount_pen", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ budgeted_amount_pen: null as unknown as number }),
      makeTopLevelCategory(),
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.budgeted_amount_pen).toBeDefined();
    }
  });

  it("rejects negative budgeted_amount_pen", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ budgeted_amount_pen: -1 }),
      makeTopLevelCategory(),
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.budgeted_amount_pen).toContain("greater than or equal to 0");
    }
  });

  it("rejects when cost category is not found", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput(),
      null,
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.cost_category_id).toContain("not found");
    }
  });

  it("rejects sub-categories (parent_id not null)", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ cost_category_id: "00000000-0000-0000-0000-000000000050" }),
      makeSubCategory(),
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.cost_category_id).toContain("top-level");
    }
  });

  it("rejects when a budget row already exists for the pair", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput(),
      makeTopLevelCategory(),
      makeExistingBudget(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.cost_category_id).toContain("already exists");
    }
  });

  it("collects multiple errors at once", () => {
    const result = validateCreateProjectBudget(
      makeCreateInput({ project_id: "", budgeted_amount_pen: -5 }),
      makeSubCategory(),
      null,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.fields!).length).toBeGreaterThanOrEqual(3);
      expect(result.error.fields?.project_id).toBeDefined();
      expect(result.error.fields?.budgeted_amount_pen).toBeDefined();
      expect(result.error.fields?.cost_category_id).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateUpdateProjectBudget
// ---------------------------------------------------------------------------

describe("validateUpdateProjectBudget", () => {
  it("accepts an empty update (no-op)", () => {
    const result = validateUpdateProjectBudget({});
    expect(result.success).toBe(true);
  });

  it("accepts a notes-only update", () => {
    const result = validateUpdateProjectBudget({ notes: "Ajuste Q2" });
    expect(result.success).toBe(true);
  });

  it("accepts a budgeted_amount_pen-only update", () => {
    const result = validateUpdateProjectBudget({ budgeted_amount_pen: 25000 });
    expect(result.success).toBe(true);
  });

  it("accepts budgeted_amount_pen = 0", () => {
    const result = validateUpdateProjectBudget({ budgeted_amount_pen: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects explicit null budgeted_amount_pen", () => {
    const input = {
      budgeted_amount_pen: null as unknown as number,
    } satisfies UpdateProjectBudgetInput;
    const result = validateUpdateProjectBudget(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.budgeted_amount_pen).toContain("Cannot be null");
    }
  });

  it("rejects negative budgeted_amount_pen", () => {
    const result = validateUpdateProjectBudget({ budgeted_amount_pen: -100 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.budgeted_amount_pen).toContain("greater than or equal to 0");
    }
  });
});
