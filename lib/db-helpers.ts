import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Normalize pagination params with sensible defaults and bounds.
 */
export function normalizePagination(
  limit?: number,
  offset?: number,
): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE),
    offset: Math.max(offset ?? 0, 0),
  };
}

/**
 * Current UTC timestamp as ISO string. Centralizes timestamp generation
 * for consistency and testability.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Fetch a single active (non-soft-deleted) row by ID.
 * Returns null if not found or deleted.
 */
export async function fetchActiveById<T>(
  supabase: SupabaseClient,
  table: string,
  id: string,
  columns: string = "*",
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (error || !data) return null;
  return data as T;
}
