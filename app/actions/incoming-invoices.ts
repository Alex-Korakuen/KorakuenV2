"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  INCOMING_INVOICE_FACTURA_STATUS,
  INCOMING_QUOTE_STATUS,
  PROJECT_STATUS,
  SOURCE,
} from "@/lib/types";
import type {
  ValidationResult,
  IncomingInvoiceRow,
  IncomingInvoiceLineItemRow,
  IncomingInvoiceLineItemInput,
  IncomingQuoteRow,
  ProjectRow,
  ContactRow,
  CreateIncomingInvoiceInput,
  UpdateIncomingInvoiceInput,
  SunatFieldsInput,
} from "@/lib/types";
import {
  validateIncomingInvoice,
  validateSunatFields,
  validateIncomingInvoiceHeaderUpdate,
  assertIncomingInvoiceDeletable,
  assertLineItemsMutable,
  validateLineItemMath,
} from "@/lib/validators/invoices";
import { validateFacturaStatusTransition } from "@/lib/validators/incoming-invoices";
import { requireExactExchangeRate } from "@/lib/exchange-rate";
import {
  computeIncomingInvoicePaymentProgress,
  computeIncomingInvoicePaymentProgressBatch,
  type IncomingInvoiceComputed,
} from "@/lib/incoming-invoice-computed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IncomingInvoiceWithComputed = IncomingInvoiceRow & {
  line_items: IncomingInvoiceLineItemRow[];
  _computed: IncomingInvoiceComputed;
};

