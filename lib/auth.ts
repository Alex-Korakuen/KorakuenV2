import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/db";
import { USER_ROLE } from "@/lib/types";

export type CurrentUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: number;
};

/**
 * Get the currently authenticated user with role.
 * Returns null if not authenticated or user not found in users table.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data, error } = await supabase
    .from("users")
    .select("id, email, display_name, role")
    .eq("id", user.id)
    .is("deleted_at", null)
    .single();

  if (error || !data) return null;

  return data as CurrentUser;
}

/**
 * Get the current user or redirect to /login.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Require admin role. Redirects to /login if unauthenticated,
 * or to /panel if authenticated but not admin.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== USER_ROLE.admin) redirect("/panel");
  return user;
}

/**
 * Require partner role. Redirects to /login if unauthenticated,
 * or to /dashboard if authenticated but not partner.
 */
export async function requirePartner(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== USER_ROLE.partner) redirect("/dashboard");
  return user;
}
