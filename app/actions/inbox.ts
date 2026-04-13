"use server";

import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import {
  fetchActiveById,
  normalizePagination,
  nowISO,
} from "@/lib/db-helpers";
import {
  success,
  failure,
  SUBMISSION_STATUS,
  SUBMISSION_SOURCE_TYPE,
  SOURCE,
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
} from "@/lib/types";
import type {
  ValidationResult,
  SubmissionRow,
  PaymentSubmissionExtractedData,
  PaymentSubmissionHeader,
  PaymentSubmissionLine,
  BankAccountRow,
  ProjectRow,
  ContactRow,
  SubmissionFieldError,
  CreatePaymentInput,
  CreatePaymentLineInput,
} from "@/lib/types";
import type { PaymentWithLinesAndComputed } from "./payments";
import {
  parseCsvPaymentRows,
  groupRowsByGroupId,
  buildSubmissionFromGroup,
  validateApproveSubmission,
  validateRejectSubmission,
  validatePaymentSubmissionData,
} from "@/lib/validators/inbox";
import { findOrCreateContactByRuc } from "./contacts";
import { createPayment } from "./payments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreateInboxBatchInput = {
  csvText: string;
  filename: string;
};

type CreateInboxBatchResult = {
  batchId: string;
  label: string;
  totalGroups: number;
  created: number;
  validCount: number;
  errorCount: number;
};

type InboxListFilters = {
  review_status?: number;
  import_batch_id?: string | null;
  source_type?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

type PaginatedInboxRows = {
  data: SubmissionRow[];
  total: number;
  limit: number;
  offset: number;
};

type InboxBatchSummary = {
  import_batch_id: string;
  import_batch_label: string | null;
  uploaded_at: string;
  total: number;
  pending: number;
  valid: number;
  errors: number;
  approved: number;
  rejected: number;
};

const CSV_SIZE_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// createInboxBatch
// ---------------------------------------------------------------------------

/**
 * Parse a CSV file, group its rows into payment submissions, resolve FK
 * labels against the live DB, auto-create contacts for unknown RUCs via
 * SUNAT, and insert one `submissions` row per group.
 *
 * Best-effort: groups with parse/semantic/resolution errors still get
 * inserted, with `review_status=pending` and their errors recorded in
 * `extracted_data.validation`. The user fixes them inline in the Inbox UI.
 */
export async function createInboxBatch(
  input: CreateInboxBatchInput,
): Promise<ValidationResult<CreateInboxBatchResult>> {
  const user = await requireAdmin();

  if (!input.csvText || !input.csvText.trim()) {
    return failure("VALIDATION_ERROR", "El CSV está vacío", {
      csvText: "Required",
    });
  }
  if (Buffer.byteLength(input.csvText, "utf8") > CSV_SIZE_LIMIT_BYTES) {
    return failure(
      "VALIDATION_ERROR",
      "El CSV excede el tamaño máximo permitido (5 MB)",
      { csvText: "Too large" },
    );
  }

  // 1. Parse + group
  const parsed = parseCsvPaymentRows(input.csvText);
  if (!parsed.success) return parsed;
  const groups = groupRowsByGroupId(parsed.data);
  if (groups.size === 0) {
    return failure("VALIDATION_ERROR", "El CSV no contiene filas de datos");
  }

  // 2. Pre-load reference data once to avoid N round-trips.
  const supabase = await createServerClient();
  const [bankAccountsResult, projectsResult] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true),
    supabase.from("projects").select("*").is("deleted_at", null),
  ]);

  if (bankAccountsResult.error) {
    return failure(
      "NOT_FOUND",
      `No se pudieron cargar cuentas bancarias: ${bankAccountsResult.error.message}`,
    );
  }
  if (projectsResult.error) {
    return failure(
      "NOT_FOUND",
      `No se pudieron cargar proyectos: ${projectsResult.error.message}`,
    );
  }

  const bankAccounts = (bankAccountsResult.data ?? []) as BankAccountRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];

  // 3. Build one submission per group, resolving FKs and auto-creating
  //    contacts as needed. Contact cache so the same RUC used across
  //    groups only hits SUNAT once.
  const contactCache = new Map<string, ContactRow>();
  const submissions: Array<{
    extractedData: PaymentSubmissionExtractedData;
  }> = [];

  for (const [groupId, rows] of groups.entries()) {
    const extracted = buildSubmissionFromGroup(groupId, rows);
    await resolveSubmissionForeignKeys(extracted, {
      bankAccounts,
      projects,
      contactCache,
    });
    submissions.push({ extractedData: extracted });
  }

  // 4. Insert all submissions in one batched call.
  const batchId = randomUUID();
  const insertRows = submissions.map((s) => ({
    source_type: SUBMISSION_SOURCE_TYPE.payment,
    submitted_by: user.id,
    extracted_data: s.extractedData,
    review_status: SUBMISSION_STATUS.pending,
    import_batch_id: batchId,
    import_batch_label: input.filename,
  }));

  const { error: insertError } = await supabase
    .from("submissions")
    .insert(insertRows);

  if (insertError) {
    return failure(
      "VALIDATION_ERROR",
      `No se pudieron guardar las filas: ${insertError.message}`,
    );
  }

  const validCount = submissions.filter(
    (s) => s.extractedData.validation.valid,
  ).length;
  const errorCount = submissions.length - validCount;

  return success({
    batchId,
    label: input.filename,
    totalGroups: groups.size,
    created: submissions.length,
    validCount,
    errorCount,
  });
}

