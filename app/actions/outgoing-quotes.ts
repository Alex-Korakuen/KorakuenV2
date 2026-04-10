"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  OUTGOING_QUOTE_STATUS,
  PROJECT_STATUS,
} from "@/lib/types";
import type {
  ValidationResult,
  OutgoingQuoteRow,
  OutgoingQuoteLineItemRow,
  ProjectRow,
  LineItemInput,
  CreateOutgoingQuoteInput,
  UpdateOutgoingQuoteInput,
} from "@/lib/types";
import {
  validateOutgoingQuote,
  validateUpdateOutgoingQuote,
  assertOutgoingQuoteHeaderMutable,
  assertQuoteLineItemsMutable,
  validateWinningQuoteUniqueness,
} from "@/lib/validators/quotes";
import {
  validateLineItemMath,
  validateDocumentTotals,
} from "@/lib/validators/invoices";
import { assertTransition } from "@/lib/lifecycle";
import { generateNextOutgoingQuoteNumber } from "@/lib/outgoing-quote-number";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutgoingQuoteWithLineItems = OutgoingQuoteRow & {
  line_items: OutgoingQuoteLineItemRow[];
};

type OutgoingQuoteListFilters = {
  project_id?: string;
  contact_id?: string;
  status?: number;
  is_winning?: boolean;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedOutgoingQuotes = {
  data: OutgoingQuoteWithLineItems[];
  total: number;
  limit: number;
  offset: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate that every line item's math checks out and that the list is
 * non-empty when required. Returns the validated list or a ValidationResult
 * failure.
 */
function validateLineItems(
  items: LineItemInput[],
  { requireNonEmpty }: { requireNonEmpty: boolean },
): ValidationResult<LineItemInput[]> {
  if (requireNonEmpty && items.length === 0) {
    return failure("VALIDATION_ERROR", "At least one line item is required", {
      line_items: "Empty line item list",
    });
  }

  for (let i = 0; i < items.length; i++) {
    const check = validateLineItemMath(items[i]);
    if (!check.success) {
      const existingFields = check.error.fields ?? {};
      const scoped: Record<string, string> = {};
      for (const [k, v] of Object.entries(existingFields)) {
        scoped[`line_items[${i}].${k}`] = v;
      }
      return failure(check.error.code, check.error.message, scoped);
    }
  }

  return success(items);
}

/**
 * Recompute the header totals (subtotal, igv_amount, total) from the
 * current active line items. Used after single-entity inserts during
 * createOutgoingQuote; setOutgoingQuoteLineItems uses the batch-replace
 * RPC which recomputes atomically.
 */
async function recomputeOutgoingQuoteTotals(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  quoteId: string,
): Promise<ValidationResult<void>> {
  const { data: items, error } = await supabase
    .from("outgoing_quote_line_items")
    .select("subtotal, igv_amount, total")
    .eq("outgoing_quote_id", quoteId);

  if (error) {
    return failure("VALIDATION_ERROR", `Failed to read line items: ${error.message}`);
  }

  const totals = (items ?? []).reduce(
    (acc, li) => ({
      subtotal: acc.subtotal + Number(li.subtotal),
      igv_amount: acc.igv_amount + Number(li.igv_amount),
      total: acc.total + Number(li.total),
    }),
    { subtotal: 0, igv_amount: 0, total: 0 },
  );

  const { error: updateError } = await supabase
    .from("outgoing_quotes")
    .update({ ...totals, updated_at: nowISO() })
    .eq("id", quoteId);

  if (updateError) {
    return failure("VALIDATION_ERROR", `Failed to update header totals: ${updateError.message}`);
  }

  return success(undefined);
}

/**
 * Fetch a quote row plus its line items. Returns NOT_FOUND if the quote
 * is missing or soft-deleted.
 */
async function fetchQuoteWithLineItems(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  id: string,
): Promise<ValidationResult<OutgoingQuoteWithLineItems>> {
  const quote = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!quote) {
    return failure("NOT_FOUND", "Outgoing quote not found");
  }

  const { data: lineItems, error: liError } = await supabase
    .from("outgoing_quote_line_items")
    .select("*")
    .eq("outgoing_quote_id", id)
    .order("sort_order", { ascending: true });

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to fetch line items: ${liError.message}`);
  }

  return success({
    ...quote,
    line_items: (lineItems ?? []) as OutgoingQuoteLineItemRow[],
  });
}

/**
 * Generic lifecycle transition helper. Loads the quote, runs the
 * transition validator, updates the status.
 */
async function transitionOutgoingQuote(
  id: string,
  toStatus: number,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const quote = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!quote) return failure("NOT_FOUND", "Outgoing quote not found");

  const transitionCheck = assertTransition("outgoing_quote", quote.status, toStatus);
  if (!transitionCheck.success) {
    return transitionCheck as ValidationResult<OutgoingQuoteRow>;
  }

  // Mark-as-sent requires ≥1 line item and header totals matching line items.
  if (toStatus === OUTGOING_QUOTE_STATUS.sent) {
    const { data: items, error: liError } = await supabase
      .from("outgoing_quote_line_items")
      .select("subtotal, igv_amount, total")
      .eq("outgoing_quote_id", id);

    if (liError) {
      return failure("VALIDATION_ERROR", `Failed to verify line items: ${liError.message}`);
    }

    if (!items || items.length === 0) {
      return failure(
        "VALIDATION_ERROR",
        "Cannot mark as sent: outgoing quote has no line items",
        { line_items: "At least one line item is required" },
      );
    }

    const totalsCheck = validateDocumentTotals(
      { subtotal: quote.subtotal, igv_amount: quote.igv_amount, total: quote.total },
      items.map((li) => ({
        description: "",
        quantity: 0,
        unit_price: 0,
        subtotal: Number(li.subtotal),
        igv_amount: Number(li.igv_amount),
        total: Number(li.total),
      })),
    );
    if (!totalsCheck.success) {
      return totalsCheck as ValidationResult<OutgoingQuoteRow>;
    }
  }

  const { data: updated, error } = await supabase
    .from("outgoing_quotes")
    .update({ status: toStatus, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Transition failed");
  }

  return success(updated as OutgoingQuoteRow);
}

// ---------------------------------------------------------------------------
// getOutgoingQuotes
// ---------------------------------------------------------------------------

export async function getOutgoingQuotes(
  filters?: OutgoingQuoteListFilters,
): Promise<ValidationResult<PaginatedOutgoingQuotes>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  let query = supabase.from("outgoing_quotes").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);
  if (filters?.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters?.status !== undefined) query = query.eq("status", filters.status);
  if (filters?.is_winning !== undefined) {
    query = query.eq("is_winning_quote", filters.is_winning);
  }

  query = query
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch outgoing quotes");
  }

  const quotes = (data ?? []) as OutgoingQuoteRow[];

  // Batched line-item fetch — one query for all quotes in the page
  const lineItemsByQuote = new Map<string, OutgoingQuoteLineItemRow[]>();
  if (quotes.length > 0) {
    const quoteIds = quotes.map((q) => q.id);
    const { data: liRows, error: liError } = await supabase
      .from("outgoing_quote_line_items")
      .select("*")
      .in("outgoing_quote_id", quoteIds)
      .order("sort_order", { ascending: true });

    if (liError) {
      return failure("NOT_FOUND", "Failed to fetch outgoing quote line items");
    }

    for (const li of (liRows ?? []) as OutgoingQuoteLineItemRow[]) {
      const bucket = lineItemsByQuote.get(li.outgoing_quote_id);
      if (bucket) bucket.push(li);
      else lineItemsByQuote.set(li.outgoing_quote_id, [li]);
    }
  }

  const withLineItems: OutgoingQuoteWithLineItems[] = quotes.map((q) => ({
    ...q,
    line_items: lineItemsByQuote.get(q.id) ?? [],
  }));

  return success({
    data: withLineItems,
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// getOutgoingQuote
// ---------------------------------------------------------------------------

export async function getOutgoingQuote(
  id: string,
): Promise<ValidationResult<OutgoingQuoteWithLineItems>> {
  await requireUser();
  const supabase = await createServerClient();
  return fetchQuoteWithLineItems(supabase, id);
}

// ---------------------------------------------------------------------------
// createOutgoingQuote
// ---------------------------------------------------------------------------

export async function createOutgoingQuote(
  data: CreateOutgoingQuoteInput,
): Promise<ValidationResult<OutgoingQuoteWithLineItems>> {
  await requireAdmin();

  const headerValidation = validateOutgoingQuote(data);
  if (!headerValidation.success) {
    return headerValidation as ValidationResult<OutgoingQuoteWithLineItems>;
  }

  const lineItems = data.line_items ?? [];
  const liValidation = validateLineItems(lineItems, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<OutgoingQuoteWithLineItems>;
  }

  const supabase = await createServerClient();

  // Verify project exists and is in a state that accepts new quotes
  const project = await fetchActiveById<ProjectRow>(supabase, "projects", data.project_id);
  if (!project) {
    return failure("VALIDATION_ERROR", "El proyecto no existe", {
      project_id: "Project not found",
    });
  }
  if (project.status === PROJECT_STATUS.archived) {
    return failure("CONFLICT", "No se puede crear una cotización en un proyecto archivado", {
      project_id: "Project is archived",
    });
  }
  if (project.status === PROJECT_STATUS.rejected) {
    return failure("CONFLICT", "No se puede crear una cotización en un proyecto rechazado", {
      project_id: "Project is rejected",
    });
  }

  // Verify contact exists and is flagged as client
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, is_client")
    .eq("id", data.contact_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) {
    return failure("VALIDATION_ERROR", "El contacto no existe", {
      contact_id: "Contact not found",
    });
  }
  if (!contact.is_client) {
    return failure("VALIDATION_ERROR", "El contacto no está marcado como cliente", {
      contact_id: "Contact is not flagged as client",
    });
  }

  // Winning-quote uniqueness — if this quote is being flagged as winning,
  // make sure no other winning quote exists on the same project.
  if (data.is_winning_quote) {
    const { data: existingWinner } = await supabase
      .from("outgoing_quotes")
      .select("id")
      .eq("project_id", data.project_id)
      .eq("is_winning_quote", true)
      .is("deleted_at", null)
      .maybeSingle();
    const uniquenessCheck = validateWinningQuoteUniqueness(
      null,
      existingWinner?.id ?? null,
    );
    if (!uniquenessCheck.success) {
      return uniquenessCheck as ValidationResult<OutgoingQuoteWithLineItems>;
    }
  }

  // Auto-generate quote number if not supplied
  const quoteNumber =
    data.quote_number?.trim() ||
    (await generateNextOutgoingQuoteNumber(supabase));

  // Insert header with zero totals; line items + recompute will fix them.
  const insertPayload = {
    project_id: data.project_id,
    contact_id: data.contact_id,
    quote_number: quoteNumber,
    issue_date: data.issue_date,
    valid_until: data.valid_until ?? null,
    is_winning_quote: data.is_winning_quote ?? false,
    currency: data.currency ?? "PEN",
    notes: data.notes ?? null,
    status: OUTGOING_QUOTE_STATUS.draft,
    subtotal: 0,
    igv_amount: 0,
    total: 0,
  };

  // Retry-once on quote_number UNIQUE collision
  let inserted: OutgoingQuoteRow | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error } = await supabase
      .from("outgoing_quotes")
      .insert(
        attempt === 0
          ? insertPayload
          : {
              ...insertPayload,
              quote_number: await generateNextOutgoingQuoteNumber(supabase),
            },
      )
      .select()
      .single();

    if (!error && row) {
      inserted = row as OutgoingQuoteRow;
      break;
    }
    if (error && error.code === "23505" && attempt === 0) {
      continue; // UNIQUE violation on quote_number — retry once with a fresh number
    }
    return failure(
      "VALIDATION_ERROR",
      error?.message ?? "Failed to insert outgoing quote",
    );
  }
  if (!inserted) {
    return failure(
      "CONFLICT",
      "Could not generate a unique quote number after retry",
    );
  }

  // Insert line items (if any) and recompute totals
  if (lineItems.length > 0) {
    const liPayload = lineItems.map((li, idx) => ({
      outgoing_quote_id: inserted!.id,
      sort_order: li.sort_order ?? idx,
      description: li.description,
      unit: li.unit ?? null,
      quantity: li.quantity,
      unit_price: li.unit_price,
      subtotal: li.subtotal,
      igv_applies: li.igv_applies ?? true,
      igv_amount: li.igv_amount,
      total: li.total,
      notes: li.notes ?? null,
    }));

    const { error: liError } = await supabase
      .from("outgoing_quote_line_items")
      .insert(liPayload);

    if (liError) {
      // Best-effort cleanup: delete the orphan header
      await supabase.from("outgoing_quotes").delete().eq("id", inserted.id);
      return failure(
        "VALIDATION_ERROR",
        `Failed to insert line items: ${liError.message}`,
      );
    }

    const recompute = await recomputeOutgoingQuoteTotals(supabase, inserted.id);
    if (!recompute.success) {
      return recompute as ValidationResult<OutgoingQuoteWithLineItems>;
    }
  }

  return fetchQuoteWithLineItems(supabase, inserted.id);
}

// ---------------------------------------------------------------------------
// updateOutgoingQuote
// ---------------------------------------------------------------------------

export async function updateOutgoingQuote(
  id: string,
  data: UpdateOutgoingQuoteInput,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing quote not found");

  const mutableCheck = assertOutgoingQuoteHeaderMutable(existing);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<OutgoingQuoteRow>;
  }

  const validation = validateUpdateOutgoingQuote(data);
  if (!validation.success) {
    return validation as ValidationResult<OutgoingQuoteRow>;
  }

  const { data: updated, error } = await supabase
    .from("outgoing_quotes")
    .update({ ...data, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Update failed");
  }

  return success(updated as OutgoingQuoteRow);
}

// ---------------------------------------------------------------------------
// setOutgoingQuoteLineItems — batch replace via RPC
// ---------------------------------------------------------------------------

export async function setOutgoingQuoteLineItems(
  id: string,
  items: LineItemInput[],
): Promise<ValidationResult<OutgoingQuoteWithLineItems>> {
  await requireAdmin();
  const supabase = await createServerClient();

  // Pre-flight: verify quote exists and is mutable (the RPC will also check,
  // but failing early gives a cleaner error message)
  const existing = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing quote not found");

  const mutableCheck = assertQuoteLineItemsMutable(existing.status, "outgoing_quote");
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<OutgoingQuoteWithLineItems>;
  }

  const liValidation = validateLineItems(items, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<OutgoingQuoteWithLineItems>;
  }

  // Normalize payload for the RPC (JSONB expects canonical keys)
  const normalized = items.map((li, idx) => ({
    sort_order: li.sort_order ?? idx,
    description: li.description,
    unit: li.unit ?? null,
    quantity: li.quantity,
    unit_price: li.unit_price,
    subtotal: li.subtotal,
    igv_applies: li.igv_applies ?? true,
    igv_amount: li.igv_amount,
    total: li.total,
    notes: li.notes ?? null,
  }));

  const { error } = await supabase.rpc("replace_outgoing_quote_line_items", {
    p_quote_id: id,
    p_items: normalized,
  });

  if (error) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to replace line items: ${error.message}`,
    );
  }

  return fetchQuoteWithLineItems(supabase, id);
}

