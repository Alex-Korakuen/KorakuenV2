import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client.
 * Use in client components.
 */
export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
