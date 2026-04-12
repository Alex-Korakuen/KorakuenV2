"use client";

import { Pencil, Plus } from "lucide-react";
import { formatPEN } from "@/lib/format";
import type { ProjectBudgetWithCategory } from "@/app/actions/project-budgets";
import { PROJECT_STATUS } from "@/lib/types";

type Props = {
  projectId: string;
  budgets: ProjectBudgetWithCategory[];
  projectStatus: number;
};

export function PresupuestoTable({ budgets, projectStatus }: Props) {
  const editable = projectStatus === PROJECT_STATUS.prospect;
  const total = budgets.reduce(
    (sum, b) => sum + Number(b.budgeted_amount_pen),
    0,
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          Presupuesto por partida
        </h3>
        {editable && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary"
          >
            <Plus className="h-3 w-3" />
            Agregar
          </button>
        )}
      </div>
      <div
        className="rounded-lg bg-card overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        {budgets.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/40">
            Sin partidas presupuestadas
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background">
                <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Partida
                </th>
                <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Presupuestado
                </th>
                {editable && <th className="w-8"></th>}
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => (
                <tr
                  key={b.id}
                  className="group"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <td className="px-3 py-2 text-foreground">
                    {b.cost_category?.name ?? "—"}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums text-foreground">
                    {formatPEN(Number(b.budgeted_amount_pen))}
                  </td>
                  {editable && (
                    <td className="px-2 text-right">
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex h-5 w-5 items-center justify-center rounded text-primary"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr
                className="bg-background"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td className="px-3 py-2 text-[11px] font-medium text-muted-foreground">
                  Total
                </td>
                <td className="text-right px-3 py-2 tabular-nums font-medium text-foreground">
                  {formatPEN(total)}
                </td>
                {editable && <td></td>}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
