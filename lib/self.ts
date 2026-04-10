import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRow } from "@/lib/types";

/**
 * Resolve the single contact row that represents Korakuen itself.
 * Returns null if the is_self row has not been seeded yet.
 *
 * Request-scoped: `cache()` ensures multiple callers in the same render
 * share one database query.
 */
export const getSelfContact = cache(
  async (supabase: SupabaseClient): Promise<ContactRow | null> => {
    const { data, error } = await supabase
      .from("contacts")
      .select("*")
      .eq("is_self", true)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw error;
    return data as ContactRow | null;
  },
);

/**
 * Convenience wrapper returning only Korakuen's RUC.
 */
export async function getSelfRuc(
  supabase: SupabaseClient,
): Promise<string | null> {
  const self = await getSelfContact(supabase);
  return self?.ruc ?? null;
}
