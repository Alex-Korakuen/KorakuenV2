"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import { success, failure, PROJECT_STATUS } from "@/lib/types";
import type {
  ValidationResult,
  ProjectRow,
  ProjectPartnerRow,
  CreateProjectInput,
} from "@/lib/types";
import {
  validateCreateProject,
  validateUpdateProject,
  validateProjectActivation,
} from "@/lib/validators/projects";
import { assertTransition } from "@/lib/lifecycle";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectListFilters = {
  status?: number;
  client_id?: string;
  search?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedProjects = {
  data: ProjectRow[];
  total: number;
  limit: number;
  offset: number;
};

type ProjectWithPartners = ProjectRow & {
  partners: ProjectPartnerRow[];
};

// ---------------------------------------------------------------------------
// getProjects
// ---------------------------------------------------------------------------

export async function getProjects(
  filters?: ProjectListFilters,
): Promise<ValidationResult<PaginatedProjects>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);

  const supabase = await createServerClient();

  let query = supabase.from("projects").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }

  if (filters?.status !== undefined) {
    query = query.eq("status", filters.status);
  }
  if (filters?.client_id) {
    query = query.eq("client_id", filters.client_id);
  }
  if (filters?.search) {
    const sanitized = filters.search.replace(/[.,()]/g, "");
    if (sanitized.trim()) {
      const pattern = `%${sanitized.trim()}%`;
      query = query.or(
        `name.ilike.${pattern},code.ilike.${pattern}`,
      );
    }
  }

  query = query
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch projects");
  }

  return success({
    data: (data ?? []) as ProjectRow[],
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// getProject
// ---------------------------------------------------------------------------

export async function getProject(
  id: string,
): Promise<ValidationResult<ProjectWithPartners>> {
  await requireUser();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const { data: partners, error: partnersError } = await supabase
    .from("project_partners")
    .select("*")
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("company_label", { ascending: true });

  if (partnersError) {
    return failure("NOT_FOUND", "Failed to fetch project partners");
  }

  return success({
    ...project,
    partners: (partners ?? []) as ProjectPartnerRow[],
  });
}

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

export async function createProject(
  data: CreateProjectInput,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const validation = validateCreateProject(data);
  if (!validation.success) return validation;

  const supabase = await createServerClient();

  // Verify client exists and is flagged as client
  const { data: client } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", data.client_id)
    .eq("is_client", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!client) {
    return failure("VALIDATION_ERROR", "El cliente no existe o no es un contacto marcado como cliente", {
      client_id: "Client not found or not flagged as client",
    });
  }

  // Check code uniqueness (includes deleted rows — DB UNIQUE is not partial)
  if (data.code?.trim()) {
    const { data: existing } = await supabase
      .from("projects")
      .select("id")
      .eq("code", data.code.trim())
      .maybeSingle();

    if (existing) {
      return failure("CONFLICT", "Ya existe un proyecto con este código", {
        code: "Duplicate code",
      });
    }
  }

  const { data: inserted, error } = await supabase
    .from("projects")
    .insert({ ...data, status: PROJECT_STATUS.prospect })
    .select()
    .single();

  if (error) {
    return failure("VALIDATION_ERROR", error.message);
  }

  return success(inserted as ProjectRow);
}

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

export async function updateProject(
  id: string,
  data: Record<string, unknown>,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const existing = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!existing) {
    return failure("NOT_FOUND", "Project not found");
  }

  if (existing.status === PROJECT_STATUS.archived) {
    return failure("CONFLICT", "No se puede modificar un proyecto archivado", {
      status: "Project is archived",
    });
  }

  // Status cannot be changed directly — use lifecycle actions
  if ("status" in data) {
    return failure("IMMUTABLE_FIELD", "Use lifecycle actions to change project status", {
      status: "Cannot modify status directly",
    });
  }

  const validation = validateUpdateProject(data as Partial<CreateProjectInput>);
  if (!validation.success) return validation as ValidationResult<ProjectRow>;

  const validated = validation.data;

  // Verify new client if client_id is being changed
  if ("client_id" in validated && validated.client_id !== existing.client_id) {
    const { data: client } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", validated.client_id!)
      .eq("is_client", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (!client) {
      return failure("VALIDATION_ERROR", "El cliente no existe o no es un contacto marcado como cliente", {
        client_id: "Client not found or not flagged as client",
      });
    }
  }

  // Check code uniqueness if changed (includes deleted rows)
  if ("code" in validated && validated.code?.trim() && validated.code !== existing.code) {
    const { data: dup } = await supabase
      .from("projects")
      .select("id")
      .eq("code", validated.code.trim())
      .neq("id", id)
      .maybeSingle();

    if (dup) {
      return failure("CONFLICT", "Ya existe un proyecto con este código", {
        code: "Duplicate code",
      });
    }
  }

  // Filter to allowed fields
  const ALLOWED_FIELDS = [
    "name", "code", "client_id", "description", "location",
    "contract_value", "contract_currency", "contract_exchange_rate",
    "igv_included", "billing_frequency", "signed_date", "contract_pdf_url",
    "start_date", "expected_end_date", "actual_end_date", "notes",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in validated) {
      updates[key] = (validated as Record<string, unknown>)[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return success(existing);
  }

  const { data: updated, error: updateError } = await supabase
    .from("projects")
    .update({ ...updates, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !updated) {
    return failure("VALIDATION_ERROR", updateError?.message ?? "Update failed");
  }

  return success(updated as ProjectRow);
}

// ---------------------------------------------------------------------------
// activateProject — prospect → active
// ---------------------------------------------------------------------------

export async function activateProject(
  id: string,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const { data: partners } = await supabase
    .from("project_partners")
    .select("*")
    .eq("project_id", id)
    .is("deleted_at", null);

  const activation = validateProjectActivation(
    project,
    (partners ?? []) as ProjectPartnerRow[],
  );
  if (!activation.success) return activation as ValidationResult<ProjectRow>;

  const { data: updated, error } = await supabase
    .from("projects")
    .update({ status: PROJECT_STATUS.active, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Activation failed");
  }

  return success(updated as ProjectRow);
}

// ---------------------------------------------------------------------------
// completeProject — active → completed
// ---------------------------------------------------------------------------

export async function completeProject(
  id: string,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const transition = assertTransition("project", project.status, PROJECT_STATUS.completed);
  if (!transition.success) return transition as ValidationResult<ProjectRow>;

  const updatePayload: Record<string, unknown> = {
    status: PROJECT_STATUS.completed,
    updated_at: nowISO(),
  };

  // Auto-set actual_end_date if not already set
  if (!project.actual_end_date) {
    updatePayload.actual_end_date = new Date().toISOString().split("T")[0];
  }

  const { data: updated, error } = await supabase
    .from("projects")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Completion failed");
  }

  return success(updated as ProjectRow);
}

// ---------------------------------------------------------------------------
// archiveProject — completed → archived
// ---------------------------------------------------------------------------

export async function archiveProject(
  id: string,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const transition = assertTransition("project", project.status, PROJECT_STATUS.archived);
  if (!transition.success) return transition as ValidationResult<ProjectRow>;

  const { data: updated, error } = await supabase
    .from("projects")
    .update({ status: PROJECT_STATUS.archived, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Archive failed");
  }

  return success(updated as ProjectRow);
}

// ---------------------------------------------------------------------------
// deleteProject — soft delete (prospect only)
// ---------------------------------------------------------------------------

export async function deleteProject(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  if (project.status !== PROJECT_STATUS.prospect) {
    return failure("CONFLICT", "Solo se pueden eliminar proyectos en estado prospecto", {
      status: "Only prospect projects can be deleted",
    });
  }

  // Check all referencing tables in parallel
  let outgoingQuotes, outgoingInvoices, incomingQuotes, incomingInvoices, payments, projectPartners;
  try {
    [
      outgoingQuotes,
      outgoingInvoices,
      incomingQuotes,
      incomingInvoices,
      payments,
      projectPartners,
    ] = await Promise.all([
      supabase
        .from("outgoing_quotes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
      supabase
        .from("outgoing_invoices")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
      supabase
        .from("incoming_quotes")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
      supabase
        .from("incoming_invoices")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
      supabase
        .from("project_partners")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .is("deleted_at", null),
    ]);
  } catch {
    return failure("VALIDATION_ERROR", "No se pudo verificar las referencias del proyecto");
  }

  const references: string[] = [];
  if ((outgoingQuotes.count ?? 0) > 0) references.push("outgoing quotes");
  if ((outgoingInvoices.count ?? 0) > 0) references.push("outgoing invoices");
  if ((incomingQuotes.count ?? 0) > 0) references.push("incoming quotes");
  if ((incomingInvoices.count ?? 0) > 0) references.push("incoming invoices");
  if ((payments.count ?? 0) > 0) references.push("payments");
  if ((projectPartners.count ?? 0) > 0) references.push("project partners");

  if (references.length > 0) {
    return failure(
      "CONFLICT",
      `No se puede eliminar este proyecto porque tiene ${references.join(", ")} activos`,
      { references: references.join(", ") },
    );
  }

  const deletedAt = nowISO();
  const { error: deleteError } = await supabase
    .from("projects")
    .update({ deleted_at: deletedAt })
    .eq("id", id);

  if (deleteError) {
    return failure("VALIDATION_ERROR", deleteError.message);
  }

  return success({ id, deleted_at: deletedAt });
}