// ---------------------------------------------------------------------------
// resolveSubmissionForeignKeys (internal)
// ---------------------------------------------------------------------------

/**
 * Mutates the passed extracted_data in place, filling in bank_account_id,
 * project_id, contact_id (and optionally auto-creating contacts). Adds
 * field-level errors to `extracted_data.validation.errors` when a label
 * can't be resolved.
 */
async function resolveSubmissionForeignKeys(
  extracted: PaymentSubmissionExtractedData,
  refs: {
    bankAccounts: BankAccountRow[];
    projects: ProjectRow[];
    contactCache: Map<string, ContactRow>;
  },
): Promise<void> {
  const h = extracted.header;
  const errors: SubmissionFieldError[] = [];

  // Bank account: exact match on name, then on last-4 of account_number.
  if (h.bank_account_label) {
    const label = h.bank_account_label.trim();
    const byName = refs.bankAccounts.find(
      (b) => b.name.toLowerCase() === label.toLowerCase(),
    );
    if (byName) {
      h.bank_account_id = byName.id;
    } else {
      const last4 = label.replace(/\D/g, "").slice(-4);
      const byLast4 =
        last4.length === 4
          ? refs.bankAccounts.find((b) =>
              (b.account_number ?? "").endsWith(last4),
            )
          : undefined;
      if (byLast4) {
        h.bank_account_id = byLast4.id;
      } else {
        errors.push({
          path: "header.bank_account",
          message: `Cuenta bancaria "${h.bank_account_label}" no encontrada`,
        });
      }
    }
  }

  // Project (optional): match by code
  if (h.project_code) {
    const project = refs.projects.find(
      (p) =>
        p.code != null &&
        p.code.toLowerCase() === h.project_code!.toLowerCase(),
    );
    if (project) {
      h.project_id = project.id;
    } else {
      errors.push({
        path: "header.project_code",
        message: `Proyecto "${h.project_code}" no encontrado`,
      });
    }
  }

  // Contact: local lookup → SUNAT auto-create fallback.
  if (h.contact_ruc && h.direction) {
    const cached = refs.contactCache.get(h.contact_ruc);
    if (cached) {
      h.contact_id = cached.id;
    } else {
      const r = await findOrCreateContactByRuc(h.contact_ruc, h.direction);
      if (r.success) {
        h.contact_id = r.data.id;
        refs.contactCache.set(h.contact_ruc, r.data);
      } else {
        errors.push({
          path: "header.contact_ruc",
          message: r.error.message,
        });
      }
    }
  }

  // Lines — invoice_number_hint stays as hint; no FK resolution here.
  // It'll be resolved inline by the editor or at approve time.

  // Merge any new errors into the existing validation report.
  extracted.validation.errors.push(...errors);
  extracted.validation.valid = extracted.validation.errors.length === 0;
}

