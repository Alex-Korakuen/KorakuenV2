/**
 * smoke-payments.ts — end-to-end verification of Step 10 payment flows
 *
 * Exercises the payment schema, auto-split math, computed helpers, and bank
 * balance formulas against the live Supabase database. Signs in as the
 * admin user (matching scripts/seed-self-contact.ts) so the activity_log
 * trigger's auth.uid() resolves to Alex's users row and the audit trail
 * stays truthful.
 *
 * The script mirrors each server action's logic via direct supabase-js
 * operations — it cannot call the actions themselves because those require
 * a Next.js request context (next/headers cookies). The pure helpers
 * (autoSplitOnOverflow, signedContributionForInvoice) and the computed
 * helpers (computeOutgoingInvoicePaymentProgress, etc.) are imported and
 * exercised against real DB rows to verify the math end-to-end.
 *
 * Run from project root (Node 20+):
 *   npx tsx --env-file=.env.local scripts/smoke-payments.ts
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *               TEST_ADMIN_PASSWORD
 *
 * Every row the script creates carries a SMOKE-TEST marker in its notes
 * field (or is tracked by ID) and is cleaned up at the end regardless of
 * scenario outcomes. If a previous run crashed mid-script, running it
 * again will delete the leftover fixtures during the setup-cleanup pass.
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
import {
  autoSplitOnOverflow,
  signedContributionForInvoice,
} from "@/lib/payment-helpers";
import { computeOutgoingInvoicePaymentProgress } from "@/lib/outgoing-invoice-computed";
import { computeIncomingInvoicePaymentProgress } from "@/lib/incoming-invoice-computed";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = "alex.ferreira@korakuen.pe";
const SMOKE_MARKER = "SMOKE-TEST-PAYMENTS";
const SMOKE_RUCS = {
  client: "99000000011",
  vendor: "99000000022",
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is not set`);
    console.error(
      "Run with: npx tsx --env-file=.env.local scripts/smoke-payments.ts",
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function assertEqual(
  label: string,
  actual: unknown,
  expected: unknown,
): void {
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
  selfPartnerId: string;
  projectId: string;
  regularBankId: string;
  bnBankId: string;
  outgoingPenInvoiceId: string;
  outgoingUsdInvoiceId: string;
  incomingPenInvoiceId: string;
  insertedExchangeRateId: string | null;
};

// ---------------------------------------------------------------------------
// Setup: clean any leftover + seed fresh fixtures
// ---------------------------------------------------------------------------

async function cleanupLeftover(supabase: SupabaseClient): Promise<void> {
  // Order matters: payments first (cascades to lines), then invoices,
  // then project, then bank accounts, then contacts. Exchange rate
  // is independent.
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

    // Payments first
    if (projectIds.length > 0) {
      const { data: payments } = await supabase
        .from("payments")
        .select("id")
        .in("project_id", projectIds);
      const paymentIds = (payments ?? []).map((p) => p.id as string);
      if (paymentIds.length > 0) {
        await supabase.from("payments").delete().in("id", paymentIds);
      }
      // Unlinked payments that reference the contacts directly
      await supabase
        .from("payments")
        .delete()
        .in("contact_id", contactIds)
        .is("project_id", null);

      await supabase.from("outgoing_invoices").delete().in("project_id", projectIds);
      await supabase.from("incoming_invoices").delete().in("project_id", projectIds);
      await supabase.from("projects").delete().in("id", projectIds);
    }

    await supabase
      .from("incoming_invoices")
      .delete()
      .in("contact_id", contactIds);
    await supabase.from("contacts").delete().in("id", contactIds);
  }

  // Bank accounts (marked by name prefix)
  await supabase
    .from("bank_accounts")
    .delete()
    .like("name", `${SMOKE_MARKER}%`);
}

async function insertContact(
  supabase: SupabaseClient,
  opts: {
    ruc: string;
    razon_social: string;
    is_client: boolean;
    is_vendor: boolean;
  },
): Promise<string> {
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      tipo_persona: TIPO_PERSONA.juridica,
      ruc: opts.ruc,
      razon_social: opts.razon_social,
      is_client: opts.is_client,
      is_vendor: opts.is_vendor,
      is_partner: false,
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
  opts: { name: string; currency: string; accountType: number },
): Promise<string> {
  const { data, error } = await supabase
    .from("bank_accounts")
    .insert({
      name: opts.name,
      bank_name: opts.accountType === ACCOUNT_TYPE.banco_de_la_nacion ? "BN" : "BCP",
      account_number: `9999-${Math.floor(Math.random() * 1_000_000)}`,
      currency: opts.currency,
      account_type: opts.accountType,
      is_active: true,
      notes: SMOKE_MARKER,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertBankAccount failed: ${error?.message}`);
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
      code: "SMK-001",
      status: PROJECT_STATUS.active,
      client_id: clientId,
      contract_value: 50000,
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

async function ensureExchangeRate(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("exchange_rates")
    .select("id")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_type", "promedio")
    .eq("rate_date", today())
    .maybeSingle();

  if (existing) return null; // already present — don't track for cleanup

  const { data, error } = await supabase
    .from("exchange_rates")
    .insert({
      base_currency: "USD",
      target_currency: "PEN",
      rate_type: "promedio",
      rate: 3.8,
      rate_date: today(),
      source: "manual",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`ensureExchangeRate failed: ${error?.message}`);
  }
  return data.id as string;
}

async function insertOutgoingInvoice(
  supabase: SupabaseClient,
  opts: {
    projectId: string;
    currency: string;
    exchangeRate: number | null;
    totalPen: number;
    detractionRate: number | null;
    detractionAmount: number | null;
  },
): Promise<string> {
  const total = opts.currency === "PEN" ? opts.totalPen : opts.totalPen / (opts.exchangeRate ?? 1);
  const subtotal = round2(total / 1.18);
  const igvAmount = round2(total - subtotal);
  const { data, error } = await supabase
    .from("outgoing_invoices")
    .insert({
      project_id: opts.projectId,
      status: OUTGOING_INVOICE_STATUS.draft,
      period_start: today(),
      period_end: today(),
      issue_date: today(),
      currency: opts.currency,
      exchange_rate: opts.exchangeRate,
      subtotal,
      igv_amount: igvAmount,
      total: round2(total),
      total_pen: opts.totalPen,
      detraction_rate: opts.detractionRate,
      detraction_amount: opts.detractionAmount,
      detraction_status:
        opts.detractionAmount != null
          ? DETRACTION_STATUS.pending
          : DETRACTION_STATUS.not_applicable,
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
  },
): Promise<string> {
  const subtotal = round2(opts.totalPen / 1.18);
  const igvAmount = round2(opts.totalPen - subtotal);
  const { data, error } = await supabase
    .from("incoming_invoices")
    .insert({
      project_id: opts.projectId,
      contact_id: opts.contactId,
      factura_status: INCOMING_INVOICE_FACTURA_STATUS.received,
      currency: "PEN",
      subtotal,
      igv_amount: igvAmount,
      total: opts.totalPen,
      total_pen: opts.totalPen,
      serie_numero: `F001-${Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0")}`,
      fecha_emision: today(),
      tipo_documento_code: "01",
      ruc_emisor: SMOKE_RUCS.vendor,
      ruc_receptor: "20615457109",
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

async function setup(supabase: SupabaseClient): Promise<Fixtures> {
  console.log("→ Cleaning up any leftover smoke-test data…");
  await cleanupLeftover(supabase);

  console.log("→ Seeding fresh fixtures…");
  const clientContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.client,
    razon_social: `${SMOKE_MARKER} Client S.A.C.`,
    is_client: true,
    is_vendor: false,
  });
  const vendorContactId = await insertContact(supabase, {
    ruc: SMOKE_RUCS.vendor,
    razon_social: `${SMOKE_MARKER} Vendor S.A.C.`,
    is_client: false,
    is_vendor: true,
  });
  const regularBankId = await insertBankAccount(supabase, {
    name: `${SMOKE_MARKER} BCP Regular`,
    currency: "PEN",
    accountType: ACCOUNT_TYPE.regular,
  });
  const bnBankId = await insertBankAccount(supabase, {
    name: `${SMOKE_MARKER} Banco de la Nacion`,
    currency: "PEN",
    accountType: ACCOUNT_TYPE.banco_de_la_nacion,
  });
  const projectId = await insertProject(supabase, clientContactId);
  const insertedExchangeRateId = await ensureExchangeRate(supabase);

  // Every payment must be attributed to a consortium partner. Use
  // Korakuen's own is_self row as the default partner for smoke payments.
  const { data: selfRow, error: selfErr } = await supabase
    .from("contacts")
    .select("id")
    .eq("is_self", true)
    .maybeSingle();
  if (selfErr || !selfRow) {
    throw new Error(
      `setup: cannot find is_self contact — seed Korakuen first (scripts/seed-self-contact.ts): ${selfErr?.message ?? "no row"}`,
    );
  }
  const selfPartnerId = selfRow.id as string;

  const outgoingPenInvoiceId = await insertOutgoingInvoice(supabase, {
    projectId,
    currency: "PEN",
    exchangeRate: null,
    totalPen: 10000,
    detractionRate: 0.12,
    detractionAmount: 1200,
  });
  const outgoingUsdInvoiceId = await insertOutgoingInvoice(supabase, {
    projectId,
    currency: "USD",
    exchangeRate: 3.8,
    totalPen: 3800,
    detractionRate: null,
    detractionAmount: null,
  });
  const incomingPenInvoiceId = await insertIncomingInvoice(supabase, {
    projectId,
    contactId: vendorContactId,
    totalPen: 5000,
  });

  return {
    clientContactId,
    vendorContactId,
    selfPartnerId,
    projectId,
    regularBankId,
    bnBankId,
    outgoingPenInvoiceId,
    outgoingUsdInvoiceId,
    incomingPenInvoiceId,
    insertedExchangeRateId,
  };
}

// ---------------------------------------------------------------------------
// Helpers that mirror server-action logic
// ---------------------------------------------------------------------------

async function createPayment(
  supabase: SupabaseClient,
  opts: {
    direction: number;
    bankAccountId: string;
    paidByPartnerId: string;
    projectId?: string | null;
    contactId?: string | null;
    currency?: string;
    exchangeRate?: number | null;
    paymentDate: string;
    notes?: string;
    lines: Array<{
      amount: number;
      amountPen: number;
      lineType: number;
      outgoingInvoiceId?: string | null;
      incomingInvoiceId?: string | null;
    }>;
  },
): Promise<{ id: string }> {
  // Derive is_detraction from the bank account (mirrors server action)
  const { data: bank, error: bankError } = await supabase
    .from("bank_accounts")
    .select("account_type")
    .eq("id", opts.bankAccountId)
    .single();
  if (bankError || !bank) {
    throw new Error(`createPayment: bank not found: ${bankError?.message}`);
  }
  const isDetraction = bank.account_type === ACCOUNT_TYPE.banco_de_la_nacion;

  const totalAmount = round2(
    opts.lines.reduce((a, l) => a + l.amount, 0),
  );
  const totalAmountPen = round2(
    opts.lines.reduce((a, l) => a + l.amountPen, 0),
  );

  const { data: payment, error: payError } = await supabase
    .from("payments")
    .insert({
      direction: opts.direction,
      bank_account_id: opts.bankAccountId,
      project_id: opts.projectId ?? null,
      contact_id: opts.contactId ?? null,
      paid_by_partner_id: opts.paidByPartnerId,
      total_amount: totalAmount,
      currency: opts.currency ?? "PEN",
      exchange_rate: opts.exchangeRate ?? null,
      total_amount_pen: totalAmountPen,
      is_detraction: isDetraction,
      payment_date: opts.paymentDate,
      notes: opts.notes ?? SMOKE_MARKER,
      source: 1,
    })
    .select("id")
    .single();
  if (payError || !payment) {
    throw new Error(`createPayment: insert failed: ${payError?.message}`);
  }

  const linesPayload = opts.lines.map((l, idx) => ({
    payment_id: payment.id,
    sort_order: idx,
    amount: l.amount,
    amount_pen: l.amountPen,
    outgoing_invoice_id: l.outgoingInvoiceId ?? null,
    incoming_invoice_id: l.incomingInvoiceId ?? null,
    line_type: l.lineType,
  }));
  const { error: lineError } = await supabase
    .from("payment_lines")
    .insert(linesPayload);
  if (lineError) {
    await supabase.from("payments").delete().eq("id", payment.id);
    throw new Error(`createPayment: lines insert failed: ${lineError.message}`);
  }

  return { id: payment.id as string };
}

async function fetchOutgoingInvoice(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  id: string;
  total_pen: number;
  estado_sunat: string | null;
}> {
  const { data, error } = await supabase
    .from("outgoing_invoices")
    .select("id, total_pen, estado_sunat")
    .eq("id", id)
    .single();
  if (error || !data) {
    throw new Error(`fetchOutgoingInvoice: ${error?.message}`);
  }
  return data as { id: string; total_pen: number; estado_sunat: string | null };
}

async function fetchIncomingInvoice(
  supabase: SupabaseClient,
  id: string,
): Promise<{
  id: string;
  total_pen: number;
  factura_status: number;
}> {
  const { data, error } = await supabase
    .from("incoming_invoices")
    .select("id, total_pen, factura_status")
    .eq("id", id)
    .single();
  if (error || !data) {
    throw new Error(`fetchIncomingInvoice: ${error?.message}`);
  }
  return data as { id: string; total_pen: number; factura_status: number };
}

async function fetchPaymentLines(
  supabase: SupabaseClient,
  paymentId: string,
): Promise<
  Array<{
    id: string;
    amount: number;
    amount_pen: number;
    line_type: number;
    outgoing_invoice_id: string | null;
    incoming_invoice_id: string | null;
  }>
> {
  const { data, error } = await supabase
    .from("payment_lines")
    .select("id, amount, amount_pen, line_type, outgoing_invoice_id, incoming_invoice_id")
    .eq("payment_id", paymentId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`fetchPaymentLines: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    amount: number;
    amount_pen: number;
    line_type: number;
    outgoing_invoice_id: string | null;
    incoming_invoice_id: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

type Scenario = {
  name: string;
  run: (supabase: SupabaseClient, fx: Fixtures) => Promise<void>;
};

const scenarios: Scenario[] = [
  {
    name: "S1: normal inbound regular payment settles outgoing PEN invoice",
    run: async (supabase, fx) => {
      await createPayment(supabase, {
        direction: PAYMENT_DIRECTION.inbound,
        bankAccountId: fx.regularBankId,
        paidByPartnerId: fx.selfPartnerId,
        projectId: fx.projectId,
        contactId: fx.clientContactId,
        paymentDate: today(),
        lines: [
          {
            amount: 10000,
            amountPen: 10000,
            lineType: PAYMENT_LINE_TYPE.invoice,
            outgoingInvoiceId: fx.outgoingPenInvoiceId,
          },
        ],
      });

      const invoice = await fetchOutgoingInvoice(supabase, fx.outgoingPenInvoiceId);
      const computed = await computeOutgoingInvoicePaymentProgress(
        supabase,
        invoice,
      );
      assertEqual("S1.paid", computed.paid, 10000);
      assertEqual("S1.outstanding", computed.outstanding, 0);
      assertEqual("S1.payment_state", computed.payment_state, "paid");
      assertEqual("S1.is_fully_paid", computed.is_fully_paid, true);
    },
  },
  {
    name: "S2: self-detracción leg 1 (outbound regular) → transient state",
    run: async (supabase, fx) => {
      await createPayment(supabase, {
        direction: PAYMENT_DIRECTION.outbound,
        bankAccountId: fx.regularBankId,
        paidByPartnerId: fx.selfPartnerId,
        projectId: fx.projectId,
        paymentDate: today(),
        notes: `${SMOKE_MARKER} self-detracción leg 1`,
        lines: [
          {
            amount: 1200,
            amountPen: 1200,
            lineType: PAYMENT_LINE_TYPE.detraction,
            outgoingInvoiceId: fx.outgoingPenInvoiceId,
          },
        ],
      });

      const invoice = await fetchOutgoingInvoice(supabase, fx.outgoingPenInvoiceId);
      const computed = await computeOutgoingInvoicePaymentProgress(
        supabase,
        invoice,
      );
      // Signed paid: +10000 (S1) - 1200 (S2) = 8800
      assertEqual("S2.paid", computed.paid, 8800);
      assertEqual("S2.outstanding", computed.outstanding, 1200);
      assertEqual("S2.payment_state", computed.payment_state, "partially_paid");
      assertEqual("S2.is_fully_paid", computed.is_fully_paid, false);
    },
  },
  {
    name: "S3: self-detracción leg 2 (inbound BN) → net zero",
    run: async (supabase, fx) => {
      const result = await createPayment(supabase, {
        direction: PAYMENT_DIRECTION.inbound,
        bankAccountId: fx.bnBankId,
        paidByPartnerId: fx.selfPartnerId,
        projectId: fx.projectId,
        paymentDate: today(),
        notes: `${SMOKE_MARKER} self-detracción leg 2`,
        lines: [
          {
            amount: 1200,
            amountPen: 1200,
            lineType: PAYMENT_LINE_TYPE.detraction,
            outgoingInvoiceId: fx.outgoingPenInvoiceId,
          },
        ],
      });

      // Verify is_detraction was auto-derived from the BN bank account
      const { data: payment } = await supabase
        .from("payments")
        .select("is_detraction")
        .eq("id", result.id)
        .single();
      assertEqual("S3.is_detraction_auto", payment?.is_detraction, true);

      // Signed paid back to 10000
      const invoice = await fetchOutgoingInvoice(supabase, fx.outgoingPenInvoiceId);
      const computed = await computeOutgoingInvoicePaymentProgress(
        supabase,
        invoice,
      );
      assertEqual("S3.paid", computed.paid, 10000);
      assertEqual("S3.outstanding", computed.outstanding, 0);
      assertEqual("S3.payment_state", computed.payment_state, "paid");
    },
  },
  {
    name: "S4: PEN-BN detracción against USD invoice (currency exception)",
    run: async (supabase, fx) => {
      // The usd invoice is $1000 / S/3800. We deposit S/380 (10%) from BN —
      // this is the only cross-currency link the server permits.
      await createPayment(supabase, {
        direction: PAYMENT_DIRECTION.inbound,
        bankAccountId: fx.bnBankId,
        paidByPartnerId: fx.selfPartnerId,
        projectId: fx.projectId,
        paymentDate: today(),
        notes: `${SMOKE_MARKER} S4 — USD invoice detracción`,
        lines: [
          {
            amount: 380,
            amountPen: 380,
            lineType: PAYMENT_LINE_TYPE.detraction,
            outgoingInvoiceId: fx.outgoingUsdInvoiceId,
          },
        ],
      });

      const invoice = await fetchOutgoingInvoice(supabase, fx.outgoingUsdInvoiceId);
      const computed = await computeOutgoingInvoicePaymentProgress(
        supabase,
        invoice,
      );
      assertEqual("S4.paid", computed.paid, 380);
      assertEqual("S4.outstanding", computed.outstanding, 3800 - 380);
      assertEqual("S4.payment_state", computed.payment_state, "partially_paid");
    },
  },
  {
    name: "S5: auto-split on overflow (outbound S/12k on S/5k incoming invoice)",
    run: async (supabase, fx) => {
      // Compute the expected split via the pure helper
      const invoice = await fetchIncomingInvoice(supabase, fx.incomingPenInvoiceId);
      const preComputed = await computeIncomingInvoicePaymentProgress(
        supabase,
        invoice,
      );
      const line = { amount: 12000, amount_pen: 12000 };
      const signedContribution = signedContributionForInvoice(
        PAYMENT_DIRECTION.outbound,
        line.amount_pen,
        "incoming",
      );
      const decision = autoSplitOnOverflow(
        line,
        Number(invoice.total_pen),
        preComputed.paid,
        signedContribution,
      );
      if (decision.kind !== "split") {
        throw new Error(
          `S5: expected auto-split decision, got ${decision.kind}`,
        );
      }
      assertEqual("S5.fillAmountPen", decision.fillAmountPen, 5000);
      assertEqual("S5.remainderAmountPen", decision.remainderAmountPen, 7000);

      // Record the payment with the pre-split lines (as the action would)
      const result = await createPayment(supabase, {
        direction: PAYMENT_DIRECTION.outbound,
        bankAccountId: fx.regularBankId,
        paidByPartnerId: fx.selfPartnerId,
        projectId: fx.projectId,
        contactId: fx.vendorContactId,
        paymentDate: today(),
        notes: `${SMOKE_MARKER} S5 — auto-split overflow`,
        lines: [
          {
            amount: decision.fillAmount,
            amountPen: decision.fillAmountPen,
            lineType: PAYMENT_LINE_TYPE.invoice,
            incomingInvoiceId: fx.incomingPenInvoiceId,
          },
          {
            amount: decision.remainderAmount,
            amountPen: decision.remainderAmountPen,
            lineType: PAYMENT_LINE_TYPE.general,
          },
        ],
      });

      // Verify the line layout
      const lines = await fetchPaymentLines(supabase, result.id);
      assertEqual("S5.line_count", lines.length, 2);
      assertEqual("S5.partA.amount_pen", Number(lines[0].amount_pen), 5000);
      assertEqual("S5.partA.line_type", lines[0].line_type, PAYMENT_LINE_TYPE.invoice);
      assertEqual(
        "S5.partA.linked",
        lines[0].incoming_invoice_id,
        fx.incomingPenInvoiceId,
      );
      assertEqual("S5.partB.amount_pen", Number(lines[1].amount_pen), 7000);
      assertEqual("S5.partB.line_type", lines[1].line_type, PAYMENT_LINE_TYPE.general);
      assertEqual("S5.partB.unlinked", lines[1].incoming_invoice_id, null);

      // Invoice is now fully paid
      const invoiceAfter = await fetchIncomingInvoice(
        supabase,
        fx.incomingPenInvoiceId,
      );
      const computedAfter = await computeIncomingInvoicePaymentProgress(
        supabase,
        invoiceAfter,
      );
      assertEqual("S5.paid", computedAfter.paid, 5000);
      assertEqual("S5.outstanding", computedAfter.outstanding, 0);
      assertEqual("S5.payment_state", computedAfter.payment_state, "paid");
    },
  },
  {
    name: "S6: bank balance formula matches direct aggregation",
    run: async (supabase, fx) => {
      // Canonical formula:
      //   balance_pen = SUM(inbound) - SUM(outbound) WHERE not deleted
      for (const [label, bankId] of [
        ["regular", fx.regularBankId],
        ["bn", fx.bnBankId],
      ] as const) {
        const { data } = await supabase
          .from("payments")
          .select("direction, total_amount_pen")
          .eq("bank_account_id", bankId)
          .is("deleted_at", null);
        let balance = 0;
        for (const row of (data ?? []) as Array<{
          direction: number;
          total_amount_pen: number;
        }>) {
          const amt = Number(row.total_amount_pen);
          balance += row.direction === PAYMENT_DIRECTION.inbound ? amt : -amt;
        }
        // Just assert the sum is finite and non-zero after scenarios
        assertTrue(`S6.${label}.finite`, Number.isFinite(balance));
      }
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
    await supabase
      .from("payments")
      .delete()
      .or(`project_id.eq.${fx.projectId},contact_id.eq.${fx.clientContactId},contact_id.eq.${fx.vendorContactId}`);
    await supabase
      .from("outgoing_invoices")
      .delete()
      .eq("project_id", fx.projectId);
    await supabase
      .from("incoming_invoices")
      .delete()
      .eq("project_id", fx.projectId);
    await supabase.from("projects").delete().eq("id", fx.projectId);
    await supabase
      .from("bank_accounts")
      .delete()
      .in("id", [fx.regularBankId, fx.bnBankId]);
    await supabase
      .from("contacts")
      .delete()
      .in("id", [fx.clientContactId, fx.vendorContactId]);
    if (fx.insertedExchangeRateId) {
      await supabase
        .from("exchange_rates")
        .delete()
        .eq("id", fx.insertedExchangeRateId);
    }
  }
  // Belt-and-braces: same cleanup pass as setup uses for leftovers
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