// ---------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------

export async function markOutgoingQuoteAsSent(
  id: string,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  return transitionOutgoingQuote(id, OUTGOING_QUOTE_STATUS.sent);
}

export async function unsendOutgoingQuote(
  id: string,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  return transitionOutgoingQuote(id, OUTGOING_QUOTE_STATUS.draft);
}

export async function approveOutgoingQuote(
  id: string,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  return transitionOutgoingQuote(id, OUTGOING_QUOTE_STATUS.approved);
}

export async function rejectOutgoingQuote(
  id: string,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  return transitionOutgoingQuote(id, OUTGOING_QUOTE_STATUS.rejected);
}

export async function expireOutgoingQuote(
  id: string,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  return transitionOutgoingQuote(id, OUTGOING_QUOTE_STATUS.expired);
}

// ---------------------------------------------------------------------------
// setWinningQuote
// ---------------------------------------------------------------------------

export async function setWinningQuote(
  id: string,
  isWinning: boolean,
): Promise<ValidationResult<OutgoingQuoteRow>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing quote not found");

  // Unflagging is always allowed and unconditional
  if (!isWinning) {
    if (!existing.is_winning_quote) return success(existing);
    const { data: updated, error } = await supabase
      .from("outgoing_quotes")
      .update({ is_winning_quote: false, updated_at: nowISO() })
      .eq("id", id)
      .select()
      .single();
    if (error || !updated) {
      return failure("VALIDATION_ERROR", error?.message ?? "Update failed");
    }
    return success(updated as OutgoingQuoteRow);
  }

  // Flagging as winning — auto-unset any existing winner on the same project
  if (existing.is_winning_quote) return success(existing);

  const { data: priorWinner } = await supabase
    .from("outgoing_quotes")
    .select("id")
    .eq("project_id", existing.project_id)
    .eq("is_winning_quote", true)
    .is("deleted_at", null)
    .neq("id", id)
    .maybeSingle();

  if (priorWinner) {
    const { error: unflag } = await supabase
      .from("outgoing_quotes")
      .update({ is_winning_quote: false, updated_at: nowISO() })
      .eq("id", priorWinner.id);
    if (unflag) {
      return failure(
        "VALIDATION_ERROR",
        `Failed to unset prior winning quote: ${unflag.message}`,
      );
    }
  }

  const { data: updated, error } = await supabase
    .from("outgoing_quotes")
    .update({ is_winning_quote: true, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Update failed");
  }

  return success(updated as OutgoingQuoteRow);
}

// ---------------------------------------------------------------------------
// deleteOutgoingQuote
// ---------------------------------------------------------------------------

export async function deleteOutgoingQuote(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingQuoteRow>(
    supabase,
    "outgoing_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing quote not found");

  if (existing.status !== OUTGOING_QUOTE_STATUS.draft) {
    return failure(
      "CONFLICT",
      "Solo se pueden eliminar cotizaciones en borrador. Use los estados finales (rechazada, expirada) para cotizaciones enviadas.",
      {
        status: `Outgoing quote must be in draft to delete. Current: ${existing.status}`,
      },
    );
  }

  const deletedAt = nowISO();
  const { error } = await supabase
    .from("outgoing_quotes")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", id);

  if (error) {
    return failure("VALIDATION_ERROR", error.message);
  }

  return success({ id, deleted_at: deletedAt });
}
