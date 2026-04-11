"use client";

import { usePathname } from "next/navigation";
import { ADMIN_NAV, PARTNER_NAV, findNavLabel } from "./nav-config";
import { formatDateLong } from "@/lib/format";

type Props = {
  variant: "admin" | "partner";
};

export function TopBarTitle({ variant }: Props) {
  const pathname = usePathname();
  const groups = variant === "admin" ? ADMIN_NAV : PARTNER_NAV;
  const label = findNavLabel(groups, pathname) ?? "Inicio";
  const today = formatDateLong(new Date().toISOString());

  return (
    <div>
      <h1 className="text-base font-semibold text-slate-900">{label}</h1>
      <p className="text-xs text-slate-500">{today}</p>
    </div>
  );
}
