"use server";

import { requireAdmin } from "@/lib/auth";
import { createServerClient } from "@/lib/db";
import { normalizePagination, fetchActiveById } from "@/lib/db-helpers";
import { success, failure } from "@/lib/types";
import type {
  ValidationResult,
  BankAccountRow,
  CreateBankAccountInput,
} from "@/lib/types";
import {
  validateCreateBankAccount,
  validateUpdateBankAccount,
} from "@/lib/validators/bank-accounts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BankAccountWithBalance = BankAccountRow & {
  _computed: { balance_pen: number };
};

type BankAccountListFilters = {
  is_active?: boolean;
  account_type?: number;
  currency?: string;
  include_deleted?: boolean;
  limit?: number;
  offset?: number;
};

type PaginatedBankAccounts = {
  data: BankAccountWithBalance[];
  total: number;
  limit: number;
  offset: number;
};

// ---------------------------------------------------------------------------
// getBankAccounts
// ---------------------------------------------------------------------------

export async function getBankAccounts(
  filters?: BankAccountListFilters,
): Promise<ValidationResult<PaginatedBankAccounts>> {
  await requireAdmin();

  const { limit, offset } = normalizePagination(filters?.limit, filters?.offset);

  const supabase = await createServerClient();

  let query = supabase.from("bank_accounts").select("*", { count: "exact" });

  if (!filters?.include_deleted) {
    query = query.is("deleted_at", null);
  }

  if (filters?.is_active !== undefined) {
    query = query.eq("is_active", filters.is_active);
  }
  if (filters?.account_type !== undefined) {
    query = query.eq("account_type", filters.account_type);
  }
  if (filters?.currency) {
    query = query.eq("currency", filters.currency);
  }

  query = query
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  const { data: accounts, count, error } = await query;

  if (error) {
    return failure("NOT_FOUND", "Failed to fetch bank accounts");
  }

  const rows = (accounts ?? []) as BankAccountRow[];

  // Derive balances via Postgres function — single round trip
  let balanceMap: Record<string, number> = {};

  if (rows.length > 0) {
    const accountIds = rows.map((a) => a.id);
    const { data: balances, error: balanceError } = await supabase.rpc(
      "get_bank_account_balances",
      { account_ids: accountIds },
    );

    if (!balanceError && balances) {
      for (const b of balances as { bank_account_id: string; balance_pen: number }[]) {
        balanceMap[b.bank_account_id] = Number(b.balance_pen);
      }
    }
  }

  const data: BankAccountWithBalance[] = rows.map((account) => ({
    ...account,
    _computed: {
      balance_pen: balanceMap[account.id] ?? 0,
    },
  }));

  return success({ data, total: count ?? 0, limit, offset });
}

// ---------------------------------------------------------------------------
// createBankAccount
// ---------------------------------------------------------------------------

export async function createBankAccount(
  data: CreateBankAccountInput,
): Promise<ValidationResult<BankAccountWithBalance>> {
  await requireAdmin();

  const validation = validateCreateBankAccount(data);
  if (!validation.success) return validation as ValidationResult<BankAccountWithBalance>;

  const supabase = await createServerClient();

  const { data: inserted, error } = await supabase
    .from("bank_accounts")
    .insert(validation.data)
    .select()
    .single();

  if (error) {
    return failure("VALIDATION_ERROR", error.message);
  }

  return success({
    ...(inserted as BankAccountRow),
    _computed: { balance_pen: 0 },
  });
}

// ---------------------------------------------------------------------------
// updateBankAccount
// ---------------------------------------------------------------------------

export async function updateBankAccount(
  id: string,
  data: Record<string, unknown>,
): Promise<ValidationResult<BankAccountRow>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const existing = await fetchActiveById<BankAccountRow>(supabase, "bank_accounts", id);
  if (!existing) {
    return failure("NOT_FOUND", "Bank account not found");
  }

  const validation = validateUpdateBankAccount(data, existing);
  if (!validation.success) return validation as ValidationResult<BankAccountRow>;

  const updateFields = validation.data;

  if (Object.keys(updateFields).length === 0) {
    return success(existing);
  }

  const { data: updated, error: updateError } = await supabase
    .from("bank_accounts")
    .update({ ...updateFields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !updated) {
    return failure("VALIDATION_ERROR", updateError?.message ?? "Update failed");
  }

  return success(updated as BankAccountRow);
}

// ---------------------------------------------------------------------------
// archiveBankAccount
// ---------------------------------------------------------------------------

export async function archiveBankAccount(
  id: string,
): Promise<ValidationResult<{ id: string; deleted_at: string }>> {
  await requireAdmin();

  const supabase = await createServerClient();

  const existing = await fetchActiveById(supabase, "bank_accounts", id, "id");
  if (!existing) {
    return failure("NOT_FOUND", "Bank account not found");
  }

  // Block if any active payments reference this account
  const { count, error: countError } = await supabase
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("bank_account_id", id)
    .is("deleted_at", null);

  if (countError) {
    return failure("VALIDATION_ERROR", "Failed to check payment references");
  }

  if ((count ?? 0) > 0) {
    return failure(
      "CONFLICT",
      `No se puede archivar esta cuenta porque tiene ${count} pago(s) activo(s)`,
      { payments: `${count} active payment(s) reference this account` },
    );
  }

  const deletedAt = new Date().toISOString();
  const { error: deleteError } = await supabase
    .from("bank_accounts")
    .update({ deleted_at: deletedAt })
    .eq("id", id);

  if (deleteError) {
    return failure("VALIDATION_ERROR", deleteError.message);
  }

  return success({ id, deleted_at: deletedAt });
}
