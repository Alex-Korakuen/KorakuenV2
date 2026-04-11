"use server";

import { requireUser, requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
  ACCOUNT_TYPE,
  INCOMING_INVOICE_FACTURA_STATUS,
} from "@/lib/types";
import type {
  ValidationResult,
  PaymentRow,
  PaymentLineRow,
  BankAccountRow,
  OutgoingInvoiceRow,
  IncomingInvoiceRow,
  ProjectRow,
  CreatePaymentInput,
  CreatePaymentLineInput,
  CreateIncomingInvoiceInput,
} from "@/lib/types";
import {
  validateCreatePayment,
  validateBankAccountConsistency,
  validatePaymentInvoiceCurrency,
  validateSplitSumToOriginal,
  validatePaymentMutable,
  validateUpdatePayment,
} from "@/lib/validators/payments";
import { validateIncomingInvoice } from "@/lib/validators/invoices";
import { requireExactExchangeRate } from "@/lib/exchange-rate";
import { computeOutgoingInvoicePaymentProgress } from "@/lib/outgoing-invoice-computed";
import { computeIncomingInvoicePaymentProgress } from "@/lib/incoming-invoice-computed";
import {
  signedContributionForInvoice,
  autoSplitOnOverflow,
  type InvoiceType,
} from "@/lib/payment-helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentFilters = {
  project_id?: string;
  bank_account_id?: string;
  direction?: number;
  contact_id?: string;
  date_from?: string;
  date_to?: string;
  reconciled?: boolean;
  has_unlinked_lines?: boolean;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaymentComputed = {
  has_unlinked_lines: boolean;
  linked_invoice_count: number;
};

export type PaymentWithLinesAndComputed = PaymentRow & {
  lines: PaymentLineRow[];
  _computed: PaymentComputed;
};

type PaginatedPayments = {
  data: PaymentWithLinesAndComputed[];
  total: number;
  limit: number;
  offset: number;
};

export type PaymentLineSplitInput = {
  amount: number;
  amount_pen: number;
  line_type: number;
  outgoing_invoice_id?: string | null;
  incoming_invoice_id?: string | null;
  loan_id?: string | null;
  cost_category_id?: string | null;
  notes?: string | null;
};

export type UpdatePaymentInput = {
  payment_date?: string;
  bank_reference?: string | null;
  notes?: string | null;
  project_id?: string | null;
  contact_id?: string | null;
  paid_by_partner_id?: string | null;
  drive_file_id?: string | null;
};

export type UpdatePaymentLineInput = {
  notes?: string | null;
  cost_category_id?: string | null;
};

export type CreateExpectedInvoiceFromPaymentLineInput = {
  project_id?: string | null;
  contact_id: string;
  cost_category_id?: string | null;
  currency?: string;
  exchange_rate?: number | null;
  subtotal: number;
  igv_amount: number;
  total: number;
  total_pen?: number;
  detraction_rate?: number | null;
  detraction_amount?: number | null;
  notes?: string | null;
};

type UnlinkedPaymentLineFilters = {
  direction?: number;
  contact_id?: string;
  date_from?: string;
  date_to?: string;
  reconciled?: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function deriveIsDetraction(bankAccount: BankAccountRow): boolean {
  return bankAccount.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
}

function computeLineTotals(lines: CreatePaymentLineInput[]): {
  totalAmount: number;
  totalAmountPen: number;
} {
  const totalAmount = Math.round(
    lines.reduce((acc, l) => acc + l.amount, 0) * 100,
  ) / 100;
  const totalAmountPen = Math.round(
    lines.reduce((acc, l) => acc + l.amount_pen, 0) * 100,
  ) / 100;
  return { totalAmount, totalAmountPen };
}

function lineIsUnlinked(line: PaymentLineRow): boolean {
  return (
    line.line_type === PAYMENT_LINE_TYPE.general &&
    line.outgoing_invoice_id == null &&
    line.incoming_invoice_id == null &&
    line.loan_id == null
  );
}

function buildPaymentComputed(lines: PaymentLineRow[]): PaymentComputed {
  const hasUnlinked = lines.some(lineIsUnlinked);
  const linkedSet = new Set<string>();
  for (const line of lines) {
    if (line.outgoing_invoice_id) {
      linkedSet.add(`o:${line.outgoing_invoice_id}`);
    }
    if (line.incoming_invoice_id) {
      linkedSet.add(`i:${line.incoming_invoice_id}`);
    }
  }
  return {
    has_unlinked_lines: hasUnlinked,
    linked_invoice_count: linkedSet.size,
  };
}

async function fetchPaymentLines(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  paymentId: string,
): Promise<PaymentLineRow[]> {
  const { data, error } = await supabase
    .from("payment_lines")
    .select("*")
    .eq("payment_id", paymentId)
    .order("sort_order", { ascending: true });

  if (error) return [];
  return (data ?? []) as PaymentLineRow[];
}

async function fetchPaymentWithLinesAndComputed(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  id: string,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  const payment = await fetchActiveById<PaymentRow>(supabase, "payments", id);
  if (!payment) return failure("NOT_FOUND", "Payment not found");

  const lines = await fetchPaymentLines(supabase, id);

  return success({
    ...payment,
    lines,
    _computed: buildPaymentComputed(lines),
  });
}

async function recomputePaymentTotals(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  paymentId: string,
): Promise<ValidationResult<void>> {
  const { data: rows, error } = await supabase
    .from("payment_lines")
    .select("amount, amount_pen")
    .eq("payment_id", paymentId);

  if (error) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to read payment lines for recompute: ${error.message}`,
    );
  }

  const lines = (rows ?? []) as Array<{ amount: number; amount_pen: number }>;
  const totalAmount =
    Math.round(lines.reduce((acc, l) => acc + Number(l.amount), 0) * 100) / 100;
  const totalAmountPen =
    Math.round(
      lines.reduce((acc, l) => acc + Number(l.amount_pen), 0) * 100,
    ) / 100;

  const { error: updateError } = await supabase
    .from("payments")
    .update({
      total_amount: totalAmount,
      total_amount_pen: totalAmountPen,
      updated_at: nowISO(),
    })
    .eq("id", paymentId);

  if (updateError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to update payment totals: ${updateError.message}`,
    );
  }

  return success(undefined);
}

