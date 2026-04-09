"use client";

import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/db-client";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="text-sm text-gray-500 hover:text-gray-700"
    >
      Cerrar sesión
    </button>
  );
}
