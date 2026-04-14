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
  UpdateProjectInput,
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

type ProjectWithPartners = ProjectRow & {
  partners: ProjectPartnerRow[];
};

type PaginatedProjects = {
  data: ProjectWithPartners[];
  total: number;
  limit: number;
  offset: number;
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

  const projects = (data ?? []) as ProjectRow[];

  // Batched partner fetch — one query for all projects in the page
  const partnersByProject = new Map<string, ProjectPartnerRow[]>();
  if (projects.length > 0) {
    const projectIds = projects.map((p) => p.id);
    const { data: partnerRows, error: partnersError } = await supabase
      .from("project_partners")
      .select("*")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .order("company_label", { ascending: true });

    if (partnersError) {
      return failure("NOT_FOUND", "Failed to fetch project partners");
    }

    for (const partner of (partnerRows ?? []) as ProjectPartnerRow[]) {
      const bucket = partnersByProject.get(partner.project_id);
      if (bucket) {
        bucket.push(partner);
      } else {
        partnersByProject.set(partner.project_id, [partner]);
      }
    }
  }

  const projectsWithPartners: ProjectWithPartners[] = projects.map((p) => ({
    ...p,
    partners: partnersByProject.get(p.id) ?? [],
  }));

  return success({
    data: projectsWithPartners,
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

  // Auto-set signed_date to today if not provided. The UI doesn't surface
  // this field (Alex's workflow doesn't care about contract sign date
  // separately), but the activation validator requires it.
  const today = new Date().toISOString().split("T")[0];
  const payload = {
    ...data,
    status: PROJECT_STATUS.prospect,
    signed_date: data.signed_date ?? today,
  };

  const { data: inserted, error } = await supabase
    .from("projects")
    .insert(payload)
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
  data: UpdateProjectInput,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const existing = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!existing) {
    return failure("NOT_FOUND", "Project not found");
  }

  // Status cannot be changed directly — use lifecycle actions
  if ("status" in data) {
    return failure("IMMUTABLE_FIELD", "Use lifecycle actions to change project status", {
      status: "Cannot modify status directly",
    });
  }

  const validation = validateUpdateProject(data);
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

  // Filter to allowed fields (code is system-generated, immutable after insert)
  const ALLOWED_FIELDS = [
    "name", "client_id", "description", "location",
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
// rejectProject — prospect/active → rejected
// ---------------------------------------------------------------------------

export async function rejectProject(
  id: string,
): Promise<ValidationResult<ProjectRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const project = await fetchActiveById<ProjectRow>(supabase, "projects", id);
  if (!project) {
    return failure("NOT_FOUND", "Project not found");
  }

  const transition = assertTransition(
    "project",
    project.status,
    PROJECT_STATUS.rejected,
  );
  if (!transition.success) return transition as ValidationResult<ProjectRow>;

  const { data: updated, error } = await supabase
    .from("projects")
    .update({ status: PROJECT_STATUS.rejected, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Rejection failed");
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

// ---------------------------------------------------------------------------
// getProjectHistorial — chronological mix of invoices and payments
// ---------------------------------------------------------------------------

export type ProjectHistorialItem = {
  type: "emitida" | "recibida" | "pago_in" | "pago_out";
  id: string;
  date: string;
  description: string;
  detail: string | null;
  amount_pen: number;
  status_label: string;
};

export async function getProjectHistorial(
  projectId: string,
): Promise<ValidationResult<ProjectHistorialItem[]>> {
  await requireUser();

  const supabase = await createServerClient();
  const items: ProjectHistorialItem[] = [];

  // Outgoing invoices for this project
  const { data: outgoing } = await supabase
    .from("outgoing_invoices")
    .select("id, serie_numero, period_start, total_pen, status")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  // Incoming invoices for this project
  const { data: incoming } = await supabase
    .from("incoming_invoices")
    .select(
      "id, contact_id, serie_numero, factura_status, total_pen, created_at",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);

  // Vendor names for incoming invoices
  const vendorIds = [
    ...new Set((incoming ?? []).map((i) => i.contact_id).filter(Boolean) as string[]),
  ];
  let vendorMap = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data } = await supabase
      .from("contacts")
      .select("id, razon_social")
      .in("id", vendorIds);
    vendorMap = new Map((data ?? []).map((c) => [c.id, c.razon_social]));
  }

  // Payment progress maps
  const outgoingIds = (outgoing ?? []).map((i) => i.id);
  const incomingIds = (incoming ?? []).map((i) => i.id);
  const allInvoiceIds = [...outgoingIds, ...incomingIds];

  const paidOutMap: Record<string, number> = {};
  const paidInMap: Record<string, number> = {};

  if (allInvoiceIds.length > 0) {
    const { data: lines } = await supabase
      .from("payment_lines")
      .select("outgoing_invoice_id, incoming_invoice_id, amount_pen")
      .or(
        `outgoing_invoice_id.in.(${outgoingIds.length ? outgoingIds.join(",") : "00000000-0000-0000-0000-000000000000"}),incoming_invoice_id.in.(${incomingIds.length ? incomingIds.join(",") : "00000000-0000-0000-0000-000000000000"})`,
      );

    for (const pl of lines ?? []) {
      const amt = Math.abs(Number(pl.amount_pen));
      if (pl.outgoing_invoice_id) {
        paidOutMap[pl.outgoing_invoice_id] =
          (paidOutMap[pl.outgoing_invoice_id] ?? 0) + amt;
      }
      if (pl.incoming_invoice_id) {
        paidInMap[pl.incoming_invoice_id] =
          (paidInMap[pl.incoming_invoice_id] ?? 0) + amt;
      }
    }
  }

  for (const inv of outgoing ?? []) {
    const total = Number(inv.total_pen);
    const paid = paidOutMap[inv.id] ?? 0;
    const statusLabel =
      paid >= total - 0.01
        ? "Cobrado"
        : paid > 0
          ? "Parcial"
          : inv.status === 1
            ? "Borrador"
            : "Pendiente";
    items.push({
      type: "emitida",
      id: inv.id,
      date: inv.period_start,
      description: inv.serie_numero ?? "Sin número",
      detail: null,
      amount_pen: total,
      status_label: statusLabel,
    });
  }

  for (const inv of incoming ?? []) {
    const total = Number(inv.total_pen);
    const paid = paidInMap[inv.id] ?? 0;
    const statusLabel =
      paid >= total - 0.01
        ? "Pagado"
        : paid > 0
          ? "Parcial"
          : inv.factura_status === 1
            ? "Esperada"
            : "Pendiente";
    items.push({
      type: "recibida",
      id: inv.id,
      date: (inv.created_at as string).split("T")[0],
      description: inv.serie_numero ?? "Sin número",
      detail: vendorMap.get(inv.contact_id) ?? null,
      amount_pen: total,
      status_label: statusLabel,
    });
  }

  // Payments associated with this project
  const { data: payments } = await supabase
    .from("payments")
    .select("id, direction, total_amount_pen, payment_date, bank_reference, reconciled")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  for (const p of payments ?? []) {
    const isInbound = p.direction === 1;
    items.push({
      type: isInbound ? "pago_in" : "pago_out",
      id: p.id,
      date: p.payment_date,
      description: p.bank_reference ?? (isInbound ? "Pago recibido" : "Pago realizado"),
      detail: null,
      amount_pen: Number(p.total_amount_pen),
      status_label: p.reconciled ? "Conciliado" : "Sin conciliar",
    });
  }

  items.sort((a, b) => b.date.localeCompare(a.date));

  return success(items);
}