async function fetchCurrentSignedPaid(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  invoiceId: string,
  invoiceType: InvoiceType,
): Promise<ValidationResult<{ total_pen: number; paid: number }>> {
  if (invoiceType === "outgoing") {
    const invoice = await fetchActiveById<OutgoingInvoiceRow>(
      supabase,
      "outgoing_invoices",
      invoiceId,
    );
    if (!invoice) return failure("NOT_FOUND", "Outgoing invoice not found");
    const computed = await computeOutgoingInvoicePaymentProgress(
      supabase,
      invoice,
    );
    return success({ total_pen: Number(invoice.total_pen), paid: computed.paid });
  }

  const invoice = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    invoiceId,
  );
  if (!invoice) return failure("NOT_FOUND", "Incoming invoice not found");
  const computed = await computeIncomingInvoicePaymentProgress(
    supabase,
    invoice,
  );
  return success({ total_pen: Number(invoice.total_pen), paid: computed.paid });
}

async function fetchInvoiceForLink(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  invoiceId: string,
  invoiceType: InvoiceType,
): Promise<
  | { success: true; data: OutgoingInvoiceRow | IncomingInvoiceRow }
  | { success: false; error: { code: string; message: string } }
> {
  if (invoiceType === "outgoing") {
    const row = await fetchActiveById<OutgoingInvoiceRow>(
      supabase,
      "outgoing_invoices",
      invoiceId,
    );
    if (!row) {
      return { success: false, error: { code: "NOT_FOUND", message: "Outgoing invoice not found" } };
    }
    return { success: true, data: row };
  }
  const row = await fetchActiveById<IncomingInvoiceRow>(
    supabase,
    "incoming_invoices",
    invoiceId,
  );
  if (!row) {
    return { success: false, error: { code: "NOT_FOUND", message: "Incoming invoice not found" } };
  }
  return { success: true, data: row };
}

async function fetchPaymentLineById(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  lineId: string,
): Promise<PaymentLineRow | null> {
  const { data, error } = await supabase
    .from("payment_lines")
    .select("*")
    .eq("id", lineId)
    .maybeSingle();
  if (error || !data) return null;
  return data as PaymentLineRow;
}

// ---------------------------------------------------------------------------
// getPayment
// ---------------------------------------------------------------------------

