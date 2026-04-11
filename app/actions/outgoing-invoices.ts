"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  OUTGOING_INVOICE_STATUS,
  PROJECT_STATUS,
  DETRACTION_STATUS,
} from "@/lib/types";
import type {
  ValidationResult,
  OutgoingInvoiceRow,
  OutgoingInvoiceLineItemRow,
  ProjectRow,
  LineItemInput,
  CreateOutgoingInvoiceInput,
  UpdateOutgoingInvoiceInput,
} from "@/lib/types";
import {
  validateOutgoingInvoice,
  validateLineItemMath,
  validateDocumentTotals,
  validateOutgoingInvoiceHeaderUpdate,
  assertOutgoingInvoiceUndoable,
  assertOutgoingInvoiceVoidable,
  assertLineItemsMutable,
} from "@/lib/validators/invoices";
import { assertTransition } from "@/lib/lifecycle";
import { requireExactExchangeRate } from "@/lib/exchange-rate";
import {
  computeOutgoingInvoicePaymentProgress,
  computeOutgoingInvoicePaymentProgressBatch,
  type OutgoingInvoiceComputed,
} from "@/lib/outgoing-invoice-computed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutgoingInvoiceWithComputed = OutgoingInvoiceRow & {
  line_items: OutgoingInvoiceLineItemRow[];
  _computed: OutgoingInvoiceComputed;
};

