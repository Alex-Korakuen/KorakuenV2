"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { success, failure } from "@/lib/types";
import type {
  ValidationResult,
  ContactRow,
  CreateContactInput,
} from "@/lib/types";
import {
  validateRuc,
  validateDni,
  validateCreateContact,
  validateUpdateContact,
} from "@/lib/validators/contacts";
import { lookupRuc, lookupDni } from "@/lib/sunat";
import type { LookupResult } from "@/lib/sunat";

// ---------------------------------------------------------------------------
// getContacts
// ---------------------------------------------------------------------------

type ContactListFilters = {
  is_client?: boolean;
  is_vendor?: boolean;
  is_partner?: boolean;
  search?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedContacts = {
  data: ContactRow[];
  total: number;
  limit: number;
  offset: number;
};

export async function getContacts(
  filters?: ContactListFilters,
): Promise<ValidationResult<PaginatedContacts>> {
  await requireUser();

  const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
  const offset = Math.max(filters?.offset ?? 0, 0);

  const supabase = await createServerClient();

  let query = supabase
    .from("contacts")
    .select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }

  if (filters?.is_client) {
    query = query.eq("is_client", true);
  }
  if (filters?.is_vendor) {
    query = query.eq("is_vendor", true);
  }
  if (filters?.is_partner) {
    query = query.eq("is_partner", true);
  }

  if (filters?.search) {
    const sanitized = filters.search.replace(/[.,()]/g, "");
    if (sanitized.trim()) {
      const pattern = `%${sanitized.trim()}%`;
      query = query.or(
        `razon_social.ilike.${pattern},nombre_comercial.ilike.${pattern},ruc.ilike.${pattern},dni.ilike.${pattern}`,
      );
    }
  }

  query = query
    .order("razon_social", { ascending: true })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch contacts");
  }

  return success({
    data: (data ?? []) as ContactRow[],
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// lookupContact
// ---------------------------------------------------------------------------

type LookupContactResult = LookupResult & {
  existing_contact_id?: string;
};

export async function lookupContact(params: {
  ruc?: string;
  dni?: string;
}): Promise<ValidationResult<LookupContactResult>> {
  await requireAdmin();

  if (!params.ruc && !params.dni) {
    return failure("VALIDATION_ERROR", "Either RUC or DNI is required", {
      ruc: "Either RUC or DNI is required",
      dni: "Either RUC or DNI is required",
    });
  }

  if (params.ruc && params.dni) {
    return failure("VALIDATION_ERROR", "Provide either RUC or DNI, not both", {
      ruc: "Provide only one identifier",
      dni: "Provide only one identifier",
    });
  }

  let lookupResult: LookupResult;

  if (params.ruc) {
    const rucValidation = validateRuc(params.ruc);
    if (!rucValidation.success) return rucValidation;

    try {
      lookupResult = await lookupRuc(rucValidation.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al consultar SUNAT";
      return failure("NOT_FOUND", message);
    }
  } else {
    const dniValidation = validateDni(params.dni!);
    if (!dniValidation.success) return dniValidation;

    try {
      lookupResult = await lookupDni(dniValidation.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error al consultar RENIEC";
      return failure("NOT_FOUND", message);
    }
  }

  // Check if a contact with this identifier already exists
  const supabase = await createServerClient();
  const result: LookupContactResult = { ...lookupResult };

  if (lookupResult.ruc) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("ruc", lookupResult.ruc)
      .is("deleted_at", null)
      .maybeSingle();

    if (data) {
      result.existing_contact_id = data.id;
    }
  } else if (lookupResult.dni) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("dni", lookupResult.dni)
      .is("deleted_at", null)
      .maybeSingle();

    if (data) {
      result.existing_contact_id = data.id;
    }
  }

  return success(result);
}

// ---------------------------------------------------------------------------
// createContact
// ---------------------------------------------------------------------------

type CreateContactData = {
  tipo_persona: number;
  ruc?: string | null;
  dni?: string | null;
  razon_social: string;
  nombre_comercial?: string | null;
  is_client?: boolean;
  is_vendor?: boolean;
  is_partner?: boolean;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  sunat_estado?: string | null;
  sunat_condicion?: string | null;
  notes?: string | null;
};

export async function createContact(
  data: CreateContactData,
): Promise<ValidationResult<ContactRow>> {
  await requireAdmin();

  // Server stamps verification — client cannot set these
  const input: CreateContactInput = {
    ...data,
    sunat_verified: true,
    sunat_verified_at: new Date().toISOString(),
  };

  const validation = validateCreateContact(input);
  if (!validation.success) return validation;

  const supabase = await createServerClient();

  // Check for duplicate RUC/DNI among non-deleted contacts
  if (input.ruc) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("ruc", input.ruc)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      return failure("CONFLICT", "Ya existe un contacto con este RUC", {
        ruc: "Duplicate RUC",
      });
    }
  }

  if (input.dni) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("dni", input.dni)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      return failure("CONFLICT", "Ya existe un contacto con este DNI", {
        dni: "Duplicate DNI",
      });
    }
  }

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert(input)
    .select()
    .single();

  if (error) {
    return failure("VALIDATION_ERROR", error.message);
  }

  return success(inserted as ContactRow);
}

