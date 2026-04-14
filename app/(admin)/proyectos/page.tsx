import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { getProjects } from "@/app/actions/projects";
import { getProjectSummary } from "@/app/actions/reports";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { formatPEN, formatUSD } from "@/lib/format";
import { PROJECT_STATUS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProjectCreateDialog } from "./_components/project-create-dialog";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const STATUS_FILTERS = [
  { key: "todos", label: "Todos", status: undefined },
  { key: "activos", label: "Activos", status: PROJECT_STATUS.active },
  { key: "prospectos", label: "Prospectos", status: PROJECT_STATUS.prospect },
  { key: "completados", label: "Completados", status: PROJECT_STATUS.completed },
] as const;

const STATUS_LABELS: Record<number, string> = {
  [PROJECT_STATUS.prospect]: "Prospecto",
  [PROJECT_STATUS.active]: "Activo",
  [PROJECT_STATUS.completed]: "Completado",
  [PROJECT_STATUS.rejected]: "Rechazado",
};

const STATUS_BADGE_CLASS: Record<number, string> = {
  [PROJECT_STATUS.prospect]: "bg-stone-100 text-stone-600",
  [PROJECT_STATUS.active]: "bg-sky-50 text-sky-700",
  [PROJECT_STATUS.completed]: "bg-emerald-50 text-emerald-700",
  [PROJECT_STATUS.rejected]: "bg-rose-50 text-rose-700",
};

export default async function ProyectosPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const filterKey = pickFirst(params.filter).trim() || "todos";
  const activeFilter =
    STATUS_FILTERS.find((f) => f.key === filterKey) ?? STATUS_FILTERS[0];

  const filters: Record<string, unknown> = {};
  if (search) filters.search = search;
  if (activeFilter.status !== undefined) filters.status = activeFilter.status;

  const result = await getProjects(filters);
  const projects = result.success ? result.data.data : [];

  // Fetch summaries in parallel for actual_spend and contract value display
  const summaries = await Promise.all(
    projects.map((p) => getProjectSummary(p.id)),
  );

  return (
    <div>
      <TopBar
        left={
          <span className="text-sm font-medium text-muted-foreground">
            Proyectos
          </span>
        }
        right={
          <ProjectCreateDialog>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Nuevo proyecto
            </Button>
          </ProjectCreateDialog>
        }
      />

      <div className="max-w-4xl px-8 py-8">
        {/* Search + filters */}
        <div className="mb-6 flex items-center gap-4">
          <form className="relative flex-1" action="/proyectos" method="get">
            <input type="hidden" name="filter" value={filterKey} />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Buscar por nombre o código…"
              className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-4 shrink-0 text-sm">
            {STATUS_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={`/proyectos?filter=${f.key}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                className={
                  filterKey === f.key
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Project list */}
        {projects.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {search
                ? "No se encontraron proyectos."
                : "Aún no hay proyectos en este estado."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {projects.map((project, idx) => {
              const summary = summaries[idx];
              const summaryData = summary.success ? summary.data : null;
              const isUSD = project.contract_currency === "USD";
              const contractValue = summaryData?.contract_value_original ?? 0;
              const actualSpend = summaryData?.actual_spend_pen ?? 0;
              const muted = project.status === PROJECT_STATUS.rejected;
              return (
                <Link
                  key={project.id}
                  href={`/proyectos/${project.id}`}
                  className={cn(
                    "flex items-center gap-4 rounded-lg px-3 py-4 transition-colors hover:bg-accent/50",
                    muted && "opacity-60",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="font-mono text-[11px] shrink-0 text-muted-foreground">
                      {project.code ?? "—"}
                    </span>
                    <p className="text-sm font-medium truncate text-foreground">
                      {project.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right w-32">
                      <p className="text-[11px] text-muted-foreground">
                        Contratado
                      </p>
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {isUSD
                          ? formatUSD(contractValue)
                          : formatPEN(contractValue)}
                      </p>
                    </div>
                    <div className="text-right w-32">
                      <p className="text-[11px] text-muted-foreground">
                        Gastado
                      </p>
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {actualSpend > 0 ? formatPEN(actualSpend) : "—"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium w-24 justify-center",
                        STATUS_BADGE_CLASS[project.status],
                      )}
                    >
                      {STATUS_LABELS[project.status]}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {projects.length > 0 && (
          <div className="mt-8 text-xs text-muted-foreground/60">
            {projects.length}{" "}
            {projects.length === 1 ? "proyecto" : "proyectos"}
          </div>
        )}
      </div>
    </div>
  );
}
