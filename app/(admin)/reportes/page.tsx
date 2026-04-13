import { getProjects } from "@/app/actions/projects";
import { getSettlement } from "@/app/actions/reports";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { formatPEN } from "@/lib/format";
import { ProjectMultiSelect } from "./_components/project-multi-select";
import type { Settlement } from "@/app/actions/reports";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PartnerAggregate = {
  contact_id: string;
  razon_social: string;
  profit_split_pct: number | null;
  costs_pen: number;
  profit_share_pen: number;
  total_owed_pen: number;
};

export default async function ReportesPage({ searchParams }: Props) {
  const params = await searchParams;

  const projectsResult = await getProjects({ limit: 200 });
  const allProjects = projectsResult.success ? projectsResult.data.data : [];

  const rawProject = params.project;
  const requestedIds = new Set(
    Array.isArray(rawProject)
      ? rawProject
      : rawProject
        ? [rawProject]
        : allProjects.map((p) => p.id),
  );
  const selectedProjects = allProjects.filter((p) => requestedIds.has(p.id));
  const selectedIds = selectedProjects.map((p) => p.id);

  const settlements: Settlement[] = [];
  if (selectedIds.length > 0) {
    const results = await Promise.all(
      selectedIds.map((id) => getSettlement(id)),
    );
    for (const r of results) {
      if (r.success) settlements.push(r.data);
    }
  }

  const isSingle = settlements.length === 1;
  const aggByContact = new Map<string, PartnerAggregate>();
  let totalCosts = 0;
  let totalProfitShare = 0;
  let totalOwed = 0;
  let totalUnassigned = 0;

  for (const s of settlements) {
    totalUnassigned += s.unassigned_costs_pen;
    for (const p of s.partners) {
      const entry = aggByContact.get(p.contact_id) ?? {
        contact_id: p.contact_id,
        razon_social: p.contact_razon_social,
        profit_split_pct: isSingle ? p.profit_split_pct : null,
        costs_pen: 0,
        profit_share_pen: 0,
        total_owed_pen: 0,
      };
      entry.costs_pen += p.costs_by_partner_pen;
      entry.profit_share_pen += p.profit_share_pen;
      entry.total_owed_pen += p.total_owed_pen;
      aggByContact.set(p.contact_id, entry);
    }
  }
  const rows = Array.from(aggByContact.values()).sort(
    (a, b) => b.total_owed_pen - a.total_owed_pen,
  );
  for (const r of rows) {
    totalCosts += r.costs_pen;
    totalProfitShare += r.profit_share_pen;
    totalOwed += r.total_owed_pen;
  }

  const subtitle = isSingle
    ? "Por socio"
    : selectedProjects.length === 0
      ? "Selecciona al menos un proyecto"
      : `Agregado de ${selectedProjects.length} proyectos`;

  return (
    <div>
      <TopBar
        left={
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Liquidación
            </span>
            <ProjectMultiSelect
              projects={allProjects.map((p) => ({
                id: p.id,
                name: p.name,
                code: p.code,
                status: p.status,
              }))}
              selectedIds={selectedIds}
            />
          </div>
        }
        right={<ExchangeRateChip />}
      />

      <div className="max-w-5xl px-8 py-8">
        {selectedProjects.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Selecciona al menos un proyecto para ver la liquidación.
          </p>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground">
                Liquidación {subtitle !== "Por socio" ? `— ${subtitle.toLowerCase()}` : "por socio"}
              </h3>
              {isSingle && (
                <span className="text-[11px] text-muted-foreground/60">
                  Split total:{" "}
                  {rows
                    .reduce((s, r) => s + (r.profit_split_pct ?? 0), 0)
                    .toFixed(0)}
                  %
                </span>
              )}
            </div>
            <div
              className="rounded-xl bg-card overflow-hidden"
              style={{ border: "1px solid var(--border)" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-background">
                    <th className="text-left px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Socio
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Split
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Costos aportados
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Utilidad
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Total a recibir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr style={{ borderTop: "1px solid var(--border)" }}>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-sm text-muted-foreground"
                      >
                        No hay socios registrados en los proyectos seleccionados.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.contact_id}
                        style={{ borderTop: "1px solid var(--border)" }}
                      >
                        <td className="px-4 py-3 text-sm text-foreground">
                          {r.razon_social}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums text-sm text-muted-foreground">
                          {r.profit_split_pct != null
                            ? `${r.profit_split_pct}%`
                            : "—"}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums font-mono text-sm text-muted-foreground">
                          {formatPEN(r.costs_pen)}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums font-mono text-sm text-muted-foreground">
                          {formatPEN(r.profit_share_pen)}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums font-semibold text-foreground">
                          {formatPEN(r.total_owed_pen)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr
                      className="bg-background"
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td className="px-4 py-3 text-[11px] font-medium text-muted-foreground">
                        Total
                      </td>
                      <td></td>
                      <td className="text-right px-4 py-3 tabular-nums font-mono font-semibold text-foreground">
                        {formatPEN(totalCosts)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums font-mono font-semibold text-foreground">
                        {formatPEN(totalProfitShare)}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums font-semibold text-foreground">
                        {formatPEN(totalOwed)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {totalUnassigned > 0 && (
              <div
                className="mt-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs"
                style={{
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  color: "#92400e",
                }}
              >
                <span>
                  Hay <strong>{formatPEN(totalUnassigned)}</strong> en costos sin
                  asignar a un socio. Estos no se reparten y aparecen fuera del
                  cálculo.
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
