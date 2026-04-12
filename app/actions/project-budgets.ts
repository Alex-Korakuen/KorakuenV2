"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { fetchActiveById, nowISO } from "@/lib/db-helpers";
import { success, failure, PROJECT_STATUS } from "@/lib/types";
import type {
  ValidationResult,
  ProjectRow,
  ProjectBudgetRow,
  CostCategoryRow,
  CreateProjectBudgetInput,
} from "@/lib/types";
import {
  validateCreateProjectBudget,
  validateUpdateProjectBudget,
} from "@/lib/validators/project-budgets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategorySummary = Pick<CostCategoryRow, "id" | "name" | "parent_id">;

export type ProjectBudgetWithCategory = ProjectBudgetRow & {
  cost_category: CategorySummary | null;
};

export type ProjectEstimatedCost = {
  project_id: string;
  estimated_cost_pen: number;
  row_count: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadProjectForMutation(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  projectId: string,
): Promise<ValidationResult<ProjectRow>> {
  const project = await fetchActiveById<ProjectRow>(
    supabase,
    "projects",
    projectId,
  );
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  if (project.status === PROJECT_STATUS.archived) {
    return failure(
      "CONFLICT",
      "No se puede modificar el presupuesto de un proyecto archivado",
      { status: "Project is archived" },
    );
  }
  if (project.status === PROJECT_STATUS.completed) {
    return failure(
      "CONFLICT",
      "No se puede modificar el presupuesto de un proyecto completado",
      { status: "Project is completed" },
    );
  }
  if (project.status === PROJECT_STATUS.rejected) {
    return failure(
      "CONFLICT",
      "No se puede modificar el presupuesto de un proyecto rechazado",
      { status: "Project is rejected" },
    );
  }

  return success(project);
}

// ---------------------------------------------------------------------------
// getProjectBudgets
// ---------------------------------------------------------------------------

/**
 * List active budget rows for a project with their cost category joined in.
 */
export async function getProjectBudgets(
  projectId: string,
): Promise<ValidationResult<ProjectBudgetWithCategory[]>> {
  await requireUser();

  const supabase = await createServerClient();

  const project = await fetchActiveById(supabase, "projects", projectId, "id");
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const { data, error } = await supabase
    .from("project_budgets")
    .select("*, cost_category:cost_categories(id, name, parent_id)")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch project budgets");
  }

  return success((data ?? []) as ProjectBudgetWithCategory[]);
}

// ---------------------------------------------------------------------------
// getCostCategories — list all active cost categories
// ---------------------------------------------------------------------------

export async function getCostCategories(): Promise<
  ValidationResult<CostCategoryRow[]>
> {
  await requireUser();

  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("cost_categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch cost categories");
  }

  return success((data ?? []) as CostCategoryRow[]);
}

// ---------------------------------------------------------------------------
// upsertProjectBudget
// ---------------------------------------------------------------------------

/**
 * Create or update a single budget line for a (project, cost_category) pair.
 * Uses the UNIQUE (project_id, cost_category_id) constraint to decide the
 * branch: live row → update, soft-deleted row → restore, nothing → insert.
 */