export async function getPayment(
  id: string,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireUser();
  const supabase = await createServerClient();
  return fetchPaymentWithLinesAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// getPayments
// ---------------------------------------------------------------------------

export async function getPayments(
  filters?: PaymentFilters,
): Promise<ValidationResult<PaginatedPayments>> {
  await requireUser();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  // Pre-filter: if has_unlinked_lines is true, fetch candidate payment IDs
  // via a distinct query against payment_lines. Matches the chase-list
  // pattern from incoming-invoices.ts.
  let candidateIds: string[] | null = null;
  if (filters?.has_unlinked_lines === true) {
    const { data: probe, error: probeError } = await supabase
      .from("payment_lines")
      .select("payment_id")
      .eq("line_type", PAYMENT_LINE_TYPE.general)
      .is("outgoing_invoice_id", null)
      .is("incoming_invoice_id", null)
      .is("loan_id", null);

    if (probeError) {
      return failure("NOT_FOUND", "Failed to probe unlinked payment lines");
    }

    const ids = new Set<string>();
    for (const row of (probe ?? []) as Array<{ payment_id: string }>) {
      ids.add(row.payment_id);
    }
    candidateIds = Array.from(ids);
    // Short-circuit: no candidates means empty result
    if (candidateIds.length === 0) {
      return success({ data: [], total: 0, limit, offset });
    }
  }

  let query = supabase.from("payments").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }
  if (candidateIds !== null) {
    query = query.in("id", candidateIds);
  }
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);
  if (filters?.bank_account_id) {
    query = query.eq("bank_account_id", filters.bank_account_id);
  }
  if (filters?.direction !== undefined) {
    query = query.eq("direction", filters.direction);
  }
  if (filters?.contact_id) query = query.eq("contact_id", filters.contact_id);
  if (filters?.reconciled !== undefined) {
    query = query.eq("reconciled", filters.reconciled);
  }
  if (filters?.date_from) query = query.gte("payment_date", filters.date_from);
  if (filters?.date_to) query = query.lte("payment_date", filters.date_to);

  query = query
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) return failure("NOT_FOUND", "Failed to fetch payments");

  const payments = (data ?? []) as PaymentRow[];

  // Batched line fetch
  const linesByPayment = new Map<string, PaymentLineRow[]>();
  if (payments.length > 0) {
    const paymentIds = payments.map((p) => p.id);
    const { data: lineRows, error: lineError } = await supabase
      .from("payment_lines")
      .select("*")
      .in("payment_id", paymentIds)
      .order("sort_order", { ascending: true });

    if (lineError) {
      return failure("NOT_FOUND", "Failed to fetch payment lines");
    }

    for (const line of (lineRows ?? []) as PaymentLineRow[]) {
      const bucket = linesByPayment.get(line.payment_id);
      if (bucket) bucket.push(line);
      else linesByPayment.set(line.payment_id, [line]);
    }
  }

  const withComputed: PaymentWithLinesAndComputed[] = payments.map((p) => {
    const lines = linesByPayment.get(p.id) ?? [];
    return {
      ...p,
      lines,
      _computed: buildPaymentComputed(lines),
    };
  });

  return success({
    data: withComputed,
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// updatePayment
// ---------------------------------------------------------------------------

export async function updatePayment(
  id: string,
  patch: UpdatePaymentInput,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<PaymentRow>(supabase, "payments", id);
  if (!existing) return failure("NOT_FOUND", "Payment not found");

  const mutableCheck = validatePaymentMutable(existing);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const updateCheck = validateUpdatePayment(
    patch as Record<string, unknown>,
    existing,
  );
  if (!updateCheck.success) {
    return updateCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const { error: updateError } = await supabase
    .from("payments")
    .update({ ...patch, updated_at: nowISO() })
    .eq("id", id);

  if (updateError) {
    return failure("VALIDATION_ERROR", updateError.message);
  }

  return fetchPaymentWithLinesAndComputed(supabase, id);
}

// ---------------------------------------------------------------------------
// deletePayment
// ---------------------------------------------------------------------------

export async function deletePayment(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const existing = await fetchActiveById<PaymentRow>(supabase, "payments", id);
  if (!existing) return failure("NOT_FOUND", "Payment not found");

  const mutableCheck = validatePaymentMutable(existing);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<{ id: string; deleted_at: string }>;
  }

  const deletedAt = nowISO();
  const { error } = await supabase
    .from("payments")
    .update({ deleted_at: deletedAt, updated_at: deletedAt })
    .eq("id", id);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return success({ id, deleted_at: deletedAt });
}

// ---------------------------------------------------------------------------
// createPayment
// ---------------------------------------------------------------------------

export async function createPayment(
  data: CreatePaymentInput,
  lines: CreatePaymentLineInput[],
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();

  const headerValidation = validateCreatePayment(data, lines);
  if (!headerValidation.success) {
    return headerValidation as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const supabase = await createServerClient();

  // Bank account + consistency + is_detraction derivation
  const bankAccount = await fetchActiveById<BankAccountRow>(
    supabase,
    "bank_accounts",
    data.bank_account_id,
  );
  if (!bankAccount) {
    return failure("VALIDATION_ERROR", "La cuenta bancaria no existe", {
      bank_account_id: "Bank account not found",
    });
  }

  const bankCheck = validateBankAccountConsistency(data, bankAccount);
  if (!bankCheck.success) {
    return bankCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const isDetraction = deriveIsDetraction(bankAccount);

  // Currency + exchange rate
  const currency = data.currency ?? "PEN";
  let exchangeRate: number | null = data.exchange_rate ?? null;
  if (currency === "USD" && exchangeRate == null) {
    const rateLookup = await requireExactExchangeRate(data.payment_date);
    if (!rateLookup.success) {
      return rateLookup as ValidationResult<PaymentWithLinesAndComputed>;
    }
    exchangeRate = rateLookup.data.rate;
  }

  // Currency-vs-invoice check for any line that already has an invoice link
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.outgoing_invoice_id) {
      const inv = await fetchActiveById<OutgoingInvoiceRow>(
        supabase,
        "outgoing_invoices",
        line.outgoing_invoice_id,
      );
      if (!inv) {
        return failure("VALIDATION_ERROR", "Linked outgoing invoice not found", {
          [`lines[${i}].outgoing_invoice_id`]: "Outgoing invoice not found",
        });
      }
      const curCheck = validatePaymentInvoiceCurrency(
        currency,
        inv.currency,
        isDetraction,
        bankAccount.account_type,
      );
      if (!curCheck.success) {
        const scoped: Record<string, string> = {};
        for (const [k, v] of Object.entries(curCheck.error.fields ?? {})) {
          scoped[`lines[${i}].${k}`] = v;
        }
        return failure(curCheck.error.code, curCheck.error.message, scoped);
      }
    }
    if (line.incoming_invoice_id) {
      const inv = await fetchActiveById<IncomingInvoiceRow>(
        supabase,
        "incoming_invoices",
        line.incoming_invoice_id,
      );
      if (!inv) {
        return failure("VALIDATION_ERROR", "Linked incoming invoice not found", {
          [`lines[${i}].incoming_invoice_id`]: "Incoming invoice not found",
        });
      }
      const curCheck = validatePaymentInvoiceCurrency(
        currency,
        inv.currency,
        isDetraction,
        bankAccount.account_type,
      );
      if (!curCheck.success) {
        const scoped: Record<string, string> = {};
        for (const [k, v] of Object.entries(curCheck.error.fields ?? {})) {
          scoped[`lines[${i}].${k}`] = v;
        }
        return failure(curCheck.error.code, curCheck.error.message, scoped);
      }
    }
  }

  // Precompute header totals from lines
  const { totalAmount, totalAmountPen } = computeLineTotals(lines);

  // Insert header
  const insertPayload = {
    direction: data.direction,
    bank_account_id: data.bank_account_id,
    project_id: data.project_id ?? null,
    contact_id: data.contact_id ?? null,
    paid_by_partner_id: data.paid_by_partner_id ?? null,
    total_amount: totalAmount,
    currency,
    exchange_rate: exchangeRate,
    total_amount_pen: totalAmountPen,
    is_detraction: isDetraction,
    bank_reference: data.bank_reference ?? null,
    payment_date: data.payment_date,
    notes: data.notes ?? null,
    source: 1, // manual
  };

  const { data: inserted, error: insertError } = await supabase
    .from("payments")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to insert payment",
    );
  }

  const insertedPayment = inserted as PaymentRow;

  // Bulk insert lines with sequential sort_order
  const linesPayload = lines.map((l, idx) => ({
    payment_id: insertedPayment.id,
    sort_order: l.sort_order ?? idx,
    amount: l.amount,
    amount_pen: l.amount_pen,
    outgoing_invoice_id: l.outgoing_invoice_id ?? null,
    incoming_invoice_id: l.incoming_invoice_id ?? null,
    loan_id: l.loan_id ?? null,
    cost_category_id: l.cost_category_id ?? null,
    line_type: l.line_type,
    notes: l.notes ?? null,
  }));

  const { error: lineError } = await supabase
    .from("payment_lines")
    .insert(linesPayload);

  if (lineError) {
    // Best-effort cleanup: hard-delete the just-inserted header since no
    // line_type=3 links exist yet that would be affected by the cascade.
    await supabase.from("payments").delete().eq("id", insertedPayment.id);
    return failure(
      "VALIDATION_ERROR",
      `Failed to insert payment lines: ${lineError.message}`,
    );
  }

  return fetchPaymentWithLinesAndComputed(supabase, insertedPayment.id);
}