// ---------------------------------------------------------------------------
// getInboxSubmissions
// ---------------------------------------------------------------------------

export async function getInboxSubmissions(
  filters?: InboxListFilters,
): Promise<ValidationResult<PaginatedInboxRows>> {
  await requireAdmin();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);
  const supabase = await createServerClient();

  let query = supabase
    .from("submissions")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .eq(
      "source_type",
      filters?.source_type ?? SUBMISSION_SOURCE_TYPE.payment,
    );

  if (filters?.review_status !== undefined) {
    query = query.eq("review_status", filters.review_status);
  }

  if (filters?.import_batch_id) {
    query = query.eq("import_batch_id", filters.import_batch_id);
  }

  if (filters?.search) {
    const term = filters.search.trim();
    if (term) {
      // jsonb text search on bank_reference + contact_ruc
      query = query.or(
        `extracted_data->header->>bank_reference.ilike.%${term}%,extracted_data->header->>contact_ruc.ilike.%${term}%`,
      );
    }
  }

  query = query
    .order("import_batch_id", { ascending: false, nullsFirst: false })
    .order("submitted_at", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    return failure(
      "NOT_FOUND",
      `No se pudieron cargar las submissions: ${error.message}`,
    );
  }

  return success({
    data: (data ?? []) as SubmissionRow[],
    total: count ?? 0,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// getInboxBatches
// ---------------------------------------------------------------------------

export async function getInboxBatches(): Promise<
  ValidationResult<InboxBatchSummary[]>
> {
  await requireAdmin();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("submissions")
    .select(
      "import_batch_id, import_batch_label, submitted_at, review_status, extracted_data",
    )
    .is("deleted_at", null)
    .eq("source_type", SUBMISSION_SOURCE_TYPE.payment)
    .not("import_batch_id", "is", null)
    .order("submitted_at", { ascending: false });

  if (error) {
    return failure(
      "NOT_FOUND",
      `No se pudieron cargar los lotes: ${error.message}`,
    );
  }

  const byBatch = new Map<string, InboxBatchSummary>();
  for (const row of data ?? []) {
    const batchId = row.import_batch_id as string;
    if (!batchId) continue;

    let summary = byBatch.get(batchId);
    if (!summary) {
      summary = {
        import_batch_id: batchId,
        import_batch_label: row.import_batch_label ?? null,
        uploaded_at: row.submitted_at as string,
        total: 0,
        pending: 0,
        valid: 0,
        errors: 0,
        approved: 0,
        rejected: 0,
      };
      byBatch.set(batchId, summary);
    }

    summary.total += 1;
    if (row.review_status === SUBMISSION_STATUS.pending) summary.pending += 1;
    if (row.review_status === SUBMISSION_STATUS.approved) summary.approved += 1;
    if (row.review_status === SUBMISSION_STATUS.rejected) summary.rejected += 1;

    const extracted = row.extracted_data as
      | PaymentSubmissionExtractedData
      | null;
    if (extracted?.validation?.valid) {
      summary.valid += 1;
    } else if (row.review_status === SUBMISSION_STATUS.pending) {
      summary.errors += 1;
    }
  }

  return success(Array.from(byBatch.values()));
}

// ---------------------------------------------------------------------------
// approveSubmission
// ---------------------------------------------------------------------------

/**
 * Turn a staged submission into a real payment. Re-validates FK liveness,
 * computes amount_pen per line, passes the payload to createPayment (which
 * does the heavy lifting), and flips the submission to approved on success.
 *
 * On failure, writes the error back into the submission's
 * `extracted_data.validation.errors` so the Inbox UI shows the blocker
 * without requiring another click.
 */
export async function approveSubmission(
  submissionId: string,
): Promise<ValidationResult<PaymentWithLinesAndComputed>> {
  const user = await requireAdmin();
  const supabase = await createServerClient();

  const submission = await fetchActiveById<SubmissionRow>(
    supabase,
    "submissions",
    submissionId,
  );
  if (!submission) {
    return failure("NOT_FOUND", "Submission no encontrada");
  }

  const gate = validateApproveSubmission(submission);
  if (!gate.success) return gate as ValidationResult<PaymentWithLinesAndComputed>;

  const extracted = gate.data;
  const header = extracted.header;

  // FK liveness re-check (R2: contact could have been soft-deleted between
  // stage and approval).
  const livenessErrors: SubmissionFieldError[] = [];
  if (!header.bank_account_id) {
    livenessErrors.push({
      path: "header.bank_account",
      message: "Cuenta bancaria no resuelta",
    });
  } else {
    const bank = await fetchActiveById<BankAccountRow>(
      supabase,
      "bank_accounts",
      header.bank_account_id,
    );
    if (!bank) {
      livenessErrors.push({
        path: "header.bank_account",
        message: "Cuenta bancaria ya no existe o fue eliminada",
      });
    }
  }
  if (!header.contact_id) {
    livenessErrors.push({
      path: "header.contact_ruc",
      message: "Contacto no resuelto",
    });
  } else {
    const contact = await fetchActiveById<ContactRow>(
      supabase,
      "contacts",
      header.contact_id,
    );
    if (!contact) {
      livenessErrors.push({
        path: "header.contact_ruc",
        message: "El contacto ya no existe o fue eliminado",
      });
    }
  }
  if (header.project_id) {
    const project = await fetchActiveById<ProjectRow>(
      supabase,
      "projects",
      header.project_id,
    );
    if (!project) {
      livenessErrors.push({
        path: "header.project_code",
        message: "El proyecto ya no existe o fue eliminado",
      });
    }
  }

  if (livenessErrors.length > 0) {
    await persistValidationErrors(
      supabase,
      submissionId,
      extracted,
      livenessErrors,
    );
    return failure(
      "VALIDATION_ERROR",
      "Algunos datos referenciados ya no existen en el sistema",
      Object.fromEntries(livenessErrors.map((e) => [e.path, e.message])),
    );
  }

  // Build createPayment input
  const build = buildCreatePaymentInputFromSubmission(extracted, submissionId);
  if (!build.success) {
    await persistValidationErrors(
      supabase,
      submissionId,
      extracted,
      build.error.fields
        ? Object.entries(build.error.fields).map(([k, v]) => ({
            path: k,
            message: v,
          }))
        : [{ path: "build", message: build.error.message }],
    );
    return build as ValidationResult<PaymentWithLinesAndComputed>;
  }

  // Hand off to createPayment — it does currency/invoice/bank rules itself.
  const paymentResult = await createPayment(build.data.data, build.data.lines);
  if (!paymentResult.success) {
    // Surface createPayment's per-field errors back into the submission so
    // the row visibly flips to error state without a reload.
    const errs: SubmissionFieldError[] = paymentResult.error.fields
      ? Object.entries(paymentResult.error.fields).map(([k, v]) => ({
          path: k,
          message: v,
        }))
      : [{ path: "createPayment", message: paymentResult.error.message }];
    await persistValidationErrors(supabase, submissionId, extracted, errs);
    return paymentResult;
  }

  // Flip the submission to approved + link back to the created payment.
  const now = nowISO();
  const { error: updateError } = await supabase
    .from("submissions")
    .update({
      review_status: SUBMISSION_STATUS.approved,
      reviewed_by: user.id,
      reviewed_at: now,
      resulting_record_id: paymentResult.data.id,
      resulting_record_type: "payments",
      updated_at: now,
    })
    .eq("id", submissionId);

  if (updateError) {
    // The payment is already created but the submission link failed. Not
    // ideal but not catastrophic — return the payment and log.
    return failure(
      "VALIDATION_ERROR",
      `Pago creado pero no se pudo marcar la submission como aprobada: ${updateError.message}`,
    );
  }

  return paymentResult;
}

// ---------------------------------------------------------------------------
// rejectSubmission
// ---------------------------------------------------------------------------

export async function rejectSubmission(
  submissionId: string,
  notes?: string,
): Promise<ValidationResult<SubmissionRow>> {
  const user = await requireAdmin();
  const supabase = await createServerClient();

  const submission = await fetchActiveById<SubmissionRow>(
    supabase,
    "submissions",
    submissionId,
  );
  if (!submission) {
    return failure("NOT_FOUND", "Submission no encontrada");
  }

  const gate = validateRejectSubmission(submission);
  if (!gate.success) return gate as ValidationResult<SubmissionRow>;

  const now = nowISO();
  const { data: updated, error } = await supabase
    .from("submissions")
    .update({
      review_status: SUBMISSION_STATUS.rejected,
      reviewed_by: user.id,
      reviewed_at: now,
      rejection_notes: notes?.trim() || null,
      updated_at: now,
    })
    .eq("id", submissionId)
    .select()
    .single();

  if (error || !updated) {
    return failure(
      "VALIDATION_ERROR",
      error?.message ?? "No se pudo rechazar la submission",
    );
  }

  return success(updated as SubmissionRow);
}

// ---------------------------------------------------------------------------
// approveBatchValid
// ---------------------------------------------------------------------------

type BatchApprovalReport = {
  approved: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: string[];
};

/**
 * Loop through every pending-and-valid submission in a batch, approving
 * each one sequentially. Best-effort: failures do not stop the loop, and
 * per-row errors are persisted back into each submission's extracted_data
 * so the UI reflects what went wrong.
 */
export async function approveBatchValid(
  batchId: string,
): Promise<ValidationResult<BatchApprovalReport>> {
  await requireAdmin();
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("submissions")
    .select("id, extracted_data, review_status, deleted_at")
    .eq("import_batch_id", batchId)
    .eq("source_type", SUBMISSION_SOURCE_TYPE.payment)
    .eq("review_status", SUBMISSION_STATUS.pending)
    .is("deleted_at", null);

  if (error) {
    return failure(
      "NOT_FOUND",
      `No se pudieron cargar las submissions del lote: ${error.message}`,
    );
  }

  const report: BatchApprovalReport = {
    approved: [],
    failed: [],
    skipped: [],
  };

  for (const row of data ?? []) {
    const extracted = row.extracted_data as
      | PaymentSubmissionExtractedData
      | null;
    if (!extracted || !extracted.validation?.valid) {
      report.skipped.push(row.id as string);
      continue;
    }
    const result = await approveSubmission(row.id as string);
    if (result.success) {
      report.approved.push(row.id as string);
    } else {
      report.failed.push({
        id: row.id as string,
        error: result.error.message,
      });
    }
  }

  return success(report);
}

// ---------------------------------------------------------------------------
// buildCreatePaymentInputFromSubmission (internal)
// ---------------------------------------------------------------------------

function buildCreatePaymentInputFromSubmission(
  extracted: PaymentSubmissionExtractedData,
  submissionId: string,
): ValidationResult<{
  data: CreatePaymentInput;
  lines: CreatePaymentLineInput[];
}> {
  const h = extracted.header;

  // These should have been caught by validateApproveSubmission already,
  // but the type system wants explicit narrowing.
  if (
    !h.payment_date ||
    !h.direction ||
    !h.bank_account_id ||
    !h.currency ||
    !h.contact_id
  ) {
    return failure("VALIDATION_ERROR", "Submission incompleta", {
      build: "Missing required header fields after validation",
    });
  }

  const directionCode =
    h.direction === "inbound"
      ? PAYMENT_DIRECTION.inbound
      : PAYMENT_DIRECTION.outbound;

  const data: CreatePaymentInput = {
    direction: directionCode,
    bank_account_id: h.bank_account_id,
    project_id: h.project_id,
    contact_id: h.contact_id,
    currency: h.currency,
    exchange_rate: h.exchange_rate,
    payment_date: h.payment_date,
    bank_reference: h.bank_reference,
    notes: h.notes,
    source: SOURCE.csv_import,
    submission_id: submissionId,
  };

  // Compute amount_pen per line. For PEN, it's equal to amount. For USD,
  // multiply by exchange_rate. If exchange_rate is null for USD, createPayment
  // will look it up from the exchange_rates table — but amount_pen is still
  // required on insert, so we need a fallback. We refuse the build if USD
  // without rate is hit here; the user needs to fill in the rate first.
  let ratePerPen = 1;
  if (h.currency === "USD") {
    if (h.exchange_rate == null || h.exchange_rate <= 0) {
      return failure(
        "VALIDATION_ERROR",
        "Tipo de cambio requerido para pagos en USD",
        { "header.exchange_rate": "Required for USD" },
      );
    }
    ratePerPen = h.exchange_rate;
  }

  const lines: CreatePaymentLineInput[] = extracted.lines.map((l, idx) => {
    const amount = l.amount ?? 0;
    return {
      sort_order: idx,
      amount,
      amount_pen: amount * ratePerPen,
      outgoing_invoice_id:
        directionCode === PAYMENT_DIRECTION.inbound
          ? l.outgoing_invoice_id ?? null
          : null,
      incoming_invoice_id:
        directionCode === PAYMENT_DIRECTION.outbound
          ? l.incoming_invoice_id ?? null
          : null,
      cost_category_id: l.cost_category_id ?? null,
      line_type: paymentLineTypeToCode(l.line_type),
      notes: l.notes,
    };
  });

  return success({ data, lines });
}

function paymentLineTypeToCode(
  t: PaymentSubmissionLine["line_type"],
): number {
  switch (t) {
    case "invoice":
      return PAYMENT_LINE_TYPE.invoice;
    case "bank_fee":
      return PAYMENT_LINE_TYPE.bank_fee;
    case "detraction":
      return PAYMENT_LINE_TYPE.detraction;
    case "loan":
      return PAYMENT_LINE_TYPE.loan;
    case "general":
    default:
      return PAYMENT_LINE_TYPE.general;
  }
}

// ---------------------------------------------------------------------------
// persistValidationErrors (internal)
// ---------------------------------------------------------------------------

/**
 * Merge new error entries into a submission's extracted_data.validation.
 * Used when approval surfaces problems that weren't visible at stage time
 * (FK soft-delete, createPayment refusal, etc.). Leaves existing errors
 * in place and adds the new ones, keeping the array deduped by path+message.
 */
async function persistValidationErrors(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  submissionId: string,
  extracted: PaymentSubmissionExtractedData,
  newErrors: SubmissionFieldError[],
): Promise<void> {
  if (newErrors.length === 0) return;
  const existing = extracted.validation.errors ?? [];
  const dedup = new Map<string, SubmissionFieldError>();
  for (const e of [...existing, ...newErrors]) {
    dedup.set(`${e.path}::${e.message}`, e);
  }
  const merged = Array.from(dedup.values());
  const nextData: PaymentSubmissionExtractedData = {
    ...extracted,
    validation: { valid: false, errors: merged },
  };
  await supabase
    .from("submissions")
    .update({ extracted_data: nextData, updated_at: nowISO() })
    .eq("id", submissionId);
}
