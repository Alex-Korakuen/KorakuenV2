"use server";

import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, nowISO } from "@/lib/db-helpers";
import {
  success,
  failure,
  SUBMISSION_STATUS,
  SUBMISSION_SOURCE_TYPE,
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
} from "@/lib/types";
import {
  parseCsvPaymentRows,
  groupRowsByGroupId,
  buildSubmissionFromGroup,
} from "@/lib/validators/inbox";
import { findOrCreateContactByRuc } from "./contacts";

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