type IncomingInvoiceListFilters = {
  project_id?: string;
  contact_id?: string;
  factura_status?: number;
  currency?: string;
  incoming_quote_id?: string;
  /**
   * Chase list filter. When true, returns only expected invoices that
   * already have at least one payment line against them — the "who do I
   * need to nag for factura paperwork" view.
   */
  needs_factura?: boolean;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedIncomingInvoices = {
  data: IncomingInvoiceWithComputed[];
  total: number;
  limit: number;
  offset: number;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateLineItems(
  items: IncomingInvoiceLineItemInput[],
  { requireNonEmpty }: { requireNonEmpty: boolean },
): ValidationResult<IncomingInvoiceLineItemInput[]> {
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
 * Recompute header totals from the current line items. Only callable
 * while the invoice is expected; received invoices are frozen.
 */
async function recomputeIncomingInvoiceTotals(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  invoiceId: string,
): Promise<ValidationResult<void>> {
  const { data: invoice, error: headerError } = await supabase
    .from("incoming_invoices")
    .select("currency, exchange_rate")
    .eq("id", invoiceId)
    .single();

  if (headerError || !invoice) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to read invoice header: ${headerError?.message ?? "not found"}`,
    );
  }

  const { data: items, error: liError } = await supabase
    .from("incoming_invoice_line_items")
    .select("subtotal, igv_amount, total")
    .eq("incoming_invoice_id", invoiceId);

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
    invoice.currency === "PEN"
      ? totals.total
      : Math.round(totals.total * Number(invoice.exchange_rate ?? 0) * 100) / 100;

  const { error: updateError } = await supabase
    .from("incoming_invoices")
    .update({ ...totals, total_pen, updated_at: nowISO() })
    .eq("id", invoiceId);

  if (updateError) {
    return failure("VALIDATION_ERROR", `Failed to update header totals: ${updateError.message}`);
  }

  return success(undefined);
}

async function fetchInvoiceWithLineItemsAndComputed(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  id: string,
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  const invoice = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Incoming invoice not found");

  const { data: lineItems, error: liError } = await supabase
    .from("incoming_invoice_line_items")
    .select("*")
    .eq("incoming_invoice_id", id)
    .order("sort_order", { ascending: true });

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to fetch line items: ${liError.message}`);
  }

  const computed = await computeIncomingInvoicePaymentProgress(supabase, invoice);

  return success({
    ...invoice,
    line_items: (lineItems ?? []) as IncomingInvoiceLineItemRow[],
    _computed: computed,
  });
}

/**
 * Resolve the exchange rate for a USD invoice at create time.
 * Honors an explicit rate when the caller supplies one; otherwise looks
 * up the SUNAT rate for the effective date and returns VALIDATION_ERROR
 * if no rate is registered for that date.
 *
 * Effective date selection:
 *   - Received: use fecha_emision (required by the validator).
 *   - Expected: use today if fecha_emision isn't set — the admin is
 *     recording an estimate, and today's rate is the most relevant
 *     reference. They can override later if they pass an explicit rate.
 */
async function resolveExchangeRate(
  data: CreateIncomingInvoiceInput,
): Promise<ValidationResult<number | null>> {
  const currency = data.currency ?? "PEN";
  if (currency === "PEN") return success(null);

  if (data.exchange_rate != null) {
    return success(data.exchange_rate);
  }

  const effectiveDate =
    data.fecha_emision ?? new Date().toISOString().slice(0, 10);

  const lookup = await requireExactExchangeRate(effectiveDate);
  if (!lookup.success) {
    return lookup as ValidationResult<number | null>;
  }
  return success(lookup.data.rate);
}

// ---------------------------------------------------------------------------
// getIncomingInvoices
// ---------------------------------------------------------------------------

export async function getIncomingInvoices(
  filters?: IncomingInvoiceListFilters,
): Promise<ValidationResult<PaginatedIncomingInvoices>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  // Chase-list path: when needs_factura is true, the list is restricted
  // to expected invoices that have at least one payment line against
  // them. We resolve the candidate IDs up front via a distinct query
  // against payment_lines, so the main query can filter with an `in()`
  // clause and pagination stays correct.
  let chaseListIds: string[] | null = null;
  if (filters?.needs_factura === true) {
    const { data: lines, error: plError } = await supabase
      .from("payment_lines")
      .select("incoming_invoice_id, payments!inner(deleted_at)")
      .is("payments.deleted_at", null)
      .not("incoming_invoice_id", "is", null);

    if (plError) {
      return failure("NOT_FOUND", "Failed to fetch payment lines for chase list");
    }

    const idSet = new Set<string>();
    for (const row of (lines ?? []) as Array<{ incoming_invoice_id: string | null }>) {
      if (row.incoming_invoice_id) idSet.add(row.incoming_invoice_id);
    }
    chaseListIds = Array.from(idSet);

    // Empty chase list → return an empty page without hitting the main query
    if (chaseListIds.length === 0) {
      return success({ data: [], total: 0, limit, offset });
    }
  }

  let query = supabase.from("incoming_invoices").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);
  if (filters?.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters?.currency) query = query.eq("currency", filters.currency);
  if (filters?.incoming_quote_id) {
    query = query.eq("incoming_quote_id", filters.incoming_quote_id);
  }

  // Chase list forces factura_status = expected regardless of any
  // explicit factura_status filter. Otherwise honor the caller's choice.
  if (chaseListIds) {
    query = query
      .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.expected)
      .in("id", chaseListIds);
  } else if (filters?.factura_status !== undefined) {
    query = query.eq("factura_status", filters.factura_status);
  }

  query = query
    .order("fecha_emision", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) return failure("NOT_FOUND", "Failed to fetch incoming invoices");

  const invoices = (data ?? []) as IncomingInvoiceRow[];

  // Batched line items
  const lineItemsByInvoice = new Map<string, IncomingInvoiceLineItemRow[]>();
  if (invoices.length > 0) {
    const invoiceIds = invoices.map((i) => i.id);
    const { data: liRows, error: liError } = await supabase
      .from("incoming_invoice_line_items")
      .select("*")
      .in("incoming_invoice_id", invoiceIds)
      .order("sort_order", { ascending: true });

    if (liError) {
      return failure("NOT_FOUND", "Failed to fetch incoming invoice line items");
    }

    for (const li of (liRows ?? []) as IncomingInvoiceLineItemRow[]) {
      const bucket = lineItemsByInvoice.get(li.incoming_invoice_id);
      if (bucket) bucket.push(li);
      else lineItemsByInvoice.set(li.incoming_invoice_id, [li]);
    }
  }

  // Batched _computed block
  const computedByInvoice = await computeIncomingInvoicePaymentProgressBatch(
    supabase,
    invoices,
  );

  const withComputed: IncomingInvoiceWithComputed[] = invoices.map((i) => ({
    ...i,
    line_items: lineItemsByInvoice.get(i.id) ?? [],
    _computed: computedByInvoice.get(i.id) ?? {
      payment_state: "unpaid",
      paid: 0,
      outstanding: Number(i.total_pen),
      is_fully_paid: false,
      needs_factura: false,
    },
  }));

  return success({
    data: withComputed,
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// getIncomingInvoice
// ---------------------------------------------------------------------------

export async function getIncomingInvoice(
  id: string,
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireUser();
  const supabase = await createServerClient();
  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// createIncomingInvoice — three creation paths converge here
// ---------------------------------------------------------------------------

/**
 * Create an incoming invoice. Handles all three creation paths described
 * in docs/schema-reference.md:
 *
 *   1. Manual expected — caller omits factura_status (defaults to
 *      expected) or sets it explicitly. SUNAT fields are NULL.
 *   2. Manual received — caller sets factura_status = received and
 *      supplies all five SUNAT identifier fields; validation mirrors
 *      the DB ii_received_requires_sunat CHECK.
 *   3. From a payment with no factura linked — Step 10's payment line
 *      flow calls this action with factura_status = expected and the
 *      vendor details from the payment. No dedicated wrapper needed.
 *
 * The "Track as expected invoice" flow (from an approved quote) lives
 * in incoming-quotes.ts → trackIncomingQuoteAsExpectedInvoice because
 * it clones line items via the RPC; keeping it here would duplicate
 * that code.
 */
export async function createIncomingInvoice(
  data: CreateIncomingInvoiceInput,
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireAdmin();

  const headerValidation = validateIncomingInvoice(data);
  if (!headerValidation.success) {
    return headerValidation as ValidationResult<IncomingInvoiceWithComputed>;
  }

  const lineItems = data.line_items ?? [];
  const liValidation = validateLineItems(lineItems, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<IncomingInvoiceWithComputed>;
  }

  // Received path also needs SUNAT format checks (validateIncomingInvoice
  // only checks presence). validateSunatFields is a no-op when all fields
  // are null, so running it unconditionally is fine.
  const sunatValidation = validateSunatFields({
    serie_numero: data.serie_numero,
    fecha_emision: data.fecha_emision,
    tipo_documento_code: data.tipo_documento_code,
    ruc_emisor: data.ruc_emisor,
    ruc_receptor: data.ruc_receptor,
  });
  if (!sunatValidation.success) {
    return sunatValidation as ValidationResult<IncomingInvoiceWithComputed>;
  }

  const supabase = await createServerClient();

  // Project is optional (general expenses have no project)
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

  // Vendor contact check
  const contact = await fetchActiveById<ContactRow>(supabase, "contacts", data.contact_id);
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

  // Quote link (optional) — when set, verify the quote is approved and
  // refers to the same vendor. Strict vendor match prevents cross-wiring.
  if (data.incoming_quote_id) {
    const quote = await fetchActiveById<IncomingQuoteRow>(
      supabase,
      "incoming_quotes",
      data.incoming_quote_id,
    );
    if (!quote) {
      return failure("VALIDATION_ERROR", "La cotización vinculada no existe", {
        incoming_quote_id: "Linked quote not found",
      });
    }
    if (quote.status !== INCOMING_QUOTE_STATUS.approved) {
      return failure("CONFLICT", "La cotización vinculada no está aprobada", {
        incoming_quote_id: `Linked quote must be approved (${INCOMING_QUOTE_STATUS.approved}). Current: ${quote.status}`,
      });
    }
    if (quote.contact_id !== data.contact_id) {
      return failure("VALIDATION_ERROR", "El proveedor de la cotización no coincide", {
        incoming_quote_id: "Linked quote belongs to a different vendor",
      });
    }
  }

  // Exchange rate resolution for USD
  const exchangeRateResult = await resolveExchangeRate(data);
  if (!exchangeRateResult.success) {
    return exchangeRateResult as ValidationResult<IncomingInvoiceWithComputed>;
  }
  const exchangeRate = exchangeRateResult.data;

  // total_pen — honor explicit value, otherwise derive from currency+rate
  const currency = data.currency ?? "PEN";
  const totalPen =
    data.total_pen ??
    (currency === "PEN"
      ? data.total
      : Math.round(data.total * Number(exchangeRate ?? 0) * 100) / 100);

  const facturaStatus =
    data.factura_status ?? INCOMING_INVOICE_FACTURA_STATUS.expected;

  const insertPayload = {
    project_id: data.project_id ?? null,
    contact_id: data.contact_id,
    partner_id: data.partner_id ?? null,
    incoming_quote_id: data.incoming_quote_id ?? null,
    cost_category_id: data.cost_category_id ?? null,
    factura_status: facturaStatus,
    factura_number: data.factura_number ?? null,
    currency,
    exchange_rate: exchangeRate,
    subtotal: data.subtotal,
    igv_amount: data.igv_amount,
    total: data.total,
    total_pen: totalPen,
    detraction_rate: data.detraction_rate ?? null,
    detraction_amount: data.detraction_amount ?? null,
    detraction_handled_by: data.detraction_handled_by ?? null,
    serie_numero: data.serie_numero ?? null,
    fecha_emision: data.fecha_emision ?? null,
    tipo_documento_code: data.tipo_documento_code ?? null,
    ruc_emisor: data.ruc_emisor ?? null,
    ruc_receptor: data.ruc_receptor ?? null,
    notes: data.notes ?? null,
    source: SOURCE.manual,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("incoming_invoices")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to insert incoming invoice",
    );
  }

  const insertedInvoice = inserted as IncomingInvoiceRow;

  if (lineItems.length > 0) {
    // Line items can only be added to expected invoices — the schema
    // locks them on received via assertLineItemsMutable. We already
    // know this is a fresh insert so no lock check is needed; the RPC
    // would reject anyway if factura_status = received.
    if (facturaStatus !== INCOMING_INVOICE_FACTURA_STATUS.expected) {
      await supabase.from("incoming_invoices").delete().eq("id", insertedInvoice.id);
      return failure(
        "CONFLICT",
        "Line items cannot be added to an invoice created as received",
        {
          factura_status:
            "Create as expected first, add line items, then mark as received",
        },
      );
    }

    const liPayload = lineItems.map((li, idx) => ({
      incoming_invoice_id: insertedInvoice.id,
      sort_order: li.sort_order ?? idx,
      description: li.description,
      unit: li.unit ?? null,
      quantity: li.quantity,
      unit_price: li.unit_price,
      subtotal: li.subtotal,
      igv_applies: li.igv_applies ?? true,
      igv_amount: li.igv_amount,
      total: li.total,
      cost_category_id: li.cost_category_id ?? null,
      notes: li.notes ?? null,
    }));

    const { error: liError } = await supabase
      .from("incoming_invoice_line_items")
      .insert(liPayload);

    if (liError) {
      await supabase.from("incoming_invoices").delete().eq("id", insertedInvoice.id);
      return failure(
        "VALIDATION_ERROR",
        `Failed to insert line items: ${liError.message}`,
      );
    }

    // Recompute header totals — the line items may have introduced
    // rounding differences against the caller-supplied totals. For
    // expected invoices, line items are authoritative.
    const recompute = await recomputeIncomingInvoiceTotals(supabase, insertedInvoice.id);
    if (!recompute.success) {
      return recompute as ValidationResult<IncomingInvoiceWithComputed>;
    }
  }

  return fetchInvoiceWithLineItemsAndComputed(supabase, insertedInvoice.id);
}

// ---------------------------------------------------------------------------
// updateIncomingInvoice
// ---------------------------------------------------------------------------

export async function updateIncomingInvoice(
  id: string,
  patch: UpdateIncomingInvoiceInput,
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming invoice not found");

  const lockCheck = validateIncomingInvoiceHeaderUpdate(existing, patch);
  if (!lockCheck.success) {
    return lockCheck as ValidationResult<IncomingInvoiceWithComputed>;
  }

  // If financials shifted on an expected invoice, recompute total_pen
  // from the existing line items (or total × rate when there are none)
  // so the stored value stays consistent.
  const touchesFinancials =
    existing.factura_status === INCOMING_INVOICE_FACTURA_STATUS.expected &&
    ("currency" in patch ||
      "exchange_rate" in patch ||
      "subtotal" in patch ||
      "igv_amount" in patch ||
      "total" in patch);

  const { error: updateError } = await supabase
    .from("incoming_invoices")
    .update({ ...patch, updated_at: nowISO() })
    .eq("id", id);

  if (updateError) {
    return failure("VALIDATION_ERROR", updateError.message);
  }

  if (touchesFinancials) {
    // Recompute from line items if any exist; otherwise compute from
    // the new header values (total × rate).
    const { data: items } = await supabase
      .from("incoming_invoice_line_items")
      .select("id")
      .eq("incoming_invoice_id", id)
      .limit(1);

    if (items && items.length > 0) {
      const recompute = await recomputeIncomingInvoiceTotals(supabase, id);
      if (!recompute.success) {
        return recompute as ValidationResult<IncomingInvoiceWithComputed>;
      }
    } else {
      // Header-only invoice: recompute total_pen from the effective total/rate
      const { data: refreshed } = await supabase
        .from("incoming_invoices")
        .select("currency, exchange_rate, total")
        .eq("id", id)
        .single();
      if (refreshed) {
        const total = Number(refreshed.total ?? 0);
        const totalPen =
          refreshed.currency === "PEN"
            ? total
            : Math.round(total * Number(refreshed.exchange_rate ?? 0) * 100) / 100;
        await supabase
          .from("incoming_invoices")
          .update({ total_pen: totalPen, updated_at: nowISO() })
          .eq("id", id);
      }
    }
  }

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// setIncomingInvoiceLineItems — batch replace via RPC (expected only)
// ---------------------------------------------------------------------------

export async function setIncomingInvoiceLineItems(
  id: string,
  items: IncomingInvoiceLineItemInput[],
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming invoice not found");

  const mutableCheck = assertLineItemsMutable(existing.factura_status, "incoming_invoice");
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<IncomingInvoiceWithComputed>;
  }

  const liValidation = validateLineItems(items, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<IncomingInvoiceWithComputed>;
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
    cost_category_id: li.cost_category_id ?? null,
    notes: li.notes ?? null,
  }));

  const { error } = await supabase.rpc("replace_incoming_invoice_line_items", {
    p_invoice_id: id,
    p_items: normalized,
  });

  if (error) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to replace line items: ${error.message}`,
    );
  }

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// linkIncomingQuote — backfill incoming_quote_id after the fact
// ---------------------------------------------------------------------------

/**
 * Link an incoming invoice to an approved quote after the invoice was
 * already created. Used when the admin creates an expected invoice from
 * a payment first, then discovers there was a quote for it.
 *
 * Blocked once the invoice is received — retroactive paperwork changes
 * could invalidate the audit trail.
 */
export async function linkIncomingQuote(
  invoiceId: string,
  quoteId: string,
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const invoice = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    invoiceId,
  );
  if (!invoice) return failure("NOT_FOUND", "Incoming invoice not found");

  if (invoice.factura_status !== INCOMING_INVOICE_FACTURA_STATUS.expected) {
    return failure(
      "CONFLICT",
      "Solo se puede vincular una cotización a una factura esperada",
      {
        factura_status:
          "Quote link can only be backfilled while factura_status is expected",
      },
    );
  }

  const quote = await fetchActiveById<IncomingQuoteRow>(
    supabase,
    "incoming_quotes",
    quoteId,
  );
  if (!quote) return failure("VALIDATION_ERROR", "La cotización no existe", {
    incoming_quote_id: "Quote not found",
  });

  if (quote.status !== INCOMING_QUOTE_STATUS.approved) {
    return failure("CONFLICT", "La cotización no está aprobada", {
      incoming_quote_id: `Quote must be approved (${INCOMING_QUOTE_STATUS.approved}). Current: ${quote.status}`,
    });
  }

  if (quote.contact_id !== invoice.contact_id) {
    return failure("VALIDATION_ERROR", "El proveedor de la cotización no coincide con la factura", {
      incoming_quote_id: "Quote belongs to a different vendor",
    });
  }

  if (quote.currency !== invoice.currency) {
    return failure("VALIDATION_ERROR", "La moneda de la cotización no coincide con la factura", {
      currency: `Quote currency (${quote.currency}) does not match invoice currency (${invoice.currency})`,
    });
  }

  const { error } = await supabase
    .from("incoming_invoices")
    .update({ incoming_quote_id: quoteId, updated_at: nowISO() })
    .eq("id", invoiceId);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchInvoiceWithLineItemsAndComputed(supabase, invoiceId);
}

// ---------------------------------------------------------------------------
// markIncomingInvoiceAsReceived — expected → received transition
// ---------------------------------------------------------------------------

export async function markIncomingInvoiceAsReceived(
  id: string,
  sunatData: SunatFieldsInput & { factura_number?: string | null },
): Promise<ValidationResult<IncomingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const invoice = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Incoming invoice not found");

  // Format validation first — catches garbage before we mutate
  const formatCheck = validateSunatFields(sunatData);
  if (!formatCheck.success) {
    return formatCheck as ValidationResult<IncomingInvoiceWithComputed>;
  }

  // Compose the after-state so the transition validator can check the
  // presence of SUNAT identifier fields.
  const afterState = {
    serie_numero: sunatData.serie_numero ?? invoice.serie_numero,
    fecha_emision: sunatData.fecha_emision ?? invoice.fecha_emision,
    tipo_documento_code: sunatData.tipo_documento_code ?? invoice.tipo_documento_code,
    ruc_emisor: sunatData.ruc_emisor ?? invoice.ruc_emisor,
    ruc_receptor: sunatData.ruc_receptor ?? invoice.ruc_receptor,
  };

  const transitionCheck = validateFacturaStatusTransition(
    invoice.factura_status,
    INCOMING_INVOICE_FACTURA_STATUS.received,
    afterState,
  );
  if (!transitionCheck.success) {
    return transitionCheck as ValidationResult<IncomingInvoiceWithComputed>;
  }

  // Apply the transition in a single UPDATE so the
  // ii_received_requires_sunat CHECK constraint fires atomically against
  // the effective row.
  const updatePayload: Record<string, unknown> = {
    factura_status: INCOMING_INVOICE_FACTURA_STATUS.received,
    serie_numero: afterState.serie_numero,
    fecha_emision: afterState.fecha_emision,
    tipo_documento_code: afterState.tipo_documento_code,
    ruc_emisor: afterState.ruc_emisor,
    ruc_receptor: afterState.ruc_receptor,
    updated_at: nowISO(),
  };
  if (sunatData.hash_cdr !== undefined) updatePayload.hash_cdr = sunatData.hash_cdr;
  if (sunatData.estado_sunat !== undefined) updatePayload.estado_sunat = sunatData.estado_sunat;
  if (sunatData.factura_number !== undefined) updatePayload.factura_number = sunatData.factura_number;

  const { error } = await supabase
    .from("incoming_invoices")
    .update(updatePayload)
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// deleteIncomingInvoice
// ---------------------------------------------------------------------------

export async function deleteIncomingInvoice(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Incoming invoice not found");

  const deletableCheck = assertIncomingInvoiceDeletable(existing);
  if (!deletableCheck.success) {
    return deletableCheck as ValidationResult<{ id: string; deleted_at: string }>;
  }

  // Block delete if any payment line references this invoice — dropping
  // the invoice would orphan the allocation and break chase-list logic.
  const { data: lines, error: linesError } = await supabase
    .from("payment_lines")
    .select("id")
    .eq("incoming_invoice_id", id)
    .limit(1);

  if (linesError) {
    return failure("VALIDATION_ERROR", `Failed to check payment lines: ${linesError.message}`);
  }
  if (lines && lines.length > 0) {
    return failure(
      "CONFLICT",
      "No se puede eliminar una factura con pagos registrados. Elimine primero las asignaciones de pago.",
      {
        payment_lines:
          "Invoice has existing payment allocations. Remove them before deleting.",
      },
    );
  }

  const deletedAt = nowISO();
  const { error } = await supabase
    .from("incoming_invoices")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return success({ id, deleted_at: deletedAt });
}
