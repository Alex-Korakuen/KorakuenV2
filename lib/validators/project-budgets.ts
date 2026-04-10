import { success, failure } from "@/lib/types";
import type {
  ValidationResult,
  CreateProjectBudgetInput,
  UpdateProjectBudgetInput,
  CostCategoryRow,
  ProjectBudgetRow,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Project budget validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating a project budget row.
 *
 * Phase 1 rule: the referenced cost_category must be top-level
 * (`parent_id IS NULL`). Enforced in the validator — not the DB — so the
 * rule can be relaxed later without a migration.
 *
 * Callers must pre-fetch the cost_category row and any existing budget
 * row for the same (project_id, cost_category_id) pair and pass them in.
 */
export function validateCreateProjectBudget(
  data: CreateProjectBudgetInput,
  costCategory: CostCategoryRow | null,
  existingBudget: ProjectBudgetRow | null,
): ValidationResult<CreateProjectBudgetInput> {
  const fields: Record<string, string> = {};

  if (!data.project_id) fields.project_id = "Required";
  if (!data.cost_category_id) fields.cost_category_id = "Required";

  if (data.budgeted_amount_pen == null) {
    fields.budgeted_amount_pen = "Required";
  } else if (data.budgeted_amount_pen < 0) {
    fields.budgeted_amount_pen = "Must be greater than or equal to 0";
  }

  if (data.cost_category_id) {
    if (!costCategory) {
      fields.cost_category_id = "Cost category not found";
    } else if (costCategory.parent_id !== null) {
      fields.cost_category_id =
        "Must be a top-level cost category (sub-categories not allowed in Phase 1)";
    }
  }

  if (existingBudget) {
    fields.cost_category_id =
      "A budget row already exists for this project and cost category";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Project budget validation failed", fields);
  }

  return success(data);
}

/**
 * Validate a partial update to a project budget row. Only
 * `budgeted_amount_pen` and `notes` are editable; project and
 * cost_category are set once at creation.
 */
export function validateUpdateProjectBudget(
  data: UpdateProjectBudgetInput,
): ValidationResult<UpdateProjectBudgetInput> {
  const fields: Record<string, string> = {};

  if ("budgeted_amount_pen" in data) {
    if (data.budgeted_amount_pen == null) {
      fields.budgeted_amount_pen = "Cannot be null";
    } else if (data.budgeted_amount_pen < 0) {
      fields.budgeted_amount_pen = "Must be greater than or equal to 0";
    }
  }

  if (Object.keys(fields).length > 0) {
    return failure(
      "VALIDATION_ERROR",
      "Project budget update validation failed",
      fields,
    );
  }

  return success(data);
}
