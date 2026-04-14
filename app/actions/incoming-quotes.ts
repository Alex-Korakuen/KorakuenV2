"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  INCOMING_QUOTE_STATUS,
  INCOMING_INVOICE_FACTURA_STATUS,
  PROJECT_STATUS,
  SOURCE,
} from "@/lib/types";
import type {
  ValidationResult,
  IncomingQuoteRow,
  IncomingQuoteLineItemRow,
  IncomingInvoiceRow,
  IncomingInvoiceLineItemRow,
  ProjectRow,
  LineItemInput,
  CreateIncomingQuoteInput,
  UpdateIncomingQuoteInput,
} from "@/lib/types";
import {
  validateIncomingQuote,
  validateUpdateIncomingQuote,
  assertIncomingQuoteHeaderMutable,
  assertQuoteLineItemsMutable,
} from "@/lib/validators/quotes";
import {
  validateLineItemMath,
  validateDocumentTotals,
} from "@/lib/validators/invoices";
import { assertTransition } from "@/lib/lifecycle";
import {
  computeIncomingInvoicePaymentProgress,
  type IncomingInvoiceComputed,
} from "@/lib/incoming-invoice-computed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IncomingQuoteWithLineItems = IncomingQuoteRow & {
  line_items: IncomingQuoteLineItemRow[];
};

type IncomingQuoteListFilters = {
  project_id?: string;
  contact_id?: string;
  status?: number;
  currency?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedIncomingQuotes = {
  data: IncomingQuoteWithLineItems[];
  total: number;
  limit: number;
  offset: number;
};

// Returned by trackIncomingQuoteAsExpectedInvoice — same shape as a
// getIncomingInvoice response so the UI can refresh the invoice list
// without a second round-trip.
export type TrackedExpectedInvoice = IncomingInvoiceRow & {
  line_items: IncomingInvoiceLineItemRow[];
  _computed: IncomingInvoiceComputed;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
      const scoped: Record<string, string> = {};
      for (const [k, v] of Object.entries(check.error.fields ?? {})) {
        scoped[`line_items[${i}].${k}`] = v;
      }
      return failure(check.error.code, check.error.message, scoped);
    }
  }

  return success(items);
}

/**
 * Recompute header totals (subtotal, igv_amount, total, total_pen) from
 * the current line items. Used after direct inserts in createIncomingQuote;
 * setIncomingQuoteLineItems goes through the atomic RPC instead.
 */
async function recomputeIncomingQuoteTotals(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  quoteId: string,
): Promise<ValidationResult<void>> {
  const { data: quote, error: headerError } = await supabase
    .from("incoming_quotes")
    .select("currency, exchange_rate")
    .eq("id", quoteId)
    .single();

  if (headerError || !quote) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to read quote header: ${headerError?.message ?? "not found"}`,
    );
  }

  const { data: items, error: liError } = await supabase
    .from("incoming_quote_line_items")
    .select("subtotal, igv_amount, total")
    .eq("incoming_quote_id", quoteId);

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to read line items: ${liError.message}`);
  }

  const totals = (items ?? []).reduce(
    (acc, li) => ({
      subtotal: acc.subtotal + Number(li.subtotal),
      igv_amount: acc.igv_amount + Number(li.igv_amount),
      total: acc.total + Number(li.total),
    }),
    { subtotal: 0, igv_amount: 0, total: 0 },
  );

  const total_pen =
    quote.currency === "PEN"
      ? totals.total
      : Math.round(totals.total * Number(quote.exchange_rate ?? 0) * 100) / 100;

  const { error: updateError } = await supabase
    .from("incoming_quotes")
    .update({ ...totals, total_pen, updated_at: nowISO() })
    .eq("id", quoteId);

  if (updateError) {
    return failure("VALIDATION_ERROR", `Failed to update header totals: ${updateError.message}`);
  }

  return success(undefined);
}

