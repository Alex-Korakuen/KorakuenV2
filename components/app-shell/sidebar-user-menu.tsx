"use client";

import { LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createBrowserClient } from "@/lib/db-client";

type Props = {
  initials: string;
  displayName: string;
  email: string;
};

export function SidebarUserMenu({ initials, displayName, email }: Props) {
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    const supabase = createBrowserClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-accent-foreground">
            {initials}
          </div>
          <span className="truncate text-sm text-muted-foreground">
            {displayName}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[200px]"
      >
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="h-4 w-4" />
          Mi cuenta
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Settings className="h-4 w-4" />
          Configuración
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault();
            void handleLogout();
          }}
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
