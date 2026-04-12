import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import {
  getProject,
  getProjectHistorial,
} from "@/app/actions/projects";
import { getProjectPartners } from "@/app/actions/project-partners";
import {
  getProjectBudgets,
  getCostCategories,
} from "@/app/actions/project-budgets";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { formatPEN, formatDate } from "@/lib/format";
import { PROJECT_STATUS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LifecycleAction } from "./_components/lifecycle-action";
import { SociosChips } from "./_components/socios-chips";
import { PresupuestoTable } from "./_components/presupuesto-table";
import { ProjectNotes } from "./_components/project-notes";
import { MetadataFields } from "./_components/metadata-fields";

type Props = {
  params: Promise<{ id: string }>;
};

const STATUS_LABELS: Record<number, string> = {
  [PROJECT_STATUS.prospect]: "Prospecto",
  [PROJECT_STATUS.active]: "Activo",
  [PROJECT_STATUS.completed]: "Completado",
  [PROJECT_STATUS.archived]: "Archivado",
  [PROJECT_STATUS.rejected]: "Rechazado",
};

const STATUS_BADGE_CLASS: Record<number, string> = {
  [PROJECT_STATUS.prospect]: "bg-stone-100 text-stone-600",
  [PROJECT_STATUS.active]: "bg-sky-50 text-sky-700",
  [PROJECT_STATUS.completed]: "bg-emerald-50 text-emerald-700",
  [PROJECT_STATUS.archived]: "bg-stone-50 text-stone-500",
  [PROJECT_STATUS.rejected]: "bg-rose-50 text-rose-700",
};

const TYPE_PILL: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  emitida: { label: "Emitida", bg: "#f0f9ff", color: "#0369a1" },
  recibida: { label: "Recibida", bg: "#fffbeb", color: "#b45309" },
  pago_in: { label: "Pago ↑", bg: "#ecfdf5", color: "#047857" },
  pago_out: { label: "Pago ↓", bg: "#ecfdf5", color: "#047857" },
};

const STATUS_COLORS: Record<string, string> = {
  Cobrado: "#047857",
  Pagado: "#047857",
  Conciliado: "#047857",
  Parcial: "#b45309",
  Pendiente: "#b45309",
  Esperada: "#b45309",
  "Sin conciliar": "#78716c",
  Borrador: "#78716c",
};

function hrefForType(type: string, id: string): string {
  switch (type) {
    case "emitida":
      return `/facturas-emitidas/${id}`;
    case "recibida":
      return `/facturas-recibidas/${id}`;
    case "pago_in":
    case "pago_out":
      return `/pagos/${id}`;
  }
  return "#";
}

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params;

  const projectResult = await getProject(id);
  if (!projectResult.success) notFound();
  const project = projectResult.data;

  const [
    partnersResult,
    budgetsResult,
    categoriesResult,
    historialResult,
    clientResult,
  ] = await Promise.all([
    getProjectPartners(id),
    getProjectBudgets(id),
    getCostCategories(),
    getProjectHistorial(id),
    getContacts({ search: project.client_id }),
  ]);

  const partners = partnersResult.success ? partnersResult.data : [];
  const budgets = budgetsResult.success ? budgetsResult.data : [];
  const categories = categoriesResult.success ? categoriesResult.data : [];
  const historial = historialResult.success ? historialResult.data : [];

  const client = clientResult.success
    ? clientResult.data.data.find((c) => c.id === project.client_id)
    : undefined;

  return (
    <div>
      <TopBar
        left={
          <Link
            href="/proyectos"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Proyectos
          </Link>
        }
        right={
          <div className="flex items-center gap-4">
            <LifecycleAction project={project} />
            <ExchangeRateChip />
          </div>
        }
      />

      <div className="px-8 py-8">
        {/* Metadata card */}
        <div
          className="rounded-lg bg-card p-5"
          style={{ border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[11px] text-muted-foreground">
              {project.code ?? "—"}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">
                  {project.name}
                </h2>
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
                    STATUS_BADGE_CLASS[project.status],
                  )}
                >
                  {STATUS_LABELS[project.status]}
                </span>
              </div>
              {client && (
                <p className="text-xs text-muted-foreground">
                  {client.razon_social}
                </p>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <SociosChips projectId={project.id} partners={partners} projectStatus={project.status} />
            </div>
          </div>

          {/* Inline editable fields: 3 columns */}
          <div
            className="mt-4 grid grid-cols-3 gap-0"
            style={{ borderTop: "1px solid var(--border)", paddingTop: "12px" }}
          >
            <MetadataFields project={project} />
          </div>
        </div>

        {/* Presupuesto + Notas side by side */}
        <div className="mt-8 grid grid-cols-2 gap-6 items-stretch">
          <PresupuestoTable
            projectId={project.id}
            budgets={budgets}
            categories={categories}
            projectStatus={project.status}
          />
          <ProjectNotes
            projectId={project.id}
            initialNotes={project.notes}
          />
        </div>

        {/* Historial */}
        <div className="mt-10">
          <h3 className="text-xs font-medium text-muted-foreground mb-3">
            Historial
          </h3>
          {historial.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground/40">
              Sin movimientos aún
            </p>
          ) : (
            <div>
              {historial.map((item) => {
                const config = TYPE_PILL[item.type];
                return (
                  <Link
                    key={`${item.type}-${item.id}`}
                    href={hrefForType(item.type, item.id)}
                    className="flex items-center justify-between rounded-lg px-3 py-3.5 transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="inline-flex h-5 w-16 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                        style={{ background: config.bg, color: config.color }}
                      >
                        {config.label}
                      </span>
                      <div>
                        <p className="text-sm text-foreground">
                          {item.description}
                          {item.detail && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {item.detail}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(item.date)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {formatPEN(item.amount_pen)}
                      </p>
                      <span
                        className="text-[11px] font-medium"
                        style={{
                          color: STATUS_COLORS[item.status_label] ?? "#78716c",
                        }}
                      >
                        {item.status_label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