type OutgoingInvoiceListFilters = {
  project_id?: string;
  status?: number;
  currency?: string;
  period_start_from?: string;
  period_start_to?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedOutgoingInvoices = {
  data: OutgoingInvoiceWithComputed[];
  total: number;
  limit: number;
  offset: number;
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
 * the current line items. Used after direct inserts in createOutgoingInvoice;
 * setOutgoingInvoiceLineItems goes through the atomic RPC instead.
 */
async function recomputeOutgoingInvoiceTotals(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  invoiceId: string,
): Promise<ValidationResult<void>> {
  const { data: invoice, error: headerError } = await supabase
    .from("outgoing_invoices")
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
    .from("outgoing_invoice_line_items")
    .select("subtotal, igv_amount, total")
    .eq("outgoing_invoice_id", invoiceId);

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
    .from("outgoing_invoices")
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
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  const invoice = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Outgoing invoice not found");

  const { data: lineItems, error: liError } = await supabase
    .from("outgoing_invoice_line_items")
    .select("*")
    .eq("outgoing_invoice_id", id)
    .order("sort_order", { ascending: true });

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to fetch line items: ${liError.message}`);
  }

  const computed = await computeOutgoingInvoicePaymentProgress(supabase, invoice);

  return success({
    ...invoice,
    line_items: (lineItems ?? []) as OutgoingInvoiceLineItemRow[],
    _computed: computed,
  });
}

// ---------------------------------------------------------------------------
// getOutgoingInvoices
// ---------------------------------------------------------------------------

export async function getOutgoingInvoices(
  filters?: OutgoingInvoiceListFilters,
): Promise<ValidationResult<PaginatedOutgoingInvoices>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  let query = supabase.from("outgoing_invoices").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);
  if (filters?.status !== undefined) query = query.eq("status", filters.status);
  if (filters?.currency) query = query.eq("currency", filters.currency);
  if (filters?.period_start_from) {
    query = query.gte("period_start", filters.period_start_from);
  }
  if (filters?.period_start_to) {
    query = query.lte("period_start", filters.period_start_to);
  }

  query = query
    .order("issue_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;

  if (error) return failure("NOT_FOUND", "Failed to fetch outgoing invoices");

  const invoices = (data ?? []) as OutgoingInvoiceRow[];

  // Batched line items
  const lineItemsByInvoice = new Map<string, OutgoingInvoiceLineItemRow[]>();
  if (invoices.length > 0) {
    const invoiceIds = invoices.map((i) => i.id);
    const { data: liRows, error: liError } = await supabase
      .from("outgoing_invoice_line_items")
      .select("*")
      .in("outgoing_invoice_id", invoiceIds)
      .order("sort_order", { ascending: true });

    if (liError) {
      return failure("NOT_FOUND", "Failed to fetch outgoing invoice line items");
    }

    for (const li of (liRows ?? []) as OutgoingInvoiceLineItemRow[]) {
      const bucket = lineItemsByInvoice.get(li.outgoing_invoice_id);
      if (bucket) bucket.push(li);
      else lineItemsByInvoice.set(li.outgoing_invoice_id, [li]);
    }
  }

  // Batched _computed block
  const computedByInvoice = await computeOutgoingInvoicePaymentProgressBatch(
    supabase,
    invoices,
  );

  const withComputed: OutgoingInvoiceWithComputed[] = invoices.map((i) => ({
    ...i,
    line_items: lineItemsByInvoice.get(i.id) ?? [],
    _computed: computedByInvoice.get(i.id) ?? {
      payment_state: "unpaid",
      sunat_state: "not_submitted",
      paid: 0,
      outstanding: Number(i.total_pen),
      is_fully_paid: false,
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
// getOutgoingInvoice
// ---------------------------------------------------------------------------

export async function getOutgoingInvoice(
  id: string,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireUser();
  const supabase = await createServerClient();
  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// createOutgoingInvoice
// ---------------------------------------------------------------------------

export async function createOutgoingInvoice(
  data: CreateOutgoingInvoiceInput,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();

  // Baseline header validation (project/dates/currency/detracción consistency)
  const headerValidation = validateOutgoingInvoice(data);
  if (!headerValidation.success) {
    return headerValidation as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const lineItems = data.line_items ?? [];
  const liValidation = validateLineItems(lineItems, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const supabase = await createServerClient();

  // Verify project exists and accepts new revenue documents
  const project = await fetchActiveById<ProjectRow>(supabase, "projects", data.project_id);
  if (!project) {
    return failure("VALIDATION_ERROR", "El proyecto no existe", {
      project_id: "Project not found",
    });
  }
  if (project.status === PROJECT_STATUS.archived) {
    return failure("CONFLICT", "No se puede facturar un proyecto archivado", {
      project_id: "Project is archived",
    });
  }
  if (project.status === PROJECT_STATUS.rejected) {
    return failure("CONFLICT", "No se puede facturar un proyecto rechazado", {
      project_id: "Project is rejected",
    });
  }

  // Exchange rate: auto-fill from exchange_rates on USD invoices using
  // the strict exact-match lookup. If the rate for the issue date is not
  // registered, block creation and point the admin at Settings → Tipos de
  // Cambio. The Step 7 weekend backfill ensures Sat/Sun dates resolve to
  // Friday's rate, so strict lookup only fails on genuine gaps.
  const currency = data.currency ?? "PEN";
  let exchangeRate: number | null = null;
  if (currency === "USD") {
    // If caller passed an explicit rate, honor it (useful for rare manual
    // overrides the admin wants to document). Otherwise auto-fill.
    if (data.exchange_rate != null) {
      exchangeRate = data.exchange_rate;
    } else {
      const rateLookup = await requireExactExchangeRate(data.issue_date);
      if (!rateLookup.success) {
        return rateLookup as ValidationResult<OutgoingInvoiceWithComputed>;
      }
      exchangeRate = rateLookup.data.rate;
    }
  }

  // Insert header with zero totals (line items + recompute will fix them)
  const insertPayload = {
    project_id: data.project_id,
    period_start: data.period_start,
    period_end: data.period_end,
    issue_date: data.issue_date,
    currency,
    exchange_rate: exchangeRate,
    subtotal: 0,
    igv_amount: 0,
    total: 0,
    total_pen: 0,
    detraction_rate: data.detraction_rate ?? null,
    detraction_amount: data.detraction_amount ?? null,
    detraction_status:
      data.detraction_rate != null
        ? DETRACTION_STATUS.pending
        : DETRACTION_STATUS.not_applicable,
    serie_numero: data.serie_numero ?? null,
    fecha_emision: data.fecha_emision ?? null,
    tipo_documento_code: data.tipo_documento_code ?? null,
    ruc_emisor: data.ruc_emisor ?? null,
    ruc_receptor: data.ruc_receptor ?? null,
    notes: data.notes ?? null,
    status: OUTGOING_INVOICE_STATUS.draft,
    source: 1, // manual
  };

  const { data: inserted, error: insertError } = await supabase
    .from("outgoing_invoices")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to insert outgoing invoice",
    );
  }

  const insertedInvoice = inserted as OutgoingInvoiceRow;

  if (lineItems.length > 0) {
    const liPayload = lineItems.map((li, idx) => ({
      outgoing_invoice_id: insertedInvoice.id,
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
      .from("outgoing_invoice_line_items")
      .insert(liPayload);

    if (liError) {
      // Best-effort cleanup
      await supabase.from("outgoing_invoices").delete().eq("id", insertedInvoice.id);
      return failure(
        "VALIDATION_ERROR",
        `Failed to insert line items: ${liError.message}`,
      );
    }

    const recompute = await recomputeOutgoingInvoiceTotals(supabase, insertedInvoice.id);
    if (!recompute.success) {
      return recompute as ValidationResult<OutgoingInvoiceWithComputed>;
    }
  }

  return fetchInvoiceWithLineItemsAndComputed(supabase, insertedInvoice.id);
}

// ---------------------------------------------------------------------------
// updateOutgoingInvoice
// ---------------------------------------------------------------------------

export async function updateOutgoingInvoice(
  id: string,
  patch: UpdateOutgoingInvoiceInput,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing invoice not found");

  const lockCheck = validateOutgoingInvoiceHeaderUpdate(existing, patch);
  if (!lockCheck.success) {
    return lockCheck as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  // If currency or exchange_rate changed on a draft, recompute total_pen.
  // (Status is already verified draft by the lock check when these fields
  // are present.)
  const needsTotalPenRecompute =
    existing.status === OUTGOING_INVOICE_STATUS.draft &&
    ("currency" in patch || "exchange_rate" in patch);

  const { error: updateError } = await supabase
    .from("outgoing_invoices")
    .update({ ...patch, updated_at: nowISO() })
    .eq("id", id);

  if (updateError) {
    return failure("VALIDATION_ERROR", updateError.message);
  }

  if (needsTotalPenRecompute) {
    const recompute = await recomputeOutgoingInvoiceTotals(supabase, id);
    if (!recompute.success) {
      return recompute as ValidationResult<OutgoingInvoiceWithComputed>;
    }
  }

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// setOutgoingInvoiceLineItems — batch replace via RPC (draft only)
// ---------------------------------------------------------------------------

export async function setOutgoingInvoiceLineItems(
  id: string,
  items: LineItemInput[],
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing invoice not found");

  const mutableCheck = assertLineItemsMutable(existing.status, "outgoing_invoice");
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const liValidation = validateLineItems(items, { requireNonEmpty: false });
  if (!liValidation.success) {
    return liValidation as ValidationResult<OutgoingInvoiceWithComputed>;
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

  const { error } = await supabase.rpc("replace_outgoing_invoice_line_items", {
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
// Lifecycle actions
// ---------------------------------------------------------------------------

export async function markOutgoingInvoiceAsSent(
  id: string,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const invoice = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Outgoing invoice not found");

  const transition = assertTransition(
    "outgoing_invoice",
    invoice.status,
    OUTGOING_INVOICE_STATUS.sent,
  );
  if (!transition.success) {
    return transition as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  // Require ≥1 line item and header totals matching the line-items sum.
  const { data: lines, error: liError } = await supabase
    .from("outgoing_invoice_line_items")
    .select("subtotal, igv_amount, total")
    .eq("outgoing_invoice_id", id);

  if (liError) {
    return failure("VALIDATION_ERROR", `Failed to verify line items: ${liError.message}`);
  }
  if (!lines || lines.length === 0) {
    return failure(
      "VALIDATION_ERROR",
      "Cannot mark as sent: outgoing invoice has no line items",
      { line_items: "At least one line item is required" },
    );
  }

  const totalsCheck = validateDocumentTotals(
    { subtotal: invoice.subtotal, igv_amount: invoice.igv_amount, total: invoice.total },
    lines.map((li) => ({
      description: "",
      quantity: 0,
      unit_price: 0,
      subtotal: Number(li.subtotal),
      igv_amount: Number(li.igv_amount),
      total: Number(li.total),
    })),
  );
  if (!totalsCheck.success) {
    return totalsCheck as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const { error } = await supabase
    .from("outgoing_invoices")
    .update({ status: OUTGOING_INVOICE_STATUS.sent, updated_at: nowISO() })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

export async function unsendOutgoingInvoice(
  id: string,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const invoice = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Outgoing invoice not found");

  const transition = assertTransition(
    "outgoing_invoice",
    invoice.status,
    OUTGOING_INVOICE_STATUS.draft,
  );
  if (!transition.success) {
    return transition as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const undoCheck = assertOutgoingInvoiceUndoable(invoice);
  if (!undoCheck.success) {
    return undoCheck as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const { error } = await supabase
    .from("outgoing_invoices")
    .update({ status: OUTGOING_INVOICE_STATUS.draft, updated_at: nowISO() })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

export async function voidOutgoingInvoice(
  id: string,
  reason?: string,
): Promise<ValidationResult<OutgoingInvoiceWithComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const invoice = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!invoice) return failure("NOT_FOUND", "Outgoing invoice not found");

  const transition = assertTransition(
    "outgoing_invoice",
    invoice.status,
    OUTGOING_INVOICE_STATUS.void,
  );
  if (!transition.success) {
    return transition as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const voidableCheck = await assertOutgoingInvoiceVoidable(supabase, id);
  if (!voidableCheck.success) {
    return voidableCheck as ValidationResult<OutgoingInvoiceWithComputed>;
  }

  const updates: Record<string, unknown> = {
    status: OUTGOING_INVOICE_STATUS.void,
    updated_at: nowISO(),
  };
  if (reason) {
    updates.notes = invoice.notes ? `${invoice.notes}\n\n[VOID] ${reason}` : `[VOID] ${reason}`;
  }

  const { error } = await supabase
    .from("outgoing_invoices")
    .update(updates)
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchInvoiceWithLineItemsAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// deleteOutgoingInvoice
// ---------------------------------------------------------------------------

export async function deleteOutgoingInvoice(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<OutgoingInvoiceRow>(
    supabase,
    "outgoing_invoices",
    id,
  );
  if (!existing) return failure("NOT_FOUND", "Outgoing invoice not found");

  if (existing.status !== OUTGOING_INVOICE_STATUS.draft) {
    return failure(
      "CONFLICT",
      "Solo se pueden eliminar facturas en borrador. Use Anular (void) para facturas enviadas.",
      {
        status: `Outgoing invoice must be in draft to delete. Current: ${existing.status}`,
      },
    );
  }

  const deletedAt = nowISO();
  const { error } = await supabase
    .from("outgoing_invoices")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return success({ id, deleted_at: deletedAt });
}