// ---------------------------------------------------------------------------
// updatePaymentLine
// ---------------------------------------------------------------------------

export async function updatePaymentLine(
  lineId: string,
  patch: UpdatePaymentLineInput,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const line = await fetchPaymentLineById(supabase, lineId);
  if (!line) return failure("NOT_FOUND", "Payment line not found");

  const parent = await fetchActiveById<PaymentRow>(
    supabase,
    "payments",
    line.payment_id,
  );
  if (!parent) return failure("NOT_FOUND", "Parent payment not found");

  const mutableCheck = validatePaymentMutable(parent);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const updatePayload: Record<string, unknown> = { updated_at: nowISO() };
  if ("notes" in patch) updatePayload.notes = patch.notes ?? null;
  if ("cost_category_id" in patch) {
    updatePayload.cost_category_id = patch.cost_category_id ?? null;
  }

  const { error } = await supabase
    .from("payment_lines")
    .update(updatePayload)
    .eq("id", lineId);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchPaymentWithLinesAndComputed(supabase, parent.id);
}

// ---------------------------------------------------------------------------
// unlinkPaymentLineFromInvoice
// ---------------------------------------------------------------------------

export async function unlinkPaymentLineFromInvoice(
  lineId: string,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const line = await fetchPaymentLineById(supabase, lineId);
  if (!line) return failure("NOT_FOUND", "Payment line not found");

  const parent = await fetchActiveById<PaymentRow>(
    supabase,
    "payments",
    line.payment_id,
  );
  if (!parent) return failure("NOT_FOUND", "Parent payment not found");

  const mutableCheck = validatePaymentMutable(parent);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const { error } = await supabase
    .from("payment_lines")
    .update({
      line_type: PAYMENT_LINE_TYPE.general,
      outgoing_invoice_id: null,
      incoming_invoice_id: null,
      loan_id: null,
      updated_at: nowISO(),
    })
    .eq("id", lineId);

  if (error) return failure("VALIDATION_ERROR", error.message);

  return fetchPaymentWithLinesAndComputed(supabase, parent.id);
}

