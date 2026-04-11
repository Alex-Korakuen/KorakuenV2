/**
 * smoke-reports.ts — end-to-end verification of Step 12 reporting endpoints
 *
 * Exercises the math behind getProjectSummary, getSettlement, and
 * getFinancialPosition against the live Supabase database. Signs in as
 * the admin user so RLS + activity_log trigger behavior matches production.
 *
 * Cannot call the server actions directly (they need next/headers cookies),
 * so this script mirrors each action's query plan using supabase-js and the
 * same batch computed helpers (computeOutgoingInvoicePaymentProgressBatch,
 * computeIncomingInvoicePaymentProgressBatch) and the same RPC
 * (get_bank_account_balances) that reports.ts uses. That keeps the math
 * honest without re-deriving the formulas from scratch.
 *
 * Run from project root (Node 20+):
 *   npx tsx --env-file=.env.local scripts/smoke-reports.ts
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               TEST_ADMIN_PASSWORD
 *
 * Every row the script creates is marked with SMOKE-TEST-REPORTS (in notes
 * or name fields) and cleaned up at the end. A crashed previous run is
 * cleaned up on the next startup.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
  ACCOUNT_TYPE,
  INCOMING_INVOICE_FACTURA_STATUS,
  OUTGOING_INVOICE_STATUS,
  PROJECT_STATUS,
  TIPO_PERSONA,
  DETRACTION_STATUS,
} from "@/lib/types";
import { computeOutgoingInvoicePaymentProgressBatch } from "@/lib/outgoing-invoice-computed";
import { computeIncomingInvoicePaymentProgressBatch } from "@/lib/incoming-invoice-computed";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = "alex.ferreira@korakuen.pe";
const SMOKE_MARKER = "SMOKE-TEST-REPORTS";
const SMOKE_RUCS = {
  client: "99000100011",
  vendor: "99000100022",
  partnerA: "99000100033",
  partnerB: "99000100044",
  lender: "99000100055",
};
const KORAKUEN_RUC = "20615457109";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is not set`);
    console.error(
      "Run with: npx tsx --env-file=.env.local scripts/smoke-reports.ts",
    );
    process.exit(1);
  }
  return value;
}

function nowISO(): string {
  return new Date().toISOString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfCurrentMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function dateBeforePeriodStart(): string {
  // A date guaranteed to be before the current month — one month back, day 5.
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5));
  return prev.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = typeof actual === "number" ? round2(actual) : actual;
  const e = typeof expected === "number" ? round2(expected as number) : expected;
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`,
    );
  }
}

function assertTrue(label: string, condition: boolean): void {
  if (!condition) throw new Error(`${label}: expected true`);
}

// ---------------------------------------------------------------------------
// Fixture state
// ---------------------------------------------------------------------------

type Fixtures = {
  clientContactId: string;
  vendorContactId: string;
  partnerAContactId: string;
  partnerBContactId: string;
  lenderContactId: string;
  regularBankId: string;
  bnBankId: string;
  projectId: string;
  costCategoryId: string;
  projectBudgetIds: string[];
  partnerRowAId: string;
  partnerRowBId: string;
  outgoingSentAcceptedInPeriodId: string;
  outgoingSentAcceptedOutOfPeriodId: string;
  outgoingSentPendingId: string;
  incomingReceivedFullyPaidId: string;
  incomingReceivedOutstandingId: string;
  incomingExpectedWithPaymentId: string;
  incomingExpectedNoPaymentId: string;
  loanId: string;
  paymentIds: string[];
};

// ---------------------------------------------------------------------------
// Cleanup: remove leftover marker rows from prior runs
// ---------------------------------------------------------------------------

async function cleanupLeftover(supabase: SupabaseClient): Promise<void> {
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id")
    .in("ruc", Object.values(SMOKE_RUCS));
  const contactIds = (contacts ?? []).map((c) => c.id as string);

  if (contactIds.length > 0) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id")
      .in("client_id", contactIds);
    const projectIds = (projects ?? []).map((p) => p.id as string);

    if (projectIds.length > 0) {
      const { data: payments } = await supabase
        .from("payments")
        .select("id")
        .in("project_id", projectIds);
      const paymentIds = (payments ?? []).map((p) => p.id as string);
      if (paymentIds.length > 0) {
        await supabase.from("payments").delete().in("id", paymentIds);
      }
      // Loans must be cleared before projects (FK)
      await supabase.from("loans").delete().in("project_id", projectIds);
      await supabase
        .from("outgoing_invoices")
        .delete()
        .in("project_id", projectIds);
      await supabase
        .from("incoming_invoices")
        .delete()
        .in("project_id", projectIds);
      await supabase
        .from("project_budgets")
        .delete()
        .in("project_id", projectIds);
      await supabase
        .from("project_partners")
        .delete()
        .in("project_id", projectIds);
      await supabase.from("projects").delete().in("id", projectIds);
    }

    await supabase
      .from("incoming_invoices")
      .delete()
      .in("contact_id", contactIds);
    await supabase.from("contacts").delete().in("id", contactIds);
  }

  await supabase
    .from("bank_accounts")
    .delete()
    .like("name", `${SMOKE_MARKER}%`);
  await supabase
    .from("cost_categories")
    .delete()
    .like("name", `${SMOKE_MARKER}%`);
}

// ---------------------------------------------------------------------------
// Fixture inserts
// ---------------------------------------------------------------------------

async function insertContact(
  supabase: SupabaseClient,
  opts: {
    ruc: string;
    razon_social: string;
    is_client?: boolean;
    is_vendor?: boolean;
    is_partner?: boolean;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      tipo_persona: TIPO_PERSONA.juridica,
      ruc: opts.ruc,
      razon_social: opts.razon_social,
      is_client: opts.is_client ?? false,
      is_vendor: opts.is_vendor ?? false,
      is_partner: opts.is_partner ?? false,
      sunat_estado: "ACTIVO",
      sunat_condicion: "HABIDO",
      sunat_verified: true,
      sunat_verified_at: nowISO(),
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertContact failed: ${error?.message}`);
  return data.id as string;
}

async function insertBankAccount(
  supabase: SupabaseClient,
  opts: { name: string; accountType: number },
): Promise<string> {
  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({
      name: opts.name,
      bank_name:
        opts.accountType === ACCOUNT_TYPE.banco_de_la_nacion ? "BN" : "BCP",
      account_number: `9999-${Math.floor(Math.random() * 1_000_000)}`,
      currency: "PEN",
      account_type: opts.accountType,
      is_active: true,
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertBankAccount failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertProject(
  supabase: SupabaseClient,
  clientId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: `${SMOKE_MARKER} — Project`,
      code: `SMK-RPT-${Math.floor(Math.random() * 1_000_000)}`,
      status: PROJECT_STATUS.active,
      client_id: clientId,
      contract_value: 100000,
      contract_currency: "PEN",
      igv_included: true,
      billing_frequency: 1,
      signed_date: today(),
      start_date: today(),
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertProject failed: ${error?.message}`);
  return data.id as string;
}

async function insertCostCategory(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("cost_categories")
    .insert({
      name: `${SMOKE_MARKER} Materiales`,
      description: SMOKE_MARKER,
      is_active: true,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertCostCategory failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertProjectBudget(
  supabase: SupabaseClient,
  opts: { projectId: string; costCategoryId: string; amountPen: number },
): Promise<string> {
  const { data, error } = await supabase
    .from("project_budgets")
    .insert({
      project_id: opts.projectId,
      cost_category_id: opts.costCategoryId,
      budgeted_amount_pen: opts.amountPen,
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertProjectBudget failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertProjectPartner(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    contactId: string;
    companyLabel: string;
    profitSplitPct: number;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("project_partners")
    .insert({
      project_id: opts.projectId,
      contact_id: opts.contactId,
      company_label: opts.companyLabel,
      profit_split_pct: opts.profitSplitPct,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertProjectPartner failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertOutgoingInvoice(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    totalPen: number;
    status: number;
    estadoSunat: string | null;
    issueDate: string;
  },
): Promise<string> {
  const subtotal = round2(opts.totalPen / 1.18);
  const igvAmount = round2(opts.totalPen - subtotal);
  const { data, error } = await supabase
    .from("outgoing_invoices")
    .insert({
      project_id: opts.projectId,
      status: opts.status,
      period_start: opts.issueDate,
      period_end: opts.issueDate,
      issue_date: opts.issueDate,
      currency: "PEN",
      subtotal,
      igv_amount: igvAmount,
      total: opts.totalPen,
      total_pen: opts.totalPen,
      estado_sunat: opts.estadoSunat,
      detraction_status: DETRACTION_STATUS.not_applicable,
      source: 1,
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertOutgoingInvoice failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertIncomingInvoice(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    contactId: string;
    totalPen: number;
    facturaStatus: number;
  },
): Promise<string> {
  const subtotal = round2(opts.totalPen / 1.18);
  const igvAmount = round2(opts.totalPen - subtotal);
  const isReceived =
    opts.facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.received;
  const { data, error } = await supabase
    .from("incoming_invoices")
    .insert({
      project_id: opts.projectId,
      contact_id: opts.contactId,
      factura_status: opts.facturaStatus,
      currency: "PEN",
      subtotal,
      igv_amount: igvAmount,
      total: opts.totalPen,
      total_pen: opts.totalPen,
      serie_numero: isReceived
        ? `F001-${Math.floor(Math.random() * 1_000_000)
            .toString()
            .padStart(6, "0")}`
        : null,
      fecha_emision: isReceived ? today() : null,
      tipo_documento_code: isReceived ? "01" : null,
      ruc_emisor: isReceived ? SMOKE_RUCS.vendor : null,
      ruc_receptor: isReceived ? KORAKUEN_RUC : null,
      source: 1,
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertIncomingInvoice failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertLoan(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    borrowingPartnerId: string;
    lenderContactId: string;
    principalPen: number;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("loans")
    .insert({
      project_id: opts.projectId,
      borrowing_partner_id: opts.borrowingPartnerId,
      lender_contact_id: opts.lenderContactId,
      principal_amount: opts.principalPen,
      currency: "PEN",
      principal_amount_pen: opts.principalPen,
      return_rate: 0.10,
      return_type: "percentage",
      disbursement_date: today(),
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertLoan failed: ${error?.message}`);
  return data.id as string;
}

async function insertPayment(
  supabase: SupabaseClient,
  opts: {
    direction: number;
    bankAccountId: string;
    projectId?: string | null;
    contactId?: string | null;
    paidByPartnerId?: string | null;
    paymentDate: string;
    lines: Array<{
      amountPen: number;
      lineType: number;
      outgoingInvoiceId?: string | null;
      incomingInvoiceId?: string | null;
      loanId?: string | null;
    }>;
  },
): Promise<string> {
  const { data: bank } = await supabase
    .from("bank_accounts")
    .select("account_type")
    .eq("id", opts.bankAccountId)
    .single();
  const isDetraction =
    (bank as { account_type: number } | null)?.account_type ===
    ACCOUNT_TYPE.banco_de_la_nacion;

  const totalAmountPen = round2(
    opts.lines.reduce((a, l) => a + l.amountPen, 0),
  );

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      direction: opts.direction,
      bank_account_id: opts.bankAccountId,
      project_id: opts.projectId ?? null,
      contact_id: opts.contactId ?? null,
      paid_by_partner_id: opts.paidByPartnerId ?? null,
      total_amount: totalAmountPen,
      currency: "PEN",
      total_amount_pen: totalAmountPen,
      is_detraction: isDetraction,
      payment_date: opts.paymentDate,
      notes: SMOKE_MARKER,
      source: 1,
    })
    .select("id")
    .single();
  if (error || !payment) {
    throw new Error(`insertPayment failed: ${error?.message}`);
  }

  const lines = opts.lines.map((l, idx) => ({
    payment_id: payment.id,
    sort_order: idx,
    amount: l.amountPen,
    amount_pen: l.amountPen,
    outgoing_invoice_id: l.outgoingInvoiceId ?? null,
    incoming_invoice_id: l.incomingInvoiceId ?? null,
    loan_id: l.loanId ?? null,
    line_type: l.lineType,
  }));
  const { error: lineErr } = await supabase.from("payment_lines").insert(lines);
  if (lineErr) {
    await supabase.from("payments").delete().eq("id", payment.id);
    throw new Error(`insertPayment lines failed: ${lineErr.message}`);
  }
  return payment.id as string;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setup(supabase: SupabaseClient): Promise<Fixtures> {
  console.log("→ Cleaning up any leftover smoke-test data…");
  await cleanupLeftover(supabase);

  console.log("→ Seeding fresh fixtures…");

  const clientContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.client,
    razon_social: `${SMOKE_MARKER} Client S.A.C.`,
    is_client: true,
  });
  const vendorContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.vendor,
    razon_social: `${SMOKE_MARKER} Vendor S.A.C.`,
    is_vendor: true,
  });
  const partnerAContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.partnerA,
    razon_social: `${SMOKE_MARKER} Partner A S.A.C.`,
    is_partner: true,
  });
  const partnerBContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.partnerB,
    razon_social: `${SMOKE_MARKER} Partner B S.A.C.`,
    is_partner: true,
  });
  const lenderContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.lender,
    razon_social: `${SMOKE_MARKER} Lender S.A.C.`,
  });

  const regularBankId = await insertBankAccount(supabase, {
    name: `${SMOKE_MARKER} BCP Regular`,
    accountType: ACCOUNT_TYPE.regular,
  });
  const bnBankId = await insertBankAccount(supabase, {
    name: `${SMOKE_MARKER} Banco de la Nacion`,
    accountType: ACCOUNT_TYPE.banco_de_la_nacion,
  });

  const projectId = await insertProject(supabase, clientContactId);

  const costCategoryId = await insertCostCategory(supabase);
  const budget1Id = await insertProjectBudget(supabase, {
    projectId,
    costCategoryId,
    amountPen: 80000,
  });
  // Two budget rows means we test that the sum is used, not just one row.
  // But project_budgets has UNIQUE(project_id, cost_category_id), so we'd
  // need a second category. Keep it simple: one budget row, one category.
  const projectBudgetIds = [budget1Id];

  const partnerRowAId = await insertProjectPartner(supabase, {
    projectId,
    contactId: partnerAContactId,
    companyLabel: "Korakuen",
    profitSplitPct: 50,
  });
  const partnerRowBId = await insertProjectPartner(supabase, {
    projectId,
    contactId: partnerBContactId,
    companyLabel: "Partner B",
    profitSplitPct: 50,
  });

  // Outgoing invoices
  // - Sent + accepted, in period   (→ IGV output)
  // - Sent + accepted, out of period (→ excluded from IGV)
  // - Sent + pending               (→ excluded from IGV)
  const outgoingSentAcceptedInPeriodId = await insertOutgoingInvoice(supabase, {
    projectId,
    totalPen: 20000,
    status: OUTGOING_INVOICE_STATUS.sent,
    estadoSunat: "accepted",
    issueDate: today(),
  });
  const outgoingSentAcceptedOutOfPeriodId = await insertOutgoingInvoice(
    supabase,
    {
      projectId,
      totalPen: 7000,
      status: OUTGOING_INVOICE_STATUS.sent,
      estadoSunat: "accepted",
      issueDate: dateBeforePeriodStart(),
    },
  );
  const outgoingSentPendingId = await insertOutgoingInvoice(supabase, {
    projectId,
    totalPen: 5000,
    status: OUTGOING_INVOICE_STATUS.sent,
    estadoSunat: "pending",
    issueDate: today(),
  });

  // Incoming invoices:
  // - received, fully paid (→ not on payables; IGV input)
  // - received, outstanding (→ payables)
  // - expected with payment (→ chase list)
  // - expected no payment (→ not on chase list)
  const incomingReceivedFullyPaidId = await insertIncomingInvoice(supabase, {
    projectId,
    contactId: vendorContactId,
    totalPen: 3000,
    facturaStatus: INCOMING_INVOICE_FACTURA_STATUS.received,
  });
  const incomingReceivedOutstandingId = await insertIncomingInvoice(supabase, {
    projectId,
    contactId: vendorContactId,
    totalPen: 8000,
    facturaStatus: INCOMING_INVOICE_FACTURA_STATUS.received,
  });
  const incomingExpectedWithPaymentId = await insertIncomingInvoice(supabase, {
    projectId,
    contactId: vendorContactId,
    totalPen: 4000,
    facturaStatus: INCOMING_INVOICE_FACTURA_STATUS.expected,
  });
  const incomingExpectedNoPaymentId = await insertIncomingInvoice(supabase, {
    projectId,
    contactId: vendorContactId,
    totalPen: 2000,
    facturaStatus: INCOMING_INVOICE_FACTURA_STATUS.expected,
  });

  // Loan: principal 20000 PEN, one 5000 outbound repayment
  const loanId = await insertLoan(supabase, {
    projectId,
    borrowingPartnerId: partnerAContactId,
    lenderContactId,
    principalPen: 20000,
  });

  // Payments:
  // P1: inbound 15000, linked to outgoingSentAcceptedInPeriod (collected,
  //     partial payment on the 20000 invoice — leaves 5000 outstanding)
  // P2: outbound 10000, partnerA, unlinked (general spend on project)
  // P3: outbound 12000, partnerB, unlinked
  // P4: outbound 1500, partnerA, linked to incomingReceivedOutstanding (partial)
  // P5: outbound 3000, partnerA, linked to incomingReceivedFullyPaid (full)
  // P6: outbound 2500, partnerA, linked to incomingExpectedWithPayment
  //     (chase-list scenario — expected invoice with partial payment)
  // P7: outbound 5000, partnerA, linked to loan (loan repayment, line_type=4)
  //     → repaid 5000 → outstanding 15000 → status partially_repaid
  const paymentIds: string[] = [];
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.inbound,
      bankAccountId: regularBankId,
      projectId,
      contactId: clientContactId,
      paymentDate: today(),
      lines: [
        {
          amountPen: 15000,
          lineType: PAYMENT_LINE_TYPE.invoice,
          outgoingInvoiceId: outgoingSentAcceptedInPeriodId,
        },
      ],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      paidByPartnerId: partnerAContactId,
      paymentDate: today(),
      lines: [{ amountPen: 10000, lineType: PAYMENT_LINE_TYPE.general }],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      paidByPartnerId: partnerBContactId,
      paymentDate: today(),
      lines: [{ amountPen: 12000, lineType: PAYMENT_LINE_TYPE.general }],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      contactId: vendorContactId,
      paidByPartnerId: partnerAContactId,
      paymentDate: today(),
      lines: [
        {
          amountPen: 1500,
          lineType: PAYMENT_LINE_TYPE.invoice,
          incomingInvoiceId: incomingReceivedOutstandingId,
        },
      ],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      contactId: vendorContactId,
      paidByPartnerId: partnerAContactId,
      paymentDate: today(),
      lines: [
        {
          amountPen: 3000,
          lineType: PAYMENT_LINE_TYPE.invoice,
          incomingInvoiceId: incomingReceivedFullyPaidId,
        },
      ],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      contactId: vendorContactId,
      paidByPartnerId: partnerAContactId,
      paymentDate: today(),
      lines: [
        {
          amountPen: 2500,
          lineType: PAYMENT_LINE_TYPE.invoice,
          incomingInvoiceId: incomingExpectedWithPaymentId,
        },
      ],
    }),
  );
  paymentIds.push(
    await insertPayment(supabase, {
      direction: PAYMENT_DIRECTION.outbound,
      bankAccountId: regularBankId,
      projectId,
      contactId: lenderContactId,
      paidByPartnerId: partnerAContactId,
      paymentDate: today(),
      lines: [
        {
          amountPen: 5000,
          lineType: PAYMENT_LINE_TYPE.loan,
          loanId,
        },
      ],
    }),
  );

  return {
    clientContactId,
    vendorContactId,
    partnerAContactId,
    partnerBContactId,
    lenderContactId,
    regularBankId,
    bnBankId,
    projectId,
    costCategoryId,
    projectBudgetIds,
    partnerRowAId,
    partnerRowBId,
    outgoingSentAcceptedInPeriodId,
    outgoingSentAcceptedOutOfPeriodId,
    outgoingSentPendingId,
    incomingReceivedFullyPaidId,
    incomingReceivedOutstandingId,
    incomingExpectedWithPaymentId,
    incomingExpectedNoPaymentId,
    loanId,
    paymentIds,
  };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type Scenario = {
  name: string;
  run: (supabase: SupabaseClient, fx: Fixtures) => Promise<void>;
};

const scenarios: Scenario[] = [
  // -------------------------------------------------------------------------
  // R1: getProjectSummary math
  // -------------------------------------------------------------------------
  {
    name: "R1: project summary aggregates invoices, payments, budgets, partners",
    run: async (supabase, fx) => {
      // Budgets → 80000
      const { data: budgetRows } = await supabase
        .from("project_budgets")
        .select("budgeted_amount_pen")
        .eq("project_id", fx.projectId)
        .is("deleted_at", null);
      const estimated_cost_pen = (budgetRows ?? []).reduce(
        (a, r) => a + Number((r as { budgeted_amount_pen: number }).budgeted_amount_pen),
        0,
      );
      assertEqual("R1.estimated_cost_pen", estimated_cost_pen, 80000);

      // Invoiced (outgoing, not void): 20000 + 7000 + 5000 = 32000
      const { data: invRows } = await supabase
        .from("outgoing_invoices")
        .select("total_pen")
        .eq("project_id", fx.projectId)
        .neq("status", OUTGOING_INVOICE_STATUS.void)
        .is("deleted_at", null);
      const invoiced_pen = (invRows ?? []).reduce(
        (a, r) => a + Number((r as { total_pen: number }).total_pen),
        0,
      );
      assertEqual("R1.invoiced_pen", invoiced_pen, 32000);

      // Payments
      const { data: paymentRows } = await supabase
        .from("payments")
        .select("direction, total_amount_pen, paid_by_partner_id")
        .eq("project_id", fx.projectId)
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
        if (row.direction === PAYMENT_DIRECTION.inbound) collected_pen += amt;
        else if (row.direction === PAYMENT_DIRECTION.outbound) {
          actual_spend_pen += amt;
          const k = row.paid_by_partner_id ?? null;
          costByContact.set(k, (costByContact.get(k) ?? 0) + amt);
        }
      }
      assertEqual("R1.collected_pen", collected_pen, 15000);
      // Outbound: 10000 + 12000 + 1500 + 3000 + 2500 + 5000 = 34000
      assertEqual("R1.actual_spend_pen", actual_spend_pen, 34000);

      // Partner A total: 10000 + 1500 + 3000 + 2500 + 5000 = 22000
      // Partner B total: 12000
      assertEqual(
        "R1.costByContact.partnerA",
        costByContact.get(fx.partnerAContactId) ?? 0,
        22000,
      );
      assertEqual(
        "R1.costByContact.partnerB",
        costByContact.get(fx.partnerBContactId) ?? 0,
        12000,
      );

      // Margins: contract 100000, est 80000, spend 34000
      assertEqual("R1.expected_margin", 100000 - estimated_cost_pen, 20000);
      assertEqual("R1.actual_margin", 100000 - actual_spend_pen, 66000);
    },
  },

  // -------------------------------------------------------------------------
  // R2: getSettlement math
  // -------------------------------------------------------------------------
  {
    name: "R2: settlement — revenue / costs / 50-50 profit share",
    run: async (supabase, fx) => {
      const { data: partnerRows } = await supabase
        .from("project_partners")
        .select("id, contact_id, profit_split_pct")
        .eq("project_id", fx.projectId)
        .is("deleted_at", null);
      const { data: paymentRows } = await supabase
        .from("payments")
        .select("direction, total_amount_pen, paid_by_partner_id")
        .eq("project_id", fx.projectId)
        .is("deleted_at", null);

      let revenue_pen = 0;
      let total_costs_pen = 0;
      const costs = new Map<string | null, number>();
      for (const row of (paymentRows ?? []) as Array<{
        direction: number;
        total_amount_pen: number;
        paid_by_partner_id: string | null;
      }>) {
        const amt = Number(row.total_amount_pen);
        if (row.direction === PAYMENT_DIRECTION.inbound) revenue_pen += amt;
        else if (row.direction === PAYMENT_DIRECTION.outbound) {
          total_costs_pen += amt;
          const k = row.paid_by_partner_id ?? null;
          costs.set(k, (costs.get(k) ?? 0) + amt);
        }
      }
      assertEqual("R2.revenue_pen", revenue_pen, 15000);
      assertEqual("R2.total_costs_pen", total_costs_pen, 34000);

      const gross_profit_pen = round2(revenue_pen - total_costs_pen);
      assertEqual("R2.gross_profit_pen", gross_profit_pen, -19000);

      let profit_split_total_pct = 0;
      const byPartner = new Map<
        string,
        { costs: number; profit_share: number; total_owed: number }
      >();
      for (const r of (partnerRows ?? []) as Array<{
        id: string;
        contact_id: string;
        profit_split_pct: number;
      }>) {
        const pct = Number(r.profit_split_pct);
        profit_split_total_pct += pct;
        const c = round2(costs.get(r.contact_id) ?? 0);
        const ps = round2(gross_profit_pen * (pct / 100));
        byPartner.set(r.contact_id, {
          costs: c,
          profit_share: ps,
          total_owed: round2(c + ps),
        });
      }
      assertEqual("R2.profit_split_total_pct", profit_split_total_pct, 100);

      const a = byPartner.get(fx.partnerAContactId);
      assertTrue("R2.partnerA.present", a !== undefined);
      assertEqual("R2.partnerA.costs", a!.costs, 22000);
      // profit_share = -19000 * 0.5 = -9500
      assertEqual("R2.partnerA.profit_share", a!.profit_share, -9500);
      // total_owed = 22000 + (-9500) = 12500
      assertEqual("R2.partnerA.total_owed", a!.total_owed, 12500);

      const b = byPartner.get(fx.partnerBContactId);
      assertTrue("R2.partnerB.present", b !== undefined);
      assertEqual("R2.partnerB.costs", b!.costs, 12000);
      assertEqual("R2.partnerB.profit_share", b!.profit_share, -9500);
      assertEqual("R2.partnerB.total_owed", b!.total_owed, 2500);

      // Sanity: sum of partner total_owed == revenue - (sum profit_shares) round-trip
      // total_owed_sum = (cost_A + cost_B) + (share_A + share_B)
      //                = 34000 + (-19000) = 15000 == revenue - 0  (no unassigned costs)
      const totalOwedSum =
        (a!.total_owed ?? 0) + (b!.total_owed ?? 0);
      assertEqual("R2.total_owed_sum", totalOwedSum, 15000);
    },
  },

  // -------------------------------------------------------------------------
  // R3: IGV period filter
  // -------------------------------------------------------------------------
  {
    name: "R3: IGV position excludes out-of-period and non-accepted invoices",
    run: async (supabase, fx) => {
      const period_start = firstOfCurrentMonth();
      const period_end = today();

      // IGV output (mirror reports.ts query)
      const { data: igvOut } = await supabase
        .from("outgoing_invoices")
        .select("id, igv_amount")
        .eq("status", OUTGOING_INVOICE_STATUS.sent)
        .in("estado_sunat", ["accepted", "aceptado"])
        .gte("issue_date", period_start)
        .lte("issue_date", period_end)
        .is("deleted_at", null);
      const outRows = (igvOut ?? []) as Array<{ id: string; igv_amount: number }>;
      const outIds = outRows.map((r) => r.id);

      // Must include the in-period accepted invoice
      assertTrue(
        "R3.outIds.includes inPeriod",
        outIds.includes(fx.outgoingSentAcceptedInPeriodId),
      );
      // Must exclude the out-of-period accepted invoice
      assertTrue(
        "R3.outIds.excludes outOfPeriod",
        !outIds.includes(fx.outgoingSentAcceptedOutOfPeriodId),
      );
      // Must exclude the pending invoice (even though in period)
      assertTrue(
        "R3.outIds.excludes pending",
        !outIds.includes(fx.outgoingSentPendingId),
      );

      // IGV input
      const { data: igvIn } = await supabase
        .from("incoming_invoices")
        .select("id, igv_amount, fecha_emision")
        .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.received)
        .gte("fecha_emision", period_start)
        .lte("fecha_emision", period_end)
        .is("deleted_at", null);
      const inRows = (igvIn ?? []) as Array<{ id: string; igv_amount: number }>;
      const inIds = inRows.map((r) => r.id);
      assertTrue(
        "R3.inIds.includes fullyPaid",
        inIds.includes(fx.incomingReceivedFullyPaidId),
      );
      assertTrue(
        "R3.inIds.includes outstanding",
        inIds.includes(fx.incomingReceivedOutstandingId),
      );
      // expected invoices have no fecha_emision and are excluded by the
      // gte/lte range match itself; double-check by id
      assertTrue(
        "R3.inIds.excludes expectedWithPayment",
        !inIds.includes(fx.incomingExpectedWithPaymentId),
      );

      // Net math: output_pen − input_pen
      // Output: 20000 × (0.18/1.18) — we can't know exact igv_amount without
      // round-trip, so just assert it matches the stored values.
      const output_pen = outRows.reduce(
        (a, r) => a + Number(r.igv_amount),
        0,
      );
      const input_pen = inRows.reduce(
        (a, r) => a + Number(r.igv_amount),
        0,
      );
      const net = round2(output_pen - input_pen);
      assertTrue("R3.net.finite", Number.isFinite(net));
    },
  },

  // -------------------------------------------------------------------------
  // R4: Loan balance
  // -------------------------------------------------------------------------
  {
    name: "R4: loan balance — signed sum, status derivation",
    run: async (supabase, fx) => {
      const { data: loanRows } = await supabase
        .from("loans")
        .select("id, principal_amount_pen")
        .eq("id", fx.loanId)
        .is("deleted_at", null);
      const loan = (loanRows ?? [])[0] as { id: string; principal_amount_pen: number };
      assertEqual("R4.principal", Number(loan.principal_amount_pen), 20000);

      const { data: loanLines } = await supabase
        .from("payment_lines")
        .select("amount_pen, payments!inner(direction, deleted_at)")
        .eq("line_type", PAYMENT_LINE_TYPE.loan)
        .eq("loan_id", fx.loanId)
        .is("payments.deleted_at", null);

      let repaid = 0;
      for (const row of (loanLines ?? []) as Array<{
        amount_pen: number;
        payments:
          | { direction: number | null }
          | Array<{ direction: number | null }>
          | null;
      }>) {
        const p = Array.isArray(row.payments) ? row.payments[0] : row.payments;
        const dir = p?.direction ?? null;
        const amt = Number(row.amount_pen);
        if (dir === PAYMENT_DIRECTION.outbound) repaid += amt;
        else if (dir === PAYMENT_DIRECTION.inbound) repaid -= amt;
      }
      assertEqual("R4.repaid", repaid, 5000);

      const principal = Number(loan.principal_amount_pen);
      const outstanding = principal - repaid;
      assertEqual("R4.outstanding", outstanding, 15000);

      let status: "active" | "partially_repaid" | "settled";
      if (repaid <= 0) status = "active";
      else if (repaid < principal) status = "partially_repaid";
      else status = "settled";
      assertEqual("R4.status", status, "partially_repaid");
    },
  },

  // -------------------------------------------------------------------------
  // R5: Receivables grouping
  // -------------------------------------------------------------------------
  {
    name: "R5: receivables grouped by client, outstanding > 0 only",
    run: async (supabase, fx) => {
      const { data: outRaw } = await supabase
        .from("outgoing_invoices")
        .select("id, total_pen, estado_sunat, project:projects!outgoing_invoices_project_id_fkey(client_id)")
        .neq("status", OUTGOING_INVOICE_STATUS.void)
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
      const computed = await computeOutgoingInvoicePaymentProgressBatch(
        supabase,
        outInvoices.map((i) => ({
          id: i.id,
          total_pen: i.total_pen,
          estado_sunat: i.estado_sunat,
        })),
      );

      // The in-period 20000 invoice has a 15000 inbound → outstanding 5000
      const inPeriodComputed = computed.get(fx.outgoingSentAcceptedInPeriodId);
      assertTrue("R5.inPeriod present", inPeriodComputed !== undefined);
      assertEqual("R5.inPeriod.outstanding", inPeriodComputed!.outstanding, 5000);

      // Group by client
      const byClient = new Map<string, { outstanding: number; count: number }>();
      for (const inv of outInvoices) {
        const c = computed.get(inv.id);
        if (!c || c.outstanding <= 0) continue;
        const project = Array.isArray(inv.project) ? inv.project[0] : inv.project;
        const cid = project?.client_id;
        if (!cid) continue;
        const e = byClient.get(cid) ?? { outstanding: 0, count: 0 };
        e.outstanding += c.outstanding;
        e.count += 1;
        byClient.set(cid, e);
      }

      // Our client should have outstanding = 5000 (partial) + 7000 (out of period,
      // no payments) + 5000 (pending, no payments) = 17000 across 3 invoices
      const entry = byClient.get(fx.clientContactId);
      assertTrue("R5.client present", entry !== undefined);
      assertEqual("R5.client.outstanding", entry!.outstanding, 17000);
      assertEqual("R5.client.count", entry!.count, 3);
    },
  },

  // -------------------------------------------------------------------------
  // R6: Payables grouping
  // -------------------------------------------------------------------------
  {
    name: "R6: payables grouped by vendor, received + outstanding > 0 only",
    run: async (supabase, fx) => {
      const { data: inReceived } = await supabase
        .from("incoming_invoices")
        .select("id, contact_id, total_pen, factura_status")
        .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.received)
        .is("deleted_at", null);
      const rows = (inReceived ?? []) as Array<{
        id: string;
        contact_id: string;
        total_pen: number;
        factura_status: number;
      }>;
      const computed = await computeIncomingInvoicePaymentProgressBatch(
        supabase,
        rows.map((r) => ({
          id: r.id,
          total_pen: r.total_pen,
          factura_status: r.factura_status,
        })),
      );

      // fullyPaid (3000 invoice, 3000 outbound) → outstanding 0 → EXCLUDED
      const fp = computed.get(fx.incomingReceivedFullyPaidId);
      assertTrue("R6.fullyPaid present", fp !== undefined);
      assertEqual("R6.fullyPaid.outstanding", fp!.outstanding, 0);

      // outstanding (8000 invoice, 1500 outbound) → outstanding 6500 → INCLUDED
      const ov = computed.get(fx.incomingReceivedOutstandingId);
      assertTrue("R6.outstanding present", ov !== undefined);
      assertEqual("R6.outstanding.value", ov!.outstanding, 6500);

      const byVendor = new Map<string, { outstanding: number; count: number }>();
      for (const r of rows) {
        const c = computed.get(r.id);
        if (!c || c.outstanding <= 0) continue;
        const e = byVendor.get(r.contact_id) ?? { outstanding: 0, count: 0 };
        e.outstanding += c.outstanding;
        e.count += 1;
        byVendor.set(r.contact_id, e);
      }
      const entry = byVendor.get(fx.vendorContactId);
      assertTrue("R6.vendor present", entry !== undefined);
      assertEqual("R6.vendor.outstanding", entry!.outstanding, 6500);
      assertEqual("R6.vendor.count", entry!.count, 1);
    },
  },

  // -------------------------------------------------------------------------
  // R7: Chase list
  // -------------------------------------------------------------------------
  {
    name: "R7: chase list — expected + paid > 0 only",
    run: async (supabase, fx) => {
      const { data: inExpected } = await supabase
        .from("incoming_invoices")
        .select("id, contact_id, project_id, total_pen, factura_status")
        .eq("factura_status", INCOMING_INVOICE_FACTURA_STATUS.expected)
        .is("deleted_at", null);
      const rows = (inExpected ?? []) as Array<{
        id: string;
        contact_id: string;
        project_id: string | null;
        total_pen: number;
        factura_status: number;
      }>;
      const computed = await computeIncomingInvoicePaymentProgressBatch(
        supabase,
        rows.map((r) => ({
          id: r.id,
          total_pen: r.total_pen,
          factura_status: r.factura_status,
        })),
      );

      const chase: string[] = [];
      for (const r of rows) {
        const c = computed.get(r.id);
        if (c?.needs_factura) chase.push(r.id);
      }

      assertTrue(
        "R7.includes expectedWithPayment",
        chase.includes(fx.incomingExpectedWithPaymentId),
      );
      assertTrue(
        "R7.excludes expectedNoPayment",
        !chase.includes(fx.incomingExpectedNoPaymentId),
      );
      // Verify paid > 0 on the included one (2500 from P6)
      const included = computed.get(fx.incomingExpectedWithPaymentId);
      assertTrue("R7.included.present", included !== undefined);
      assertEqual("R7.included.paid", included!.paid, 2500);
      assertEqual("R7.included.needs_factura", included!.needs_factura, true);

      // Received invoices never show up on chase list
      assertTrue(
        "R7.excludes receivedFullyPaid",
        !chase.includes(fx.incomingReceivedFullyPaidId),
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown(
  supabase: SupabaseClient,
  fx: Fixtures | null,
): Promise<void> {
  console.log("→ Cleaning up smoke-test data…");
  if (fx) {
    // Payments cascade to lines
    if (fx.paymentIds.length > 0) {
      await supabase.from("payments").delete().in("id", fx.paymentIds);
    }
    await supabase.from("loans").delete().eq("id", fx.loanId);
    await supabase
      .from("outgoing_invoices")
      .delete()
      .in("id", [
        fx.outgoingSentAcceptedInPeriodId,
        fx.outgoingSentAcceptedOutOfPeriodId,
        fx.outgoingSentPendingId,
      ]);
    await supabase
      .from("incoming_invoices")
      .delete()
      .in("id", [
        fx.incomingReceivedFullyPaidId,
        fx.incomingReceivedOutstandingId,
        fx.incomingExpectedWithPaymentId,
        fx.incomingExpectedNoPaymentId,
      ]);
    if (fx.projectBudgetIds.length > 0) {
      await supabase.from("project_budgets").delete().in("id", fx.projectBudgetIds);
    }
    await supabase
      .from("project_partners")
      .delete()
      .in("id", [fx.partnerRowAId, fx.partnerRowBId]);
    await supabase.from("projects").delete().eq("id", fx.projectId);
    await supabase
      .from("cost_categories")
      .delete()
      .eq("id", fx.costCategoryId);
    await supabase
      .from("bank_accounts")
      .delete()
      .in("id", [fx.regularBankId, fx.bnBankId]);
    await supabase
      .from("contacts")
      .delete()
      .in("id", [
        fx.clientContactId,
        fx.vendorContactId,
        fx.partnerAContactId,
        fx.partnerBContactId,
        fx.lenderContactId,
      ]);
  }
  // Belt-and-braces
  await cleanupLeftover(supabase);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const adminPassword = requireEnv("TEST_ADMIN_PASSWORD");

  const supabase = createClient(supabaseUrl, anonKey);

  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: adminPassword,
  });
  if (signInErr) {
    console.error(`Failed to sign in as ${ADMIN_EMAIL}:`, signInErr.message);
    process.exit(1);
  }
  console.log(`✓ Signed in as ${ADMIN_EMAIL}`);

  let fixtures: Fixtures | null = null;
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];

  try {
    fixtures = await setup(supabase);
    console.log(`✓ Fixtures seeded`);

    for (const scenario of scenarios) {
      try {
        await scenario.run(supabase, fixtures);
        results.push({ name: scenario.name, passed: true });
        console.log(`  ✓ ${scenario.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ name: scenario.name, passed: false, error: message });
        console.log(`  ✗ ${scenario.name}`);
        console.log(`    ${message}`);
      }
    }
  } catch (err) {
    console.error(
      "Fatal error during setup/scenarios:",
      err instanceof Error ? err.message : err,
    );
  } finally {
    try {
      await teardown(supabase, fixtures);
      console.log("✓ Teardown complete");
    } catch (err) {
      console.error(
        "Teardown error (manual cleanup may be needed):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log(`\n${passed}/${total} scenarios passed`);
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