// ---------------------------------------------------------------------------
// updateContact
// ---------------------------------------------------------------------------

export async function updateContact(
  id: string,
  data: Record<string, unknown>,
): Promise<ValidationResult<ContactRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  // Fetch existing contact
  const { data: existing, error: fetchError } = await supabase
    .from("contacts")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existing) {
    return failure("NOT_FOUND", "Contact not found");
  }

  const validation = validateUpdateContact(data, existing as ContactRow);
  if (!validation.success) return validation;

  const updateFields = validation.data;

  // If no fields to update, return existing row unchanged
  if (Object.keys(updateFields).length === 0) {
    return success(existing as ContactRow);
  }

  const { data: updated, error: updateError } = await supabase
    .from("contacts")
    .update({ ...updateFields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !updated) {
    return failure("VALIDATION_ERROR", updateError?.message ?? "Update failed");
  }

  return success(updated as ContactRow);
}

// ---------------------------------------------------------------------------
// deleteContact
// ---------------------------------------------------------------------------

export async function deleteContact(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();

  const supabase = await createServerClient();

  // Fetch existing contact
  const { data: existing, error: fetchError } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existing) {
    return failure("NOT_FOUND", "Contact not found");
  }

  // Check all referencing tables for active records in parallel
  const [
    projects,
    projectPartners,
    outgoingQuotes,
    incomingQuotes,
    incomingInvoices,
    payments,
    loans,
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("client_id", id)
      .is("deleted_at", null),
    supabase
      .from("project_partners")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .is("deleted_at", null),
    supabase
      .from("outgoing_quotes")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .is("deleted_at", null),
    supabase
      .from("incoming_quotes")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .is("deleted_at", null),
    supabase
      .from("incoming_invoices")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", id)
      .is("deleted_at", null),
    supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .or(`contact_id.eq.${id},paid_by_partner_id.eq.${id}`)
      .is("deleted_at", null),
    supabase
      .from("loans")
      .select("id", { count: "exact", head: true })
      .or(`borrowing_partner_id.eq.${id},lender_contact_id.eq.${id}`)
      .is("deleted_at", null),
  ]);

  const references: string[] = [];
  if ((projects.count ?? 0) > 0) references.push("projects");
  if ((projectPartners.count ?? 0) > 0) references.push("project partners");
  if ((outgoingQuotes.count ?? 0) > 0) references.push("outgoing quotes");
  if ((incomingQuotes.count ?? 0) > 0) references.push("incoming quotes");
  if ((incomingInvoices.count ?? 0) > 0) references.push("incoming invoices");
  if ((payments.count ?? 0) > 0) references.push("payments");
  if ((loans.count ?? 0) > 0) references.push("loans");

  if (references.length > 0) {
    return failure(
      "CONFLICT",
      `No se puede eliminar este contacto porque tiene ${references.join(", ")} activos`,
      { references: references.join(", ") },
    );
  }

  // Soft delete
  const deletedAt = new Date().toISOString();
  const { error: deleteError } = await supabase
    .from("contacts")
    .update({ deleted_at: deletedAt })
    .eq("id", id);

  if (deleteError) {
    return failure("VALIDATION_ERROR", deleteError.message);
  }

  return success({ id, deleted_at: deletedAt });
}