// ---------------------------------------------------------------------------
// splitPaymentLine
// ---------------------------------------------------------------------------

export async function splitPaymentLine(
  lineId: string,
  splits: PaymentLineSplitInput[],
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const line = await fetchPaymentLineById(supabase, lineId);
  if (!line) return failure("NOT_FOUND", "Payment line not found");

  const parent = await fetchActiveById<PaymentRow>(
    supabase,
    "payments",
    line.payment_id,
  );
  if (!parent) return failure("NOT_FOUND", "Parent payment not found");

  const mutableCheck = validatePaymentMutable(parent);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const sumCheck = validateSplitSumToOriginal(
    Number(line.amount),
    Number(line.amount_pen),
    splits,
  );
  if (!sumCheck.success) {
    return sumCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  // For any split that carries an invoice link, validate the currency
  // rule against that invoice.
  const bankAccount = await fetchActiveById<BankAccountRow>(
    supabase,
    "bank_accounts",
    parent.bank_account_id,
  );
  if (!bankAccount) {
    return failure("VALIDATION_ERROR", "Parent payment bank account not found");
  }

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    if (split.outgoing_invoice_id) {
      const inv = await fetchActiveById<OutgoingInvoiceRow>(
        supabase,
        "outgoing_invoices",
        split.outgoing_invoice_id,
      );
      if (!inv) {
        return failure("VALIDATION_ERROR", "Linked outgoing invoice not found", {
          [`splits[${i}].outgoing_invoice_id`]: "Outgoing invoice not found",
        });
      }
      const curCheck = validatePaymentInvoiceCurrency(
        parent.currency,
        inv.currency,
        parent.is_detraction,
        bankAccount.account_type,
      );
      if (!curCheck.success) {
        return curCheck as ValidationResult<PaymentWithLinesAndComputed>;
      }
    }
    if (split.incoming_invoice_id) {
      const inv = await fetchActiveById<IncomingInvoiceRow>(
        supabase,
        "incoming_invoices",
        split.incoming_invoice_id,
      );
      if (!inv) {
        return failure("VALIDATION_ERROR", "Linked incoming invoice not found", {
          [`splits[${i}].incoming_invoice_id`]: "Incoming invoice not found",
        });
      }
      const curCheck = validatePaymentInvoiceCurrency(
        parent.currency,
        inv.currency,
        parent.is_detraction,
        bankAccount.account_type,
      );
      if (!curCheck.success) {
        return curCheck as ValidationResult<PaymentWithLinesAndComputed>;
      }
    }
  }

  // Delete original, insert siblings
  const { error: deleteError } = await supabase
    .from("payment_lines")
    .delete()
    .eq("id", lineId);
  if (deleteError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to delete original line: ${deleteError.message}`,
    );
  }

  const siblingsPayload = splits.map((s, idx) => ({
    payment_id: parent.id,
    sort_order: line.sort_order + idx,
    amount: s.amount,
    amount_pen: s.amount_pen,
    outgoing_invoice_id: s.outgoing_invoice_id ?? null,
    incoming_invoice_id: s.incoming_invoice_id ?? null,
    loan_id: s.loan_id ?? null,
    cost_category_id: s.cost_category_id ?? null,
    line_type: s.line_type,
    notes: s.notes ?? null,
  }));

  const { error: insertError } = await supabase
    .from("payment_lines")
    .insert(siblingsPayload);
  if (insertError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to insert split siblings: ${insertError.message}`,
    );
  }

  // Header totals unchanged by construction — no recompute needed
  return fetchPaymentWithLinesAndComputed(supabase, parent.id);
}

// ---------------------------------------------------------------------------
// linkPaymentLineToInvoice
// ---------------------------------------------------------------------------

