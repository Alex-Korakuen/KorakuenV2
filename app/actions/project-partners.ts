"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { fetchActiveById, nowISO } from "@/lib/db-helpers";
import { success, failure, PROJECT_STATUS } from "@/lib/types";
import type {
  ValidationResult,
  ProjectRow,
  ProjectPartnerRow,
  CreateProjectPartnerInput,
} from "@/lib/types";
import { validateProjectPartnerInput } from "@/lib/validators/project-partners";

// ---------------------------------------------------------------------------
// getProjectPartners
// ---------------------------------------------------------------------------

export async function getProjectPartners(
  projectId: string,
): Promise<ValidationResult<ProjectPartnerRow[]>> {
  await requireUser();

  const supabase = await createServerClient();

  const project = await fetchActiveById(supabase, "projects", projectId, "id");
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const { data, error } = await supabase
    .from("project_partners")
    .select("*")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("company_label", { ascending: true });

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch project partners");
  }

  return success((data ?? []) as ProjectPartnerRow[]);
}

// ---------------------------------------------------------------------------
// upsertProjectPartner
// ---------------------------------------------------------------------------

export async function upsertProjectPartner(
  projectId: string,
  data: CreateProjectPartnerInput,
): Promise<ValidationResult<ProjectPartnerRow>> {
  await requireAdmin();

  const inputValidation = validateProjectPartnerInput(data);
  if (!inputValidation.success) {
    return inputValidation as ValidationResult<ProjectPartnerRow>;
  }

  const supabase = await createServerClient();

  // Verify project exists and is not archived
  const project = await fetchActiveById<ProjectRow>(supabase, "projects", projectId);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  if (project.status === PROJECT_STATUS.archived) {
    return failure("CONFLICT", "No se pueden modificar los socios de un proyecto archivado", {
      status: "Project is archived",
    });
  }

  // Partners are frozen once a project is active. The settlement formula
  // depends on the 100%-sum invariant, and any change after expenses start
  // flowing would silently corrupt partner payouts. Splits must be finalized
  // during the prospect phase, before activation.
  if (project.status === PROJECT_STATUS.active) {
    return failure(
      "CONFLICT",
      "No se pueden modificar los socios de un proyecto activo. Los repartos quedan fijos al activar el proyecto.",
      { status: "Partners are frozen after project activation" },
    );
  }
  if (project.status === PROJECT_STATUS.completed) {
    return failure(
      "CONFLICT",
      "No se pueden modificar los socios de un proyecto completado",
      { status: "Project is completed" },
    );
  }

  // Verify contact exists and is flagged as partner
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", data.contact_id)
    .eq("is_partner", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (!contact) {
    return failure("VALIDATION_ERROR", "El contacto no existe o no está marcado como socio", {
      contact_id: "Contact not found or not flagged as partner",
    });
  }

  // Check if a row already exists for this project+contact (including soft-deleted)
  // The UNIQUE(project_id, contact_id) is not partial, so we must handle deleted rows
  const { data: existingRow } = await supabase
    .from("project_partners")
    .select("*")
    .eq("project_id", projectId)
    .eq("contact_id", data.contact_id)
    .maybeSingle();

  const trimmedLabel = data.company_label.trim();

  if (existingRow) {
    // Row exists — update (or restore if soft-deleted)
    const updatePayload: Record<string, unknown> = {
      company_label: trimmedLabel,
      profit_split_pct: data.profit_split_pct,
      updated_at: nowISO(),
    };

    // Restore if soft-deleted
    if (existingRow.deleted_at) {
      updatePayload.deleted_at = null;
    }

    const { data: updated, error: updateError } = await supabase
      .from("project_partners")
      .update(updatePayload)
      .eq("id", existingRow.id)
      .select()
      .single();

    if (updateError || !updated) {
      return failure("VALIDATION_ERROR", updateError?.message ?? "Update failed");
    }

    return success(updated as ProjectPartnerRow);
  }

  // No existing row — insert
  const { data: inserted, error: insertError } = await supabase
    .from("project_partners")
    .insert({
      project_id: projectId,
      contact_id: data.contact_id,
      company_label: trimmedLabel,
      profit_split_pct: data.profit_split_pct,
    })
    .select()
    .single();

  if (insertError) {
    return failure("VALIDATION_ERROR", insertError.message);
  }

  return success(inserted as ProjectPartnerRow);
}

// ---------------------------------------------------------------------------
// removeProjectPartner
// ---------------------------------------------------------------------------

export async function removeProjectPartner(
  projectId: string,
  partnerId: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();

  const supabase = await createServerClient();

  // Verify project exists
  const project = await fetchActiveById<ProjectRow>(supabase, "projects", projectId, "id, status");
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  // Partners are frozen once a project leaves prospect status. Removal is only
  // allowed during the prospect phase, before activation.
  if (project.status === PROJECT_STATUS.active) {
    return failure(
      "CONFLICT",
      "No se pueden eliminar socios de un proyecto activo. Los repartos quedan fijos al activar el proyecto.",
      { status: "Partners are frozen after project activation" },
    );
  }
  if (project.status === PROJECT_STATUS.completed) {
    return failure("CONFLICT", "No se pueden eliminar socios de un proyecto completado", {
      status: "Project is completed",
    });
  }
  if (project.status === PROJECT_STATUS.archived) {
    return failure("CONFLICT", "No se pueden eliminar socios de un proyecto archivado", {
      status: "Project is archived",
    });
  }

  // Fetch partner row (must belong to this project and not be deleted)
  const { data: partner, error: partnerError } = await supabase
    .from("project_partners")
    .select("id")
    .eq("id", partnerId)
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (partnerError || !partner) {
    return failure("NOT_FOUND", "Partner not found on this project");
  }

  const deletedAt = nowISO();
  const { error: deleteError } = await supabase
    .from("project_partners")
    .update({ deleted_at: deletedAt })
    .eq("id", partnerId);

  if (deleteError) {
    return failure("VALIDATION_ERROR", deleteError.message);
  }

  return success({ id: partnerId, deleted_at: deletedAt });
}
