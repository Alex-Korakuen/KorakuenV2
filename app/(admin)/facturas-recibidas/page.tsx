import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { getIncomingInvoices } from "@/app/actions/incoming-invoices";
import { getProjects } from "@/app/actions/projects";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { formatPEN, formatDate } from "@/lib/format";
import { INCOMING_INVOICE_FACTURA_STATUS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IncomingInvoiceDialog } from "./_components/incoming-invoice-dialog";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function deriveShortLabel(razonSocial: string): string {
  const cleaned = razonSocial
    .replace(/\b(S\.?A\.?C?\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?)\b/gi, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return (words[0] ?? razonSocial).slice(0, 3).toUpperCase();
}

const STATUS_LABELS: Record<number, string> = {
  [INCOMING_INVOICE_FACTURA_STATUS.expected]: "Esperada",
  [INCOMING_INVOICE_FACTURA_STATUS.received]: "Recibida",
};

const STATUS_BADGE: Record<number, string> = {
  [INCOMING_INVOICE_FACTURA_STATUS.expected]: "bg-amber-50 text-amber-700",
  [INCOMING_INVOICE_FACTURA_STATUS.received]: "bg-emerald-50 text-emerald-700",
};

export default async function FacturasRecibidasPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const filterKey = pickFirst(params.filter).trim() || "todas";

  const filters: Record<string, unknown> = {};
  if (filterKey === "esperadas")
    filters.factura_status = INCOMING_INVOICE_FACTURA_STATUS.expected;
  if (filterKey === "recibidas")
    filters.factura_status = INCOMING_INVOICE_FACTURA_STATUS.received;

  const result = await getIncomingInvoices(filters);
  const invoices = result.success ? result.data.data : [];

  const projectIds = [
    ...new Set(
      invoices
        .map((i) => i.project_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const [projectsResult, contactsResult] = await Promise.all([
    projectIds.length > 0
      ? getProjects({ limit: 200 })
      : Promise.resolve({
          success: true as const,
          data: { data: [], total: 0, limit: 0, offset: 0 },
        }),
    getContacts({ limit: 200 }),
  ]);

  const projectsById = new Map(
    (projectsResult.success ? projectsResult.data.data : []).map((p) => [
      p.id,
      p,
    ]),
  );
  const contactsById = new Map(
    (contactsResult.success ? contactsResult.data.data : []).map((c) => [
      c.id,
      c,
    ]),
  );
  const contactsByRuc = new Map(
    (contactsResult.success ? contactsResult.data.data : [])
      .filter((c) => c.ruc)
      .map((c) => [c.ruc as string, c]),
  );

  // Summary: costo (total_pen) + pendiente (outstanding)
  const costo = invoices.reduce((s, i) => s + Number(i.total_pen), 0);
  const pendiente = invoices.reduce(
    (s, i) => s + Number(i._computed.outstanding),
    0,
  );

  return (
    <div>
      <TopBar
        left={
          <span className="text-sm font-medium text-muted-foreground">
            Facturas recibidas
          </span>
        }
        right={
          <IncomingInvoiceDialog>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Nueva factura
            </Button>
          </IncomingInvoiceDialog>
        }
      />

      <div className="max-w-6xl px-8 py-8">
        <div className="mb-6 flex items-center gap-6">
          <form className="relative flex-1" action="/facturas-recibidas" method="get">
            <input type="hidden" name="filter" value={filterKey} />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Buscar por serie/número, proveedor o proyecto…"
              className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-4 shrink-0 text-sm">
            {(
              [
                ["todas", "Todas"],
                ["esperadas", "Esperadas"],
                ["recibidas", "Recibidas"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/facturas-recibidas?filter=${key}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                className={
                  filterKey === key
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </Link>
            ))}
          </div>
          <div
            className="flex items-center gap-4 shrink-0 pl-4"
            style={{ borderLeft: "1px solid var(--border)" }}
          >
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Costo</p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {formatPEN(costo)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Por pagar</p>
              <p
                className="text-sm font-medium tabular-nums"
                style={{ color: pendiente > 0 ? "#b45309" : "#78716c" }}
              >
                {formatPEN(pendiente)}
              </p>
            </div>
          </div>
        </div>

        {invoices.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? "No se encontraron facturas." : "Aún no hay facturas recibidas."}
            </p>
          </div>
        ) : (
          <div
            className="rounded-lg bg-card overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Proyecto
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Socio
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Proveedor
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    N°
                  </th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Total
                  </th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Pendiente
                  </th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const project = invoice.project_id
                    ? projectsById.get(invoice.project_id)
                    : undefined;
                  const vendor = contactsById.get(invoice.contact_id);
                  const socioContact = invoice.ruc_receptor
                    ? contactsByRuc.get(invoice.ruc_receptor)
                    : undefined;
                  const socioLabel = socioContact
                    ? deriveShortLabel(socioContact.razon_social)
                    : "—";
                  return (
                    <tr
                      key={invoice.id}
                      className="cursor-pointer hover:bg-accent/30"
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td className="px-3 py-3">
                        <Link
                          href={`/facturas-recibidas/${invoice.id}`}
                          className="block text-xs text-muted-foreground"
                        >
                          {invoice.fecha_emision
                            ? formatDate(invoice.fecha_emision)
                            : "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/facturas-recibidas/${invoice.id}`} className="block">
                          <p className="text-sm truncate text-foreground">
                            {project?.name ?? (
                              <span className="text-muted-foreground">
                                Gastos generales
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] font-mono text-muted-foreground">
                            {project?.code ?? "—"}
                          </p>
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex h-5 items-center rounded-full bg-card px-2 text-[11px] font-medium text-foreground"
                          style={{ border: "1px solid var(--border)" }}
                        >
                          {socioLabel}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm truncate text-foreground">
                          {vendor?.razon_social ?? "—"}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-foreground">
                        {invoice.serie_numero ?? "—"}
                      </td>
                      <td className="text-right px-3 py-3 tabular-nums text-foreground">
                        {formatPEN(Number(invoice.total_pen))}
                      </td>
                      <td
                        className="text-right px-3 py-3 tabular-nums"
                        style={{
                          color:
                            invoice._computed.outstanding > 0
                              ? "#b45309"
                              : "#a8a29e",
                        }}
                      >
                        {invoice._computed.outstanding > 0
                          ? formatPEN(invoice._computed.outstanding)
                          : "—"}
                      </td>
                      <td className="text-center px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
                            STATUS_BADGE[invoice.factura_status],
                          )}
                        >
                          {STATUS_LABELS[invoice.factura_status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