export async function upsertProjectBudget(
  projectId: string,
  categoryId: string,
  amountPen: number,
  notes?: string | null,
): Promise<ValidationResult<ProjectBudgetRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const projectResult = await loadProjectForMutation(supabase, projectId);
  if (!projectResult.success) {
    return projectResult as ValidationResult<ProjectBudgetRow>;
  }

  // Fetch the cost category (needed for the top-level check in the validator)
  const category = await fetchActiveById<CostCategoryRow>(
    supabase,
    "cost_categories",
    categoryId,
  );
  if (category && category.is_active === false) {
    return failure(
      "VALIDATION_ERROR",
      "La categoría de costo seleccionada está inactiva",
      { cost_category_id: "Cost category is inactive" },
    );
  }

  // Look for any existing row for this (project, category) pair — including
  // soft-deleted rows, because UNIQUE (project_id, cost_category_id) is not
  // partial, so a soft-deleted row still blocks a fresh insert.
  const { data: existingRow } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
    .eq("cost_category_id", categoryId)
    .maybeSingle();

  const existingLive = existingRow && !existingRow.deleted_at ? existingRow : null;

  // UPDATE path — live row exists
  if (existingLive) {
    const updateInput = {
      budgeted_amount_pen: amountPen,
      notes: notes ?? null,
    };
    const validation = validateUpdateProjectBudget(updateInput);
    if (!validation.success) {
      return validation as ValidationResult<ProjectBudgetRow>;
    }

    const { data: updated, error: updateError } = await supabase
      .from("project_budgets")
      .update({ ...updateInput, updated_at: nowISO() })
      .eq("id", existingLive.id)
      .select()
      .single();

    if (updateError || !updated) {
      return failure("VALIDATION_ERROR", updateError?.message ?? "Update failed");
    }

    return success(updated as ProjectBudgetRow);
  }

  // INSERT / RESTORE path — no live row. Validate as a create; pass
  // existingBudget = null because the branch decision is already made and
  // the validator's duplicate guard would reject the restore otherwise.
  const createInput: CreateProjectBudgetInput = {
    project_id: projectId,
    cost_category_id: categoryId,
    budgeted_amount_pen: amountPen,
    notes: notes ?? null,
  };
  const validation = validateCreateProjectBudget(createInput, category, null);
  if (!validation.success) {
    return validation as ValidationResult<ProjectBudgetRow>;
  }

  // RESTORE path — a soft-deleted row already exists for the pair
  if (existingRow) {
    const { data: restored, error: restoreError } = await supabase
      .from("project_budgets")
      .update({
        budgeted_amount_pen: amountPen,
        notes: notes ?? null,
        deleted_at: null,
        updated_at: nowISO(),
      })
      .eq("id", existingRow.id)
      .select()
      .single();

    if (restoreError || !restored) {
      return failure(
        "VALIDATION_ERROR",
        restoreError?.message ?? "Restore failed",
      );
    }

    return success(restored as ProjectBudgetRow);
  }

  // INSERT path — clean create
  const { data: inserted, error: insertError } = await supabase
    .from("project_budgets")
    .insert(createInput)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure("VALIDATION_ERROR", insertError?.message ?? "Insert failed");
  }

  return success(inserted as ProjectBudgetRow);
}

// ---------------------------------------------------------------------------
// removeProjectBudget
// ---------------------------------------------------------------------------

/**
 * Soft-delete the budget row for a (project, cost_category) pair.
 */
export async function removeProjectBudget(
  projectId: string,
  categoryId: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const projectResult = await loadProjectForMutation(supabase, projectId);
  if (!projectResult.success) {
    return projectResult as ValidationResult<{ id: string; deleted_at: string }>;
  }

  const { data: budget } = await supabase
    .from("project_budgets")
    .select("id")
    .eq("project_id", projectId)
    .eq("cost_category_id", categoryId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!budget) {
    return failure("NOT_FOUND", "Budget row not found for this project and category");
  }

  const deletedAt = nowISO();
  const { error: deleteError } = await supabase
    .from("project_budgets")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", budget.id);

  if (deleteError) {
    return failure("VALIDATION_ERROR", deleteError.message);
  }

  return success({ id: budget.id, deleted_at: deletedAt });
}

// ---------------------------------------------------------------------------
// getEstimatedCost
// ---------------------------------------------------------------------------

/**
 * Derive the project's estimated cost as the sum of active budget rows.
 * Used by the project summary endpoint in Step 12 to compute expected margin.
 * Returns 0 when the project has no budget rows — callers should treat the
 * absence of a budget as "no estimate available" rather than "zero cost."
 */
export async function getEstimatedCost(
  projectId: string,
): Promise<ValidationResult<ProjectEstimatedCost>> {
  await requireUser();

  const supabase = await createServerClient();

  const project = await fetchActiveById(supabase, "projects", projectId, "id");
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const { data, error } = await supabase
    .from("project_budgets")
    .select("budgeted_amount_pen")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch project budgets");
  }

  const rows = (data ?? []) as Pick<ProjectBudgetRow, "budgeted_amount_pen">[];
  const estimated = rows.reduce((acc, r) => acc + Number(r.budgeted_amount_pen), 0);

  return success({
    project_id: projectId,
    estimated_cost_pen: estimated,
    row_count: rows.length,
  });
}