async function fetchQuoteWithLineItems(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  id: string,
): Promise<ValidationResult<IncomingQuoteWithLineItems>> {
  const quote = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    id,
  );
  if (!quote) return failure("NOT_FOUND", "Incoming quote not found");

  const { data: lineItems, error: liError } = await supabase
    .from("incoming_quote_line_items")
    .select("*")
    .eq("incoming_quote_id", id)
    .order("sort_order", { ascending: true });

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to fetch line items: ${liError.message}`);
  }

  return success({
    ...quote,
    line_items: (lineItems ?? []) as IncomingQuoteLineItemRow[],
  });
}

/**
 * Generic lifecycle transition helper used by approve and cancel.
 * Approving requires at least one line item and header totals that
 * match the line items — the quote is about to become the contractual
 * basis for an expected invoice, so totals have to be consistent.
 */
async function transitionIncomingQuote(
  id: string,
  toStatus: number,
): Promise<ValidationResult<IncomingQuoteRow>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const quote = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    id,
  );
  if (!quote) return failure("NOT_FOUND", "Incoming quote not found");

  const transitionCheck = assertTransition("incoming_quote", quote.status, toStatus);
  if (!transitionCheck.success) {
    return transitionCheck as ValidationResult<IncomingQuoteRow>;
  }

  if (toStatus === INCOMING_QUOTE_STATUS.approved) {
    const { data: items, error: liError } = await supabase
      .from("incoming_quote_line_items")
      .select("subtotal, igv_amount, total")
      .eq("incoming_quote_id", id);

    if (liError) {
      return failure("VALIDATION_ERROR", `Failed to verify line items: ${liError.message}`);
    }

    if (!items || items.length === 0) {
      return failure(
        "VALIDATION_ERROR",
        "Cannot approve: incoming quote has no line items",
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
      return totalsCheck as ValidationResult<IncomingQuoteRow>;
    }
  }

  const { data: updated, error } = await supabase
    .from("incoming_quotes")
    .update({ status: toStatus, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Transition failed");
  }

  return success(updated as IncomingQuoteRow);
}

// ---------------------------------------------------------------------------
// getIncomingQuotes
// ---------------------------------------------------------------------------

export async function getIncomingQuotes(
  filters?: IncomingQuoteListFilters,
): Promise<ValidationResult<PaginatedIncomingQuotes>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  let query = supabase.from("incoming_quotes").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);
  if (filters?.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters?.status !== undefined) query = query.eq("status", filters.status);
  if (filters?.currency) query = query.eq("currency", filters.currency);

  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) return failure("NOT_FOUND", "Failed to fetch incoming quotes");

  const quotes = (data ?? []) as IncomingQuoteRow[];

  // Batched line-item fetch — one query for all quotes in the page
  const lineItemsByQuote = new Map<string, IncomingQuoteLineItemRow[]>();
  if (quotes.length > 0) {
    const quoteIds = quotes.map((q) => q.id);
    const { data: liRows, error: liError } = await supabase
      .from("incoming_quote_line_items")
      .select("*")
      .in("incoming_quote_id", quoteIds)
      .order("sort_order", { ascending: true });

    if (liError) {
      return failure("NOT_FOUND", "Failed to fetch incoming quote line items");
    }

    for (const li of (liRows ?? []) as IncomingQuoteLineItemRow[]) {
      const bucket = lineItemsByQuote.get(li.incoming_quote_id);
      if (bucket) bucket.push(li);
      else lineItemsByQuote.set(li.incoming_quote_id, [li]);
    }
  }

  const withLineItems: IncomingQuoteWithLineItems[] = quotes.map((q) => ({
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
// getIncomingQuote
// ---------------------------------------------------------------------------

export async function getIncomingQuote(
  id: string,
): Promise<ValidationResult<IncomingQuoteWithLineItems>> {
  await requireUser();
  const supabase = await createServerClient();
  return fetchQuoteWithLineItems(supabase, id);
}

// ---------------------------------------------------------------------------
// createIncomingQuote
// ---------------------------------------------------------------------------

export async function createIncomingQuote(
  data: CreateIncomingQuoteInput,
): Promise<ValidationResult<IncomingQuoteWithLineItems>> {
  await requireAdmin();

  const headerValidation = validateIncomingQuote(data);
  if (!headerValidation.success) {
    return headerValidation as ValidationResult<IncomingQuoteWithLineItems>;
  }

  const lineItems = data.line_items ?? [];
  const liValidation = validateLineItems(lineItems, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<IncomingQuoteWithLineItems>;
  }

  const supabase = await createServerClient();

  // Project is optional (general expenses have no project). When provided,
  // it must exist and be in a state that accepts cost documents.
  if (data.project_id) {
    const project = await fetchActiveById<ProjectRow>(supabase, "projects", data.project_id);
    if (!project) {
      return failure("VALIDATION_ERROR", "El proyecto no existe", {
        project_id: "Project not found",
      });
    }
    if (project.status === PROJECT_STATUS.rejected) {
      return failure("CONFLICT", "No se puede registrar un costo en un proyecto rechazado", {
        project_id: "Project is rejected",
      });
    }
  }

  // Verify contact exists and is flagged as vendor
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, is_vendor")
    .eq("id", data.contact_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) {
    return failure("VALIDATION_ERROR", "El contacto no existe", {
      contact_id: "Contact not found",
    });
  }
  if (!contact.is_vendor) {
    return failure("VALIDATION_ERROR", "El contacto no está marcado como proveedor", {
      contact_id: "Contact is not flagged as vendor",
    });
  }

  // Insert header with zero totals; line items + recompute will fix them
  const insertPayload = {
    project_id: data.project_id ?? null,
    contact_id: data.contact_id,
    partner_id: data.partner_id ?? null,
    status: INCOMING_QUOTE_STATUS.draft,
    description: data.description,
    reference: data.reference ?? null,
    currency: data.currency ?? "PEN",
    exchange_rate: data.exchange_rate ?? null,
    subtotal: 0,
    igv_amount: 0,
    total: 0,
    total_pen: 0,
    detraction_rate: data.detraction_rate ?? null,
    detraction_amount: data.detraction_amount ?? null,
    notes: data.notes ?? null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("incoming_quotes")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to insert incoming quote",
    );
  }

  const insertedQuote = inserted as IncomingQuoteRow;

  if (lineItems.length > 0) {
    const liPayload = lineItems.map((li, idx) => ({
      incoming_quote_id: insertedQuote.id,
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
      .from("incoming_quote_line_items")
      .insert(liPayload);

    if (liError) {
      // Best-effort cleanup: delete the orphan header
      await supabase.from("incoming_quotes").delete().eq("id", insertedQuote.id);
      return failure(
        "VALIDATION_ERROR",
        `Failed to insert line items: ${liError.message}`,
      );
    }

    const recompute = await recomputeIncomingQuoteTotals(supabase, insertedQuote.id);
    if (!recompute.success) {
      return recompute as ValidationResult<IncomingQuoteWithLineItems>;
    }
  }

  return fetchQuoteWithLineItems(supabase, insertedQuote.id);
}

// ---------------------------------------------------------------------------
// updateIncomingQuote
// ---------------------------------------------------------------------------

export async function updateIncomingQuote(
  id: string,
  data: UpdateIncomingQuoteInput,
): Promise<ValidationResult<IncomingQuoteRow>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming quote not found");

  const mutableCheck = assertIncomingQuoteHeaderMutable(existing);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<IncomingQuoteRow>;
  }

  const validation = validateUpdateIncomingQuote(data);
  if (!validation.success) {
    return validation as ValidationResult<IncomingQuoteRow>;
  }

  const { data: updated, error } = await supabase
    .from("incoming_quotes")
    .update({ ...data, updated_at: nowISO() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return failure("VALIDATION_ERROR", error?.message ?? "Update failed");
  }

  // If currency or exchange_rate changed, total_pen may need to be
  // recomputed from the existing line items.
  if ("currency" in data || "exchange_rate" in data) {
    const recompute = await recomputeIncomingQuoteTotals(supabase, id);
    if (!recompute.success) {
      return recompute as ValidationResult<IncomingQuoteRow>;
    }
    const refreshed = await fetchActiveById<IncomingQuoteRow>(
      supabase,
      "incoming_quotes",
      id,
    );
    if (refreshed) return success(refreshed);
  }

  return success(updated as IncomingQuoteRow);
}

// ---------------------------------------------------------------------------
// setIncomingQuoteLineItems — batch replace via RPC
// ---------------------------------------------------------------------------

export async function setIncomingQuoteLineItems(
  id: string,
  items: LineItemInput[],
): Promise<ValidationResult<IncomingQuoteWithLineItems>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming quote not found");

  const mutableCheck = assertQuoteLineItemsMutable(existing.status, "incoming_quote");
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<IncomingQuoteWithLineItems>;
  }

  const liValidation = validateLineItems(items, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<IncomingQuoteWithLineItems>;
  }

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

  const { error } = await supabase.rpc("replace_incoming_quote_line_items", {
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

export async function approveIncomingQuote(
  id: string,
): Promise<ValidationResult<IncomingQuoteRow>> {
  return transitionIncomingQuote(id, INCOMING_QUOTE_STATUS.approved);
}

export async function cancelIncomingQuote(
  id: string,
): Promise<ValidationResult<IncomingQuoteRow>> {
  return transitionIncomingQuote(id, INCOMING_QUOTE_STATUS.cancelled);
}

// ---------------------------------------------------------------------------
// deleteIncomingQuote
// ---------------------------------------------------------------------------

export async function deleteIncomingQuote(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming quote not found");

  if (existing.status !== INCOMING_QUOTE_STATUS.draft) {
    return failure(
      "CONFLICT",
      "Solo se pueden eliminar cotizaciones en borrador. Use Cancelar para cotizaciones ya tramitadas.",
      {
        status: `Incoming quote must be in draft to delete. Current: ${existing.status}`,
      },
    );
  }

  // Block delete if any incoming_invoice already references this quote —
  // dropping the quote would leave the invoice pointing at a dead row.
  const { data: linkedInvoices, error: linkedError } = await supabase
    .from("incoming_invoices")
    .select("id")
    .eq("incoming_quote_id", id)
    .is("deleted_at", null)
    .limit(1);

  if (linkedError) {
    return failure("VALIDATION_ERROR", `Failed to check linked invoices: ${linkedError.message}`);
  }
  if (linkedInvoices && linkedInvoices.length > 0) {
    return failure(
      "CONFLICT",
      "No se puede eliminar una cotización con facturas vinculadas",
      {
        incoming_quote_id:
          "An incoming invoice references this quote. Delete the invoice first or cancel instead.",
      },
    );
  }

  const deletedAt = nowISO();
  const { error } = await supabase
    .from("incoming_quotes")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return success({ id, deleted_at: deletedAt });
}

// ---------------------------------------------------------------------------
// trackIncomingQuoteAsExpectedInvoice — one-click "Track as expected invoice"
// ---------------------------------------------------------------------------

/**
 * Create an `expected` incoming invoice from an approved incoming quote.
 * This is the "Track as expected invoice" one-click action documented in
 * docs/schema-reference.md under the three creation paths for incoming
 * invoices. It:
 *
 *   - Requires the source quote to be in status = approved
 *   - Copies identity (contact, project), currency/exchange_rate, totals,
 *     and detracción fields from the quote
 *   - Sets factura_status = expected, all SUNAT fields NULL
 *   - Links the new invoice back to the source quote via incoming_quote_id
 *   - Clones line items via replace_incoming_invoice_line_items RPC when
 *     the quote has any (cost_category_id on the cloned lines is NULL;
 *     the admin can tag categories later while the invoice stays expected)
 *   - Is idempotent: if a non-deleted expected invoice already exists
 *     against this quote, returns CONFLICT with the existing invoice id
 *     in the fields block so the UI can navigate there
 */
export async function trackIncomingQuoteAsExpectedInvoice(
  quoteId: string,
): Promise<ValidationResult<TrackedExpectedInvoice>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const quote = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    quoteId,
  );
  if (!quote) return failure("NOT_FOUND", "Incoming quote not found");

  if (quote.status !== INCOMING_QUOTE_STATUS.approved) {
    return failure(
      "CONFLICT",
      "Solo se pueden rastrear cotizaciones aprobadas como facturas esperadas",
      {
        status: `Incoming quote must be approved (${INCOMING_QUOTE_STATUS.approved}) to track. Current: ${quote.status}`,
      },
    );
  }

  // Idempotency — if an invoice already exists against this quote, return it
  // as a CONFLICT so the UI can navigate the admin there instead of creating
  // a duplicate.
  const { data: existingLink } = await supabase
    .from("incoming_invoices")
    .select("id")
    .eq("incoming_quote_id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingLink) {
    return failure(
      "CONFLICT",
      "Esta cotización ya tiene una factura esperada vinculada",
      {
        incoming_invoice_id: existingLink.id,
      },
    );
  }

  // Clone the quote into an expected invoice. Carry forward the partner
  // override so the invoice lives under the same consortium member as the
  // quote it came from.
  const insertPayload = {
    project_id: quote.project_id,
    contact_id: quote.contact_id,
    partner_id: quote.partner_id,
    incoming_quote_id: quote.id,
    cost_category_id: null,
    factura_status: INCOMING_INVOICE_FACTURA_STATUS.expected,
    factura_number: null,
    currency: quote.currency,
    exchange_rate: quote.exchange_rate,
    subtotal: quote.subtotal,
    igv_amount: quote.igv_amount,
    total: quote.total,
    total_pen: quote.total_pen,
    detraction_rate: quote.detraction_rate,
    detraction_amount: quote.detraction_amount,
    detraction_handled_by: null,
    // SUNAT fields all null while expected
    serie_numero: null,
    fecha_emision: null,
    tipo_documento_code: null,
    ruc_emisor: null,
    ruc_receptor: null,
    hash_cdr: null,
    estado_sunat: null,
    pdf_url: null,
    xml_url: null,
    drive_file_id: null,
    source: SOURCE.manual,
    notes: quote.notes,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("incoming_invoices")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to create expected invoice",
    );
  }

  const invoice = inserted as IncomingInvoiceRow;

  // Clone line items from the quote if any exist. We go through the RPC
  // so totals recompute atomically (even though they should already
  // match the quote's cached totals, using the RPC avoids drift if
  // there's ever a rounding discrepancy).
  const { data: quoteLines, error: quoteLinesError } = await supabase
    .from("incoming_quote_line_items")
    .select("*")
    .eq("incoming_quote_id", quoteId)
    .order("sort_order", { ascending: true });

  if (quoteLinesError) {
    // Best-effort cleanup
    await supabase.from("incoming_invoices").delete().eq("id", invoice.id);
    return failure(
      "VALIDATION_ERROR",
      `Failed to read quote line items: ${quoteLinesError.message}`,
    );
  }

  if (quoteLines && quoteLines.length > 0) {
    const normalized = (quoteLines as IncomingQuoteLineItemRow[]).map((li, idx) => ({
      sort_order: li.sort_order ?? idx,
      description: li.description,
      unit: li.unit ?? null,
      quantity: li.quantity,
      unit_price: li.unit_price,
      subtotal: li.subtotal,
      igv_applies: li.igv_applies ?? true,
      igv_amount: li.igv_amount,
      total: li.total,
      cost_category_id: null,
      notes: li.notes ?? null,
    }));

    const { error: rpcError } = await supabase.rpc("replace_incoming_invoice_line_items", {
      p_invoice_id: invoice.id,
      p_items: normalized,
    });

    if (rpcError) {
      await supabase.from("incoming_invoices").delete().eq("id", invoice.id);
      return failure(
        "VALIDATION_ERROR",
        `Failed to clone line items: ${rpcError.message}`,
      );
    }
  }

  // Refresh the invoice row (the RPC may have updated the totals/updated_at)
  const refreshed = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    invoice.id,
  );
  if (!refreshed) {
    return failure("VALIDATION_ERROR", "Created invoice could not be re-fetched");
  }

  const { data: invoiceLines, error: invoiceLinesError } = await supabase
    .from("incoming_invoice_line_items")
    .select("*")
    .eq("incoming_invoice_id", invoice.id)
    .order("sort_order", { ascending: true });

  if (invoiceLinesError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to fetch cloned line items: ${invoiceLinesError.message}`,
    );
  }

  const computed = await computeIncomingInvoicePaymentProgress(supabase, refreshed);

  return success({
    ...refreshed,
    line_items: (invoiceLines ?? []) as IncomingInvoiceLineItemRow[],
    _computed: computed,
  });
}