export async function linkPaymentLineToInvoice(
  lineId: string,
  invoiceId: string,
  invoiceType: InvoiceType,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const line = await fetchPaymentLineById(supabase, lineId);
  if (!line) return failure("NOT_FOUND", "Payment line not found");

  const parent = await fetchActiveById<PaymentRow>(
    supabase,
    "payments",
    line.payment_id,
  );
  if (!parent) return failure("NOT_FOUND", "Parent payment not found");

  const mutableCheck = validatePaymentMutable(parent);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const bankAccount = await fetchActiveById<BankAccountRow>(
    supabase,
    "bank_accounts",
    parent.bank_account_id,
  );
  if (!bankAccount) {
    return failure("VALIDATION_ERROR", "Parent payment bank account not found");
  }

  const invoiceFetch = await fetchInvoiceForLink(supabase, invoiceId, invoiceType);
  if (!invoiceFetch.success) {
    return failure(invoiceFetch.error.code, invoiceFetch.error.message);
  }
  const invoice = invoiceFetch.data;

  const curCheck = validatePaymentInvoiceCurrency(
    parent.currency,
    invoice.currency,
    parent.is_detraction,
    bankAccount.account_type,
  );
  if (!curCheck.success) {
    return curCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const paidFetch = await fetchCurrentSignedPaid(
    supabase,
    invoiceId,
    invoiceType,
  );
  if (!paidFetch.success) {
    return paidFetch as ValidationResult<PaymentWithLinesAndComputed>;
  }

  const signedContribution = signedContributionForInvoice(
    parent.direction,
    Number(line.amount_pen),
    invoiceType,
  );

  const decision = autoSplitOnOverflow(
    {
      amount: Number(line.amount),
      amount_pen: Number(line.amount_pen),
    },
    paidFetch.data.total_pen,
    paidFetch.data.paid,
    signedContribution,
  );

  const linkColumn =
    invoiceType === "outgoing" ? "outgoing_invoice_id" : "incoming_invoice_id";
  const otherLinkColumns = [
    "outgoing_invoice_id",
    "incoming_invoice_id",
    "loan_id",
  ].filter((c) => c !== linkColumn);

  if (decision.kind === "no_split") {
    const updatePayload: Record<string, unknown> = {
      line_type: PAYMENT_LINE_TYPE.invoice,
      [linkColumn]: invoiceId,
      updated_at: nowISO(),
    };
    for (const col of otherLinkColumns) updatePayload[col] = null;

    const { error } = await supabase
      .from("payment_lines")
      .update(updatePayload)
      .eq("id", lineId);
    if (error) return failure("VALIDATION_ERROR", error.message);

    return fetchPaymentWithLinesAndComputed(supabase, parent.id);
  }

  // Split path: insert Part A (fill) and Part B (remainder), delete original
  const partA = {
    payment_id: parent.id,
    sort_order: line.sort_order,
    amount: decision.fillAmount,
    amount_pen: decision.fillAmountPen,
    outgoing_invoice_id:
      invoiceType === "outgoing" ? invoiceId : null,
    incoming_invoice_id:
      invoiceType === "incoming" ? invoiceId : null,
    loan_id: null,
    cost_category_id: line.cost_category_id,
    line_type: PAYMENT_LINE_TYPE.invoice,
    notes: line.notes,
  };
  const partB = {
    payment_id: parent.id,
    sort_order: line.sort_order + 1,
    amount: decision.remainderAmount,
    amount_pen: decision.remainderAmountPen,
    outgoing_invoice_id: null,
    incoming_invoice_id: null,
    loan_id: null,
    cost_category_id: line.cost_category_id,
    line_type: PAYMENT_LINE_TYPE.general,
    notes: line.notes,
  };

  const { error: deleteError } = await supabase
    .from("payment_lines")
    .delete()
    .eq("id", lineId);
  if (deleteError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to delete original line for auto-split: ${deleteError.message}`,
    );
  }

  const { error: insertError } = await supabase
    .from("payment_lines")
    .insert([partA, partB]);
  if (insertError) {
    return failure(
      "VALIDATION_ERROR",
      `Failed to insert auto-split siblings: ${insertError.message}`,
    );
  }

  // Auto-split preserves amount sum exactly — no recompute needed
  return fetchPaymentWithLinesAndComputed(supabase, parent.id);
}

// ---------------------------------------------------------------------------
// getLinkablePaymentLines
// ---------------------------------------------------------------------------

type LinkablePaymentLine = PaymentLineRow & {
  payment: Pick<
    PaymentRow,
    | "id"
    | "payment_date"
    | "bank_reference"
    | "contact_id"
    | "currency"
    | "is_detraction"
    | "direction"
  >;
};

type LinkableRow = PaymentLineRow & {
  payments:
    | {
        id: string;
        payment_date: string;
        bank_reference: string | null;
        contact_id: string | null;
        currency: string;
        is_detraction: boolean;
        direction: number;
        reconciled: boolean;
        deleted_at: string | null;
      }
    | Array<{
        id: string;
        payment_date: string;
        bank_reference: string | null;
        contact_id: string | null;
        currency: string;
        is_detraction: boolean;
        direction: number;
        reconciled: boolean;
        deleted_at: string | null;
      }>
    | null;
};

function normalizeJoinedPayment<T>(
  p: T | T[] | null,
): T | null {
  if (p == null) return null;
  if (Array.isArray(p)) return p.length > 0 ? p[0] : null;
  return p;
}

export async function getLinkablePaymentLines(
  invoiceId: string,
  invoiceType: InvoiceType,
  include_opposing_direction?: boolean,
): Promise<ValidationResult<LinkablePaymentLine[]>> {
  await requireUser();
  const supabase = await createServerClient();

  const invoiceFetch = await fetchInvoiceForLink(supabase, invoiceId, invoiceType);
  if (!invoiceFetch.success) {
    return failure(invoiceFetch.error.code, invoiceFetch.error.message);
  }
  const invoice = invoiceFetch.data;

  // Resolve the invoice's associated contact id. For incoming invoices the
  // contact is stored directly on the row; for outgoing invoices the client
  // lives on the parent project (project.client_id).
  let invoiceContactId: string | null = null;
  if (invoiceType === "outgoing") {
    const project = await fetchActiveById<ProjectRow>(
      supabase,
      "projects",
      (invoice as OutgoingInvoiceRow).project_id,
    );
    invoiceContactId = project?.client_id ?? null;
  } else {
    invoiceContactId = (invoice as IncomingInvoiceRow).contact_id;
  }

  let query = supabase
    .from("payment_lines")
    .select(
      "*, payments!inner(id, payment_date, bank_reference, contact_id, currency, is_detraction, direction, reconciled, deleted_at)",
    )
    .eq("line_type", PAYMENT_LINE_TYPE.general)
    .is("outgoing_invoice_id", null)
    .is("incoming_invoice_id", null)
    .is("loan_id", null)
    .eq("payments.reconciled", false)
    .is("payments.deleted_at", null);

  if (!include_opposing_direction) {
    const defaultDirection =
      invoiceType === "outgoing"
        ? PAYMENT_DIRECTION.inbound
        : PAYMENT_DIRECTION.outbound;
    query = query.eq("payments.direction", defaultDirection);
  }

  const { data, error } = await query;
  if (error) return failure("NOT_FOUND", "Failed to fetch linkable lines");

  const invoiceCurrency = invoice.currency;

  const rows = (data ?? []) as unknown as LinkableRow[];
  const result: LinkablePaymentLine[] = [];
  for (const row of rows) {
    const payment = normalizeJoinedPayment(row.payments);
    if (!payment) continue;

    // Contact filter: match invoice contact OR payment has no contact
    if (payment.contact_id != null && payment.contact_id !== invoiceContactId) {
      continue;
    }

    // Currency filter: same currency OR PEN-BN-detracción → USD invoice
    const currencyOk =
      payment.currency === invoiceCurrency ||
      (payment.currency === "PEN" &&
        invoiceCurrency === "USD" &&
        payment.is_detraction === true);
    if (!currencyOk) continue;

    const { payments: _omit, ...lineFields } = row;
    void _omit;
    result.push({
      ...(lineFields as PaymentLineRow),
      payment: {
        id: payment.id,
        payment_date: payment.payment_date,
        bank_reference: payment.bank_reference,
        contact_id: payment.contact_id,
        currency: payment.currency,
        is_detraction: payment.is_detraction,
        direction: payment.direction,
      },
    });
  }

  result.sort((a, b) => (a.payment.payment_date < b.payment.payment_date ? 1 : -1));
  return success(result);
}

// ---------------------------------------------------------------------------
// getUnlinkedPaymentLines
// ---------------------------------------------------------------------------

type UnlinkedPaymentLine = PaymentLineRow & {
  payment: Pick<
    PaymentRow,
    | "id"
    | "payment_date"
    | "direction"
    | "contact_id"
    | "bank_reference"
    | "currency"
    | "is_detraction"
    | "reconciled"
  >;
};

type UnlinkedRow = PaymentLineRow & {
  payments:
    | {
        id: string;
        payment_date: string;
        direction: number;
        contact_id: string | null;
        bank_reference: string | null;
        currency: string;
        is_detraction: boolean;
        reconciled: boolean;
        deleted_at: string | null;
      }
    | Array<{
        id: string;
        payment_date: string;
        direction: number;
        contact_id: string | null;
        bank_reference: string | null;
        currency: string;
        is_detraction: boolean;
        reconciled: boolean;
        deleted_at: string | null;
      }>
    | null;
};

export async function getUnlinkedPaymentLines(
  filters?: UnlinkedPaymentLineFilters,
): Promise<ValidationResult<UnlinkedPaymentLine[]>> {
  await requireUser();
  const supabase = await createServerClient();

  let query = supabase
    .from("payment_lines")
    .select(
      "*, payments!inner(id, payment_date, direction, contact_id, bank_reference, currency, is_detraction, reconciled, deleted_at)",
    )
    .eq("line_type", PAYMENT_LINE_TYPE.general)
    .is("outgoing_invoice_id", null)
    .is("incoming_invoice_id", null)
    .is("loan_id", null)
    .is("payments.deleted_at", null);

  if (filters?.direction !== undefined) {
    query = query.eq("payments.direction", filters.direction);
  }
  if (filters?.contact_id) {
    query = query.eq("payments.contact_id", filters.contact_id);
  }
  if (filters?.reconciled !== undefined) {
    query = query.eq("payments.reconciled", filters.reconciled);
  }
  if (filters?.date_from) {
    query = query.gte("payments.payment_date", filters.date_from);
  }
  if (filters?.date_to) {
    query = query.lte("payments.payment_date", filters.date_to);
  }

  const { data, error } = await query;
  if (error) return failure("NOT_FOUND", "Failed to fetch unlinked lines");

  const rows = (data ?? []) as unknown as UnlinkedRow[];
  const result: UnlinkedPaymentLine[] = [];
  for (const row of rows) {
    const payment = normalizeJoinedPayment(row.payments);
    if (!payment) continue;
    const { payments: _omit, ...lineFields } = row;
    void _omit;
    result.push({
      ...(lineFields as PaymentLineRow),
      payment: {
        id: payment.id,
        payment_date: payment.payment_date,
        direction: payment.direction,
        contact_id: payment.contact_id,
        bank_reference: payment.bank_reference,
        currency: payment.currency,
        is_detraction: payment.is_detraction,
        reconciled: payment.reconciled,
      },
    });
  }

  result.sort((a, b) => (a.payment.payment_date < b.payment.payment_date ? 1 : -1));
  return success(result);
}

// ---------------------------------------------------------------------------
// createExpectedInvoiceFromPaymentLine
// ---------------------------------------------------------------------------

export async function createExpectedInvoiceFromPaymentLine(
  lineId: string,
  invoiceData: CreateExpectedInvoiceFromPaymentLineInput,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const line = await fetchPaymentLineById(supabase, lineId);
  if (!line) return failure("NOT_FOUND", "Payment line not found");

  const parent = await fetchActiveById<PaymentRow>(
    supabase,
    "payments",
    line.payment_id,
  );
  if (!parent) return failure("NOT_FOUND", "Parent payment not found");

  const mutableCheck = validatePaymentMutable(parent);
  if (!mutableCheck.success) {
    return mutableCheck as ValidationResult<PaymentWithLinesAndComputed>;
  }

  // Build the CreateIncomingInvoiceInput with factura_status = expected
  const invoiceInput: CreateIncomingInvoiceInput = {
    project_id: invoiceData.project_id ?? null,
    contact_id: invoiceData.contact_id,
    cost_category_id: invoiceData.cost_category_id ?? null,
    factura_status: INCOMING_INVOICE_FACTURA_STATUS.expected,
    currency: invoiceData.currency ?? "PEN",
    exchange_rate: invoiceData.exchange_rate ?? null,
    subtotal: invoiceData.subtotal,
    igv_amount: invoiceData.igv_amount,
    total: invoiceData.total,
    total_pen: invoiceData.total_pen,
    detraction_rate: invoiceData.detraction_rate ?? null,
    detraction_amount: invoiceData.detraction_amount ?? null,
    notes: invoiceData.notes ?? null,
  };

  const validation = validateIncomingInvoice(invoiceInput);
  if (!validation.success) {
    return validation as ValidationResult<PaymentWithLinesAndComputed>;
  }

  // Auto-fill exchange rate for USD if missing — use the payment's date
  // as the anchor since there's no issue_date yet
  let exchangeRate: number | null = invoiceInput.exchange_rate ?? null;
  if (invoiceInput.currency === "USD" && exchangeRate == null) {
    const rateLookup = await requireExactExchangeRate(parent.payment_date);
    if (!rateLookup.success) {
      return rateLookup as ValidationResult<PaymentWithLinesAndComputed>;
    }
    exchangeRate = rateLookup.data.rate;
  }

  const totalPen =
    invoiceInput.total_pen ??
    (invoiceInput.currency === "PEN"
      ? invoiceInput.total
      : Math.round(invoiceInput.total * Number(exchangeRate ?? 0) * 100) / 100);

  const insertPayload = {
    project_id: invoiceInput.project_id ?? null,
    contact_id: invoiceInput.contact_id,
    cost_category_id: invoiceInput.cost_category_id ?? null,
    factura_status: INCOMING_INVOICE_FACTURA_STATUS.expected,
    currency: invoiceInput.currency,
    exchange_rate: exchangeRate,
    subtotal: invoiceInput.subtotal,
    igv_amount: invoiceInput.igv_amount,
    total: invoiceInput.total,
    total_pen: totalPen,
    detraction_rate: invoiceInput.detraction_rate ?? null,
    detraction_amount: invoiceInput.detraction_amount ?? null,
    notes: invoiceInput.notes ?? null,
    source: 1, // manual
  };

  const { data: inserted, error: insertError } = await supabase
    .from("incoming_invoices")
    .insert(insertPayload)
    .select()
    .single();

  if (insertError || !inserted) {
    return failure(
      "VALIDATION_ERROR",
      insertError?.message ?? "Failed to insert expected invoice",
    );
  }

  const insertedInvoice = inserted as IncomingInvoiceRow;

  // Now link the existing payment line to the newly created invoice
  const linkResult = await linkPaymentLineToInvoice(
    lineId,
    insertedInvoice.id,
    "incoming",
  );

  if (!linkResult.success) {
    // Best-effort cleanup: soft-delete the just-inserted invoice
    const deletedAt = nowISO();
    await supabase
      .from("incoming_invoices")
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq("id", insertedInvoice.id);
    return linkResult;
  }

  return linkResult;
}
