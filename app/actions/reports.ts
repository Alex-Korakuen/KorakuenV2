"use server";

/**
 * Reporting server actions — Step 12.
 *
 * Three admin-only endpoints that consolidate derived reads for the
 * dashboard and partner-settlement flows. Canonical formulas live in
 * docs/api-design-principles.md under "Formulas"; this file is a thin
 * translation of those formulas into Supabase queries.
 *
 * Invoice payment progress is delegated to the batch helpers in
 * lib/outgoing-invoice-computed.ts and lib/incoming-invoice-computed.ts
 * so the signed-sum semantics (refunds, self-detracciones) stay
 * consistent across the codebase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import {
  success,
  failure,
  PAYMENT_DIRECTION,
  ACCOUNT_TYPE,
  OUTGOING_INVOICE_STATUS,
  INCOMING_INVOICE_FACTURA_STATUS,
} from "@/lib/types";
import type { ValidationResult } from "@/lib/types";
import { computeOutgoingInvoicePaymentProgressBatch } from "@/lib/outgoing-invoice-computed";
import { computeIncomingInvoicePaymentProgressBatch } from "@/lib/incoming-invoice-computed";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type ProjectSummary = {
  project: {
    id: string;
    name: string;
    code: string | null;
    status: number;
    client_id: string;
    client_razon_social: string;
    client_nombre_comercial: string | null;
  };
  contract_currency: string;
  contract_value_original: number | null;
  contract_exchange_rate: number | null;
  contract_value_pen: number;
  estimated_cost_pen: number;
  actual_spend_pen: number;
  invoiced_pen: number;
  collected_pen: number;
  expected_margin_pen: number;
  actual_margin_pen: number;
  cost_by_partner: Array<{
    partner_id: string | null;
    contact_id: string | null;
    company_label: string | null;
    contact_razon_social: string | null;
    costs_pen: number;
  }>;
};

export type Settlement = {
  project: {
    id: string;
    name: string;
    code: string | null;
    status: number;
  };
  revenue_pen: number;
  total_costs_pen: number;
  gross_profit_pen: number;
  profit_split_total_pct: number;
  partners: Array<{
    partner_id: string;
    contact_id: string;
    company_label: string;
    contact_razon_social: string;
    profit_split_pct: number;
    costs_by_partner_pen: number;
    profit_share_pen: number;
    total_owed_pen: number;
  }>;
  unassigned_costs_pen: number;
};

export type LoanStatus = "active" | "partially_repaid" | "settled";

export type FinancialPosition = {
  generated_at: string;
  period_start: string;
  period_end: string;
  cash: {
    regular_total_pen: number;
    bn_total_pen: number;
    total_pen: number;
    accounts: Array<{
      bank_account_id: string;
      name: string;
      bank_name: string;
      currency: string;
      account_type: number;
      balance_pen: number;
    }>;
  };
  igv: {
    period_start: string;
    period_end: string;
    output_pen: number;
    input_pen: number;
    net_pen: number;
  };
  loans: {
    total_outstanding_pen: number;
    items: Array<{
      loan_id: string;
      project_id: string;
      borrowing_partner_id: string;
      borrowing_partner_razon_social: string;
      lender_contact_id: string;
      lender_razon_social: string;
      principal_pen: number;
      repaid_pen: number;
      outstanding_pen: number;
      status: LoanStatus;
      disbursement_date: string;
      due_date: string | null;
    }>;
  };
  receivables: {
    total_outstanding_pen: number;
    by_client: Array<{
      contact_id: string;
      razon_social: string;
      nombre_comercial: string | null;
      outstanding_pen: number;
      invoice_count: number;
    }>;
  };
  payables: {
    total_outstanding_pen: number;
    by_vendor: Array<{
      contact_id: string;
      razon_social: string;
      nombre_comercial: string | null;
      outstanding_pen: number;
      invoice_count: number;
    }>;
  };
  chase_list: {
    total_paid_pen: number;
    items: Array<{
      incoming_invoice_id: string;
      contact_id: string;
      vendor_razon_social: string;
      project_id: string | null;
      total_pen: number;
      paid_pen: number;
      notes: string | null;
      created_at: string;
    }>;
  };
};

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deriveContractValuePen(p: {
  contract_value: number | null;
  contract_currency: string;
  contract_exchange_rate: number | null;
}): number {
  const value = Number(p.contract_value ?? 0);
  if (p.contract_currency === "PEN") return value;
  return value * Number(p.contract_exchange_rate ?? 0);
}

function firstOfCurrentMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function pickOne<T>(value: T | T[] | null): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function fetchContactNames(
  supabase: SupabaseClient,
  ids: string[],
): Promise<
  Map<string, { razon_social: string; nombre_comercial: string | null }>
> {
  const out = new Map<
    string,
    { razon_social: string; nombre_comercial: string | null }
  >();
  if (ids.length === 0) return out;
  const { data } = await supabase
    .from("contacts")
    .select("id, razon_social, nombre_comercial")
    .in("id", ids);
  for (const c of (data ?? []) as Array<{
    id: string;
    razon_social: string;
    nombre_comercial: string | null;
  }>) {
    out.set(c.id, {
      razon_social: c.razon_social,
      nombre_comercial: c.nombre_comercial,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// getProjectSummary
// ---------------------------------------------------------------------------

export async function getProjectSummary(
  projectId: string,
): Promise<ValidationResult<ProjectSummary>> {
  await requireAdmin();
  const supabase = await createServerClient();

  type ProjectQueryRow = {
    id: string;
    name: string;
    code: string | null;
    status: number;
    client_id: string;
    contract_value: number | null;
    contract_currency: string;
    contract_exchange_rate: number | null;
    client:
      | {
          id: string;
          razon_social: string;
          nombre_comercial: string | null;
        }
      | Array<{
          id: string;
          razon_social: string;
          nombre_comercial: string | null;
        }>
      | null;
  };

  const { data: projectRaw, error: projErr } = await supabase
    .from("projects")
    .select(
      "id, name, code, status, client_id, contract_value, contract_currency, contract_exchange_rate, client:contacts!projects_client_id_fkey(id, razon_social, nombre_comercial)",
    )
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (projErr || !projectRaw) {
    return failure("NOT_FOUND", "Project not found");
  }
  const project = projectRaw as unknown as ProjectQueryRow;
  const client = pickOne(project.client);

  // Budgets → estimated cost
  const { data: budgetRows } = await supabase
    .from("project_budgets")
    .select("budgeted_amount_pen")
    .eq("project_id", projectId)
    .is("deleted_at", null);
  const estimated_cost_pen = (budgetRows ?? []).reduce(
    (acc, r) =>
      acc + Number((r as { budgeted_amount_pen: number }).budgeted_amount_pen),
    0,
  );

  // Invoices → invoiced total (exclude void; drafts still count)
  const { data: invoiceRows } = await supabase
    .from("outgoing_invoices")
    .select("total_pen")
    .eq("project_id", projectId)
    .neq("status", OUTGOING_INVOICE_STATUS.void)
    .is("deleted_at", null);
  const invoiced_pen = (invoiceRows ?? []).reduce(
    (acc, r) => acc + Number((r as { total_pen: number }).total_pen),
    0,
  );

  // Payments → collected, actual_spend, per-partner cost map
  const { data: paymentRows } = await supabase
    .from("payments")
    .select("direction, total_amount_pen, paid_by_partner_id")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  let collected_pen = 0;
  let actual_spend_pen = 0;
  const costByContact = new Map<string | null, number>();
  for (const row of (paymentRows ?? []) as Array<{
    direction: number;
    total_amount_pen: number;
    paid_by_partner_id: string | null;
  }>) {
    const amt = Number(row.total_amount_pen);
    if (row.direction === PAYMENT_DIRECTION.inbound) {
      collected_pen += amt;
    } else if (row.direction === PAYMENT_DIRECTION.outbound) {
      actual_spend_pen += amt;
      const key = row.paid_by_partner_id ?? null;
      costByContact.set(key, (costByContact.get(key) ?? 0) + amt);
    }
  }

  // Partner roster for labels
  const { data: partnerRows } = await supabase
    .from("project_partners")
    .select(
      "id, contact_id, company_label, contact:contacts!project_partners_contact_id_fkey(id, razon_social)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);
  const partnerByContact = new Map<
    string,
    { partner_id: string; company_label: string; contact_razon_social: string }
  >();
  for (const raw of (partnerRows ?? []) as Array<{
    id: string;
    contact_id: string;
    company_label: string;
    contact:
      | { id: string; razon_social: string }
      | Array<{ id: string; razon_social: string }>
      | null;
  }>) {
    const contact = pickOne(raw.contact);
    partnerByContact.set(raw.contact_id, {
      partner_id: raw.id,
      company_label: raw.company_label,
      contact_razon_social: contact?.razon_social ?? "",
    });
  }

  // Contacts referenced in payments but not on the partner roster — fetch names
  const orphanContactIds = new Set<string>();
  for (const key of costByContact.keys()) {
    if (key && !partnerByContact.has(key)) orphanContactIds.add(key);
  }
  const orphanNames = await fetchContactNames(
    supabase,
    Array.from(orphanContactIds),
  );

  const cost_by_partner: ProjectSummary["cost_by_partner"] = [];
  for (const [contactId, amount] of costByContact) {
    if (contactId === null) {
      cost_by_partner.push({
        partner_id: null,
        contact_id: null,
        company_label: null,
        contact_razon_social: null,
        costs_pen: round2(amount),
      });
      continue;
    }
    const partner = partnerByContact.get(contactId);
    cost_by_partner.push({
      partner_id: partner?.partner_id ?? null,
      contact_id: contactId,
      company_label: partner?.company_label ?? null,
      contact_razon_social:
        partner?.contact_razon_social ??
        orphanNames.get(contactId)?.razon_social ??
        null,
      costs_pen: round2(amount),
    });
  }
  cost_by_partner.sort((a, b) => b.costs_pen - a.costs_pen);

  const contract_value_pen = deriveContractValuePen({
    contract_value: project.contract_value,
    contract_currency: project.contract_currency,
    contract_exchange_rate: project.contract_exchange_rate,
  });

  return success({
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      status: project.status,
      client_id: project.client_id,
      client_razon_social: client?.razon_social ?? "",
      client_nombre_comercial: client?.nombre_comercial ?? null,
    },
    contract_currency: project.contract_currency,
    contract_value_original:
      project.contract_value == null ? null : Number(project.contract_value),
    contract_exchange_rate:
      project.contract_exchange_rate == null
        ? null
        : Number(project.contract_exchange_rate),
    contract_value_pen: round2(contract_value_pen),
    estimated_cost_pen: round2(estimated_cost_pen),
    actual_spend_pen: round2(actual_spend_pen),
    invoiced_pen: round2(invoiced_pen),
    collected_pen: round2(collected_pen),
    expected_margin_pen: round2(contract_value_pen - estimated_cost_pen),
    actual_margin_pen: round2(contract_value_pen - actual_spend_pen),
    cost_by_partner,
  });
}

// ---------------------------------------------------------------------------
// getSettlement
// ---------------------------------------------------------------------------

export async function getSettlement(
  projectId: string,
): Promise<ValidationResult<Settlement>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data: projectRaw, error: projErr } = await supabase
    .from("projects")
    .select("id, name, code, status")
    .eq("id", projectId)
    .is("deleted_at", null)
    .single();
  if (projErr || !projectRaw) {
    return failure("NOT_FOUND", "Project not found");
  }
  const project = projectRaw as {
    id: string;
    name: string;
    code: string | null;
    status: number;
  };

  const { data: partnerRows } = await supabase
    .from("project_partners")
    .select(
      "id, contact_id, company_label, profit_split_pct, contact:contacts!project_partners_contact_id_fkey(razon_social)",
    )
    .eq("project_id", projectId)
    .is("deleted_at", null);

  const { data: paymentRows } = await supabase
    .from("payments")
    .select("direction, total_amount_pen, paid_by_partner_id")
    .eq("project_id", projectId)
    .is("deleted_at", null);

  let revenue_pen = 0;
  let total_costs_pen = 0;
  const costByContact = new Map<string | null, number>();
  for (const row of (paymentRows ?? []) as Array<{
    direction: number;
    total_amount_pen: number;
    paid_by_partner_id: string | null;
  }>) {
    const amt = Number(row.total_amount_pen);
    if (row.direction === PAYMENT_DIRECTION.inbound) {
      revenue_pen += amt;
    } else if (row.direction === PAYMENT_DIRECTION.outbound) {
      total_costs_pen += amt;
      const key = row.paid_by_partner_id ?? null;
      costByContact.set(key, (costByContact.get(key) ?? 0) + amt);
    }
  }
  const gross_profit_pen = round2(revenue_pen - total_costs_pen);

  let profit_split_total_pct = 0;
  const partners: Settlement["partners"] = [];
  for (const raw of (partnerRows ?? []) as Array<{
    id: string;
    contact_id: string;
    company_label: string;
    profit_split_pct: number;
    contact:
      | { razon_social: string }
      | Array<{ razon_social: string }>
      | null;
  }>) {
    const contact = pickOne(raw.contact);
    const costs = costByContact.get(raw.contact_id) ?? 0;
    costByContact.delete(raw.contact_id);
    const pct = Number(raw.profit_split_pct);
    profit_split_total_pct += pct;
    const profit_share = round2(gross_profit_pen * (pct / 100));
    const costs_rounded = round2(costs);
    partners.push({
      partner_id: raw.id,
      contact_id: raw.contact_id,
      company_label: raw.company_label,
      contact_razon_social: contact?.razon_social ?? "",
      profit_split_pct: pct,
      costs_by_partner_pen: costs_rounded,
      profit_share_pen: profit_share,
      total_owed_pen: round2(costs_rounded + profit_share),
    });
  }

  let unassigned_costs_pen = 0;
  for (const amt of costByContact.values()) unassigned_costs_pen += amt;

  return success({
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      status: project.status,
    },
    revenue_pen: round2(revenue_pen),
    total_costs_pen: round2(total_costs_pen),
    gross_profit_pen,
    profit_split_total_pct: round2(profit_split_total_pct),
    partners,
    unassigned_costs_pen: round2(unassigned_costs_pen),
  });
}

// ---------------------------------------------------------------------------
// getFinancialPosition
// ---------------------------------------------------------------------------

export async function getFinancialPosition(
  periodStart?: string,
  periodEnd?: string,
): Promise<ValidationResult<FinancialPosition>> {
  await requireAdmin();
  const supabase = await createServerClient();

  // Period defaults and validation
  const period_start = periodStart ?? firstOfCurrentMonth();
  const period_end = periodEnd ?? todayISO();
  if (!isValidIsoDate(period_start) || !isValidIsoDate(period_end)) {
    return failure(
      "VALIDATION_ERROR",
      "Invalid period date (expected YYYY-MM-DD)",
      {
        period_start: isValidIsoDate(period_start) ? "" : "Invalid date",
        period_end: isValidIsoDate(period_end) ? "" : "Invalid date",
      },
    );
  }
  if (period_start > period_end) {
    return failure(
      "VALIDATION_ERROR",
      "period_start must be <= period_end",
      { period_start: "Start must be before or equal to end" },
    );
  }

  // --- Cash -----------------------------------------------------------------

  const { data: bankRows } = await supabase
    .from("bank_accounts")
    .select("id, name, bank_name, currency, account_type")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  const banks = (bankRows ?? []) as Array<{
    id: string;
    name: string;
    bank_name: string;
    currency: string;
    account_type: number;
  }>;

  const balanceMap = new Map<string, number>();
  if (banks.length > 0) {
    const { data: balances } = await supabase.rpc(
      "get_bank_account_balances",
      { account_ids: banks.map((b) => b.id) },
    );
    for (const b of (balances ?? []) as Array<{
      bank_account_id: string;
      balance_pen: number;
    }>) {
      balanceMap.set(b.bank_account_id, Number(b.balance_pen));
    }
  }

  let regular_total_pen = 0;
  let bn_total_pen = 0;
  const cashAccounts = banks.map((b) => {
    const balance = balanceMap.get(b.id) ?? 0;
    if (b.account_type === ACCOUNT_TYPE.regular) regular_total_pen += balance;
    else if (b.account_type === ACCOUNT_TYPE.banco_de_la_nacion)
      bn_total_pen += balance;
    return {
      bank_account_id: b.id,
      name: b.name,
      bank_name: b.bank_name,
      currency: b.currency,
      account_type: b.account_type,
      balance_pen: round2(balance),
    };
  });

  // --- IGV position ---------------------------------------------------------
  // Formula: docs/api-design-principles.md:266-286
  // Output uses `issue_date`; input uses `fecha_emision` (the SUNAT-facing
  // date, only populated once factura_status=received).
  //
  // Scope: Korakuen's own SUNAT return only. Rows with a non-null partner_id
  // belong to a different consortium member and are excluded — that partner
  // files its own return. A future "consortium-wide" toggle can drop the
  // filter when Alex needs the pooled view.

  const { data: igvOutRows } = await supabase
    .from("outgoing_invoices")
    .select("igv_amount")
    .eq("status", OUTGOING_INVOICE_STATUS.sent)
    .in("estado_sunat", ["accepted", "aceptado"])
    .gte("issue_date", period_start)
    .lte("issue_date", period_end)
    .is("partner_id", null)
    .is("deleted_at", null);
  const igv_output_pen = (igvOutRows ?? []).reduce(
    (acc, r) => acc + Number((r as { igv_amount: number }).igv_amount),
    0,
  );

  const { data: igvInRows } = await supabase
    .from("incoming_invoices")
    .select("igv_amount")
    .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.received)
    .gte("fecha_emision", period_start)
    .lte("fecha_emision", period_end)
    .is("partner_id", null)
    .is("deleted_at", null);
  const igv_input_pen = (igvInRows ?? []).reduce(
    (acc, r) => acc + Number((r as { igv_amount: number }).igv_amount),
    0,
  );

  // --- Loans ----------------------------------------------------------------
  // Signed repaid sum — mirrors the invoice-computed helpers at
  // lib/outgoing-invoice-computed.ts:42-50 so lender refunds correctly
  // reduce repaid. The doc's simplified pseudocode at
  // docs/api-design-principles.md:297-310 shows unsigned; we pick the
  // stricter formulation for codebase consistency.

  const { data: loanRaw } = await supabase
    .from("loans")
    .select(
      "id, project_id, borrowing_partner_id, lender_contact_id, principal_amount_pen, disbursement_date, due_date, borrower:contacts!loans_borrowing_partner_id_fkey(razon_social), lender:contacts!loans_lender_contact_id_fkey(razon_social)",
    )
    .is("deleted_at", null);
  const loans = (loanRaw ?? []) as Array<{
    id: string;
    project_id: string;
    borrowing_partner_id: string;
    lender_contact_id: string;
    principal_amount_pen: number;
    disbursement_date: string;
    due_date: string | null;
    borrower:
      | { razon_social: string }
      | Array<{ razon_social: string }>
      | null;
    lender:
      | { razon_social: string }
      | Array<{ razon_social: string }>
      | null;
  }>;

  const repaidByLoan = new Map<string, number>();
  if (loans.length > 0) {
    const { data: loanLines } = await supabase
      .from("payment_lines")
      .select(
        "loan_id, amount_pen, payments!inner(direction, deleted_at)",
      )
      .in(
        "loan_id",
        loans.map((l) => l.id),
      )
      .is("payments.deleted_at", null);
    for (const row of (loanLines ?? []) as Array<{
      loan_id: string;
      amount_pen: number;
      payments:
        | { direction: number | null }
        | Array<{ direction: number | null }>
        | null;
    }>) {
      const payment = pickOne(row.payments);
      const dir = payment?.direction ?? null;
      const amt = Number(row.amount_pen);
      let signed = 0;
      if (dir === PAYMENT_DIRECTION.outbound) signed = amt;
      else if (dir === PAYMENT_DIRECTION.inbound) signed = -amt;
      repaidByLoan.set(
        row.loan_id,
        (repaidByLoan.get(row.loan_id) ?? 0) + signed,
      );
    }
  }

  let loans_total_outstanding_pen = 0;
  const loanItems: FinancialPosition["loans"]["items"] = loans.map((l) => {
    const repaid = repaidByLoan.get(l.id) ?? 0;
    const principal = Number(l.principal_amount_pen);
    const outstanding = principal - repaid;
    let status: LoanStatus;
    if (repaid <= 0) status = "active";
    else if (repaid < principal) status = "partially_repaid";
    else status = "settled";
    loans_total_outstanding_pen += outstanding;
    const borrower = pickOne(l.borrower);
    const lender = pickOne(l.lender);
    return {
      loan_id: l.id,
      project_id: l.project_id,
      borrowing_partner_id: l.borrowing_partner_id,
      borrowing_partner_razon_social: borrower?.razon_social ?? "",
      lender_contact_id: l.lender_contact_id,
      lender_razon_social: lender?.razon_social ?? "",
      principal_pen: round2(principal),
      repaid_pen: round2(repaid),
      outstanding_pen: round2(outstanding),
      status,
      disbursement_date: l.disbursement_date,
      due_date: l.due_date,
    };
  });

  // --- Receivables ----------------------------------------------------------
  // outgoing_invoices has no direct contact_id; clients come via
  // projects.client_id. Join through the project. Scope: Korakuen's own
  // receivables only (partner_id IS NULL). Partner-owned invoices are
  // visible in the project view but not counted here.

  const { data: outRaw } = await supabase
    .from("outgoing_invoices")
    .select(
      "id, total_pen, estado_sunat, project:projects!outgoing_invoices_project_id_fkey(client_id)",
    )
    .neq("status", OUTGOING_INVOICE_STATUS.void)
    .is("partner_id", null)
    .is("deleted_at", null);
  const outInvoices = (outRaw ?? []) as Array<{
    id: string;
    total_pen: number;
    estado_sunat: string | null;
    project:
      | { client_id: string }
      | Array<{ client_id: string }>
      | null;
  }>;
  const outComputed = await computeOutgoingInvoicePaymentProgressBatch(
    supabase,
    outInvoices.map((i) => ({
      id: i.id,
      total_pen: i.total_pen,
      estado_sunat: i.estado_sunat,
    })),
  );

  const receivableByClient = new Map<
    string,
    { outstanding_pen: number; invoice_count: number }
  >();
  for (const inv of outInvoices) {
    const computed = outComputed.get(inv.id);
    if (!computed || computed.outstanding <= 0) continue;
    const project = pickOne(inv.project);
    const clientId = project?.client_id;
    if (!clientId) continue;
    const entry = receivableByClient.get(clientId) ?? {
      outstanding_pen: 0,
      invoice_count: 0,
    };
    entry.outstanding_pen += computed.outstanding;
    entry.invoice_count += 1;
    receivableByClient.set(clientId, entry);
  }

  const receivableContactNames = await fetchContactNames(
    supabase,
    Array.from(receivableByClient.keys()),
  );
  let receivables_total_outstanding_pen = 0;
  const receivableItems: FinancialPosition["receivables"]["by_client"] =
    Array.from(receivableByClient.entries()).map(([contactId, v]) => {
      const name = receivableContactNames.get(contactId);
      receivables_total_outstanding_pen += v.outstanding_pen;
      return {
        contact_id: contactId,
        razon_social: name?.razon_social ?? "",
        nombre_comercial: name?.nombre_comercial ?? null,
        outstanding_pen: round2(v.outstanding_pen),
        invoice_count: v.invoice_count,
      };
    });
  receivableItems.sort((a, b) => b.outstanding_pen - a.outstanding_pen);

  // --- Payables -------------------------------------------------------------

  // Scope: Korakuen's own payables only (partner_id IS NULL). Partner-owned
  // invoices are excluded — they belong to a different consortium member.
  const { data: inReceivedRaw } = await supabase
    .from("incoming_invoices")
    .select("id, contact_id, total_pen, factura_status")
    .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.received)
    .is("partner_id", null)
    .is("deleted_at", null);
  const inReceived = (inReceivedRaw ?? []) as Array<{
    id: string;
    contact_id: string;
    total_pen: number;
    factura_status: number;
  }>;
  const inReceivedComputed = await computeIncomingInvoicePaymentProgressBatch(
    supabase,
    inReceived.map((i) => ({
      id: i.id,
      total_pen: i.total_pen,
      factura_status: i.factura_status,
    })),
  );

  const payableByVendor = new Map<
    string,
    { outstanding_pen: number; invoice_count: number }
  >();
  for (const inv of inReceived) {
    const computed = inReceivedComputed.get(inv.id);
    if (!computed || computed.outstanding <= 0) continue;
    const entry = payableByVendor.get(inv.contact_id) ?? {
      outstanding_pen: 0,
      invoice_count: 0,
    };
    entry.outstanding_pen += computed.outstanding;
    entry.invoice_count += 1;
    payableByVendor.set(inv.contact_id, entry);
  }

  const payableContactNames = await fetchContactNames(
    supabase,
    Array.from(payableByVendor.keys()),
  );
  let payables_total_outstanding_pen = 0;
  const payableItems: FinancialPosition["payables"]["by_vendor"] = Array.from(
    payableByVendor.entries(),
  ).map(([contactId, v]) => {
    const name = payableContactNames.get(contactId);
    payables_total_outstanding_pen += v.outstanding_pen;
    return {
      contact_id: contactId,
      razon_social: name?.razon_social ?? "",
      nombre_comercial: name?.nombre_comercial ?? null,
      outstanding_pen: round2(v.outstanding_pen),
      invoice_count: v.invoice_count,
    };
  });
  payableItems.sort((a, b) => b.outstanding_pen - a.outstanding_pen);

  // --- Chase list -----------------------------------------------------------

  // Chase list is also scoped to Korakuen's own expected invoices.
  const { data: inExpectedRaw } = await supabase
    .from("incoming_invoices")
    .select(
      "id, contact_id, project_id, total_pen, factura_status, notes, created_at, vendor:contacts!incoming_invoices_contact_id_fkey(razon_social)",
    )
    .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.expected)
    .is("partner_id", null)
    .is("deleted_at", null);
  const inExpected = (inExpectedRaw ?? []) as Array<{
    id: string;
    contact_id: string;
    project_id: string | null;
    total_pen: number;
    factura_status: number;
    notes: string | null;
    created_at: string;
    vendor:
      | { razon_social: string }
      | Array<{ razon_social: string }>
      | null;
  }>;
  const inExpectedComputed = await computeIncomingInvoicePaymentProgressBatch(
    supabase,
    inExpected.map((i) => ({
      id: i.id,
      total_pen: i.total_pen,
      factura_status: i.factura_status,
    })),
  );

  let chase_total_paid_pen = 0;
  const chaseItems: FinancialPosition["chase_list"]["items"] = [];
  for (const inv of inExpected) {
    const computed = inExpectedComputed.get(inv.id);
    if (!computed || !computed.needs_factura) continue;
    const vendor = pickOne(inv.vendor);
    chase_total_paid_pen += computed.paid;
    chaseItems.push({
      incoming_invoice_id: inv.id,
      contact_id: inv.contact_id,
      vendor_razon_social: vendor?.razon_social ?? "",
      project_id: inv.project_id,
      total_pen: round2(Number(inv.total_pen)),
      paid_pen: round2(computed.paid),
      notes: inv.notes,
      created_at: inv.created_at,
    });
  }
  chaseItems.sort((a, b) => b.paid_pen - a.paid_pen);

  return success({
    generated_at: new Date().toISOString(),
    period_start,
    period_end,
    cash: {
      regular_total_pen: round2(regular_total_pen),
      bn_total_pen: round2(bn_total_pen),
      total_pen: round2(regular_total_pen + bn_total_pen),
      accounts: cashAccounts,
    },
    igv: {
      period_start,
      period_end,
      output_pen: round2(igv_output_pen),
      input_pen: round2(igv_input_pen),
      net_pen: round2(igv_output_pen - igv_input_pen),
    },
    loans: {
      total_outstanding_pen: round2(loans_total_outstanding_pen),
      items: loanItems,
    },
    receivables: {
      total_outstanding_pen: round2(receivables_total_outstanding_pen),
      by_client: receivableItems,
    },
    payables: {
      total_outstanding_pen: round2(payables_total_outstanding_pen),
      by_vendor: payableItems,
    },
    chase_list: {
      total_paid_pen: round2(chase_total_paid_pen),
      items: chaseItems,
    },
  });
}
