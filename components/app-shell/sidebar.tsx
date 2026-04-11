"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, PARTNER_NAV, type NavGroup } from "./nav-config";
import { SidebarUserMenu } from "./sidebar-user-menu";
import { cn } from "@/lib/utils";

type Props = {
  variant: "admin" | "partner";
  user: {
    displayName: string;
    email: string;
  };
};

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  return pathname.startsWith(href + "/");
}

function getInitials(displayName: string, email: string): string {
  const source = displayName?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "??").toUpperCase();
}

function NavGroupBlock({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  return (
    <div>
      {group.heading && (
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {group.heading}
        </p>
      )}
      <div className="space-y-0.5">
        {group.items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-blue-50 font-semibold text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-blue-600" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-blue-600" : "text-slate-400",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function Sidebar({ variant, user }: Props) {
  const pathname = usePathname();
  const groups = variant === "admin" ? ADMIN_NAV : PARTNER_NAV;
  const roleLabel = variant === "admin" ? "Administrador" : "Socio";
  const initials = getInitials(user.displayName, user.email);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
      {/* Brand */}
      <div className="flex h-16 flex-col justify-center border-b border-slate-200 px-5">
        <span className="text-lg font-bold tracking-tight text-slate-900">
          KORAKUEN
        </span>
        <span className="text-[11px] uppercase tracking-wider text-slate-500">
          {roleLabel}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-6">
          {groups.map((group, idx) => (
            <NavGroupBlock
              key={group.heading ?? `group-${idx}`}
              group={group}
              pathname={pathname}
            />
          ))}
        </div>
      </nav>

      {/* User menu */}
      <div className="border-t border-slate-200 px-3 py-3">
        <SidebarUserMenu
          initials={initials}
          displayName={user.displayName}
          email={user.email}
        />
      </div>
    </aside>
  );
}
