import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { getOutgoingInvoices } from "@/app/actions/outgoing-invoices";
import { getProjects } from "@/app/actions/projects";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { Button } from "@/components/ui/button";
import { formatPEN, formatDate } from "@/lib/format";
import { OUTGOING_INVOICE_STATUS } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

// Derive a short label from a razón social. Matches the partner dialog logic.
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
  [OUTGOING_INVOICE_STATUS.draft]: "Borrador",
  [OUTGOING_INVOICE_STATUS.sent]: "Emitida",
  [OUTGOING_INVOICE_STATUS.void]: "Anulada",
};

const STATUS_BADGE: Record<number, string> = {
  [OUTGOING_INVOICE_STATUS.draft]: "bg-stone-100 text-stone-600",
  [OUTGOING_INVOICE_STATUS.sent]: "bg-emerald-50 text-emerald-700",
  [OUTGOING_INVOICE_STATUS.void]: "bg-stone-50 text-stone-500",
};

export default async function FacturasEmitidasPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const filterKey = pickFirst(params.filter).trim() || "todas";

  const filters: Record<string, unknown> = {};
  if (filterKey === "borradores") filters.status = OUTGOING_INVOICE_STATUS.draft;
  if (filterKey === "emitidas") filters.status = OUTGOING_INVOICE_STATUS.sent;
  if (filterKey === "anuladas") filters.status = OUTGOING_INVOICE_STATUS.void;

  const result = await getOutgoingInvoices(filters);
  const invoices = result.success ? result.data.data : [];

  // Gather project IDs and contact IDs for label lookups
  const projectIds = [...new Set(invoices.map((i) => i.project_id))];
  const [projectsResult, contactsResult] = await Promise.all([
    projectIds.length > 0
      ? getProjects({ limit: 200 })
      : Promise.resolve({ success: true as const, data: { data: [] } }),
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

  // Compute summary: facturado = sum of total_pen for non-void invoices
  //                 pendiente = sum of outstanding (_computed) for non-void
  const nonVoid = invoices.filter(
    (i) => i.status !== OUTGOING_INVOICE_STATUS.void,
  );
  const facturado = nonVoid.reduce((s, i) => s + Number(i.total_pen), 0);
  const pendiente = nonVoid.reduce(
    (s, i) => s + Number(i._computed.outstanding),
    0,
  );

  return (
    <div>
      <TopBar
        left={
          <span className="text-sm font-medium text-muted-foreground">
            Facturas emitidas
          </span>
        }
        right={
          <div className="flex items-center gap-4">
            <Link href="/facturas-emitidas/nueva">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Nueva factura
              </Button>
            </Link>
            <ExchangeRateChip />
          </div>
        }
      />

      <div className="max-w-6xl px-8 py-8">
        {/* Search + filters + totals on one line */}
        <div className="mb-6 flex items-center gap-6">
          <form className="relative flex-1" action="/facturas-emitidas" method="get">
            <input type="hidden" name="filter" value={filterKey} />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Buscar por serie/número, cliente o proyecto…"
              className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-4 shrink-0 text-sm">
            {(
              [
                ["todas", "Todas"],
                ["borradores", "Borradores"],
                ["emitidas", "Emitidas"],
                ["anuladas", "Anuladas"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/facturas-emitidas?filter=${key}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
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
              <p className="text-[10px] text-muted-foreground">Facturado</p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {formatPEN(facturado)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Pendiente</p>
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
              {search ? "No se encontraron facturas." : "Aún no hay facturas emitidas."}
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
                    Cliente
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
                  const project = projectsById.get(invoice.project_id);
                  const client = project
                    ? contactsById.get(project.client_id)
                    : undefined;
                  const socioContact = invoice.ruc_emisor
                    ? contactsByRuc.get(invoice.ruc_emisor)
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
                          href={`/facturas-emitidas/${invoice.id}`}
                          className="block text-xs text-muted-foreground"
                        >
                          {formatDate(invoice.issue_date)}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/facturas-emitidas/${invoice.id}`}
                          className="block"
                        >
                          <p className="text-sm truncate text-foreground">
                            {project?.name ?? "—"}
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
                          {client?.razon_social ?? "—"}
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
                            STATUS_BADGE[invoice.status],
                          )}
                        >
                          {STATUS_LABELS[invoice.status]}
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
