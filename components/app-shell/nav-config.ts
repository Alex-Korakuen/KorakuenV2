import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CheckSquare,
  FileDown,
  FileUp,
  FolderKanban,
  Home,
  Landmark,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  heading?: string;
  items: NavItem[];
};

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Inicio", icon: Home },
      { href: "/contactos", label: "Contactos", icon: Users },
      { href: "/bancos", label: "Bancos", icon: Landmark },
      { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
    ],
  },
  {
    heading: "Documentos",
    items: [
      { href: "/facturas-emitidas", label: "Facturas emitidas", icon: FileUp },
      {
        href: "/facturas-recibidas",
        label: "Facturas recibidas",
        icon: FileDown,
      },
      { href: "/pagos", label: "Pagos", icon: Wallet },
      { href: "/conciliacion", label: "Conciliación", icon: CheckSquare },
    ],
  },
  {
    heading: "Análisis",
    items: [
      { href: "/reportes", label: "Reportes", icon: BarChart3 },
      { href: "/configuracion", label: "Configuración", icon: Settings },
    ],
  },
];

export const PARTNER_NAV: NavGroup[] = [
  {
    items: [
      { href: "/panel", label: "Inicio", icon: Home },
      { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
      { href: "/liquidacion", label: "Liquidación", icon: BarChart3 },
    ],
  },
];

export function findNavLabel(
  groups: NavGroup[],
  pathname: string,
): string | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (
        pathname === item.href ||
        (item.href !== "/" && pathname.startsWith(item.href + "/"))
      ) {
        return item.label;
      }
    }
  }
  return null;
}
