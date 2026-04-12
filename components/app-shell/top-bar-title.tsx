"use client";

import { usePathname } from "next/navigation";
import { ADMIN_NAV, PARTNER_NAV, findNavLabel } from "./nav-config";

type Props = {
  variant: "admin" | "partner";
};

export function TopBarTitle({ variant }: Props) {
  const pathname = usePathname();
  const groups = variant === "admin" ? ADMIN_NAV : PARTNER_NAV;
  const label = findNavLabel(groups, pathname) ?? "Inicio";

  return <h1 className="text-sm font-medium text-stone-500">{label}</h1>;
}
