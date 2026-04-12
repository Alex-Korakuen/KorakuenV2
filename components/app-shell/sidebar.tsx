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
    <div className="space-y-0.5">
      {group.items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 font-semibold text-accent-foreground"
                : "text-muted-foreground hover:bg-primary/[0.06]",
            )}
          >
            <Icon
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                active ? "text-primary" : "text-muted-foreground/60",
              )}
            />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({ variant, user }: Props) {
  const pathname = usePathname();
  const groups = variant === "admin" ? ADMIN_NAV : PARTNER_NAV;
  const initials = getInitials(user.displayName, user.email);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center px-5">
        <span className="text-base font-bold tracking-tight text-foreground/80">
          Korakuen
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {groups.map((group, idx) => (
          <div key={idx}>
            {idx > 0 && <div className="my-3 border-t border-border/60" />}
            <NavGroupBlock group={group} pathname={pathname} />
          </div>
        ))}
      </nav>

      <div className="px-3 py-3">
        <SidebarUserMenu
          initials={initials}
          displayName={user.displayName}
          email={user.email}
        />
      </div>
    </aside>
  );
}
