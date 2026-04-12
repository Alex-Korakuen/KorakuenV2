"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { formatPEN } from "@/lib/format";
import type { ProjectBudgetWithCategory } from "@/app/actions/project-budgets";
import type { CostCategoryRow } from "@/lib/types";
import { PROJECT_STATUS } from "@/lib/types";
import {
  upsertProjectBudget,
  removeProjectBudget,
} from "@/app/actions/project-budgets";
import { toast } from "sonner";

type Props = {
  projectId: string;
  budgets: ProjectBudgetWithCategory[];
  categories: CostCategoryRow[];
  projectStatus: number;
};

type RowState = {
  category: CostCategoryRow;
  budget: ProjectBudgetWithCategory | null;
};

export function PresupuestoTable({
  projectId,
  budgets,
  categories,
  projectStatus,
}: Props) {
  const router = useRouter();
  const editable = projectStatus === PROJECT_STATUS.prospect;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Merge budgets with all categories — show every category
  const budgetByCategory = new Map(
    budgets.map((b) => [b.cost_category_id, b]),
  );

  const rows: RowState[] = categories.map((c) => ({
    category: c,
    budget: budgetByCategory.get(c.id) ?? null,
  }));

  const total = budgets.reduce(
    (sum, b) => sum + Number(b.budgeted_amount_pen),
    0,
  );

  function startEdit(row: RowState) {
    if (!editable) return;
    setEditingId(row.category.id);
    setDraft(
      row.budget ? String(row.budget.budgeted_amount_pen) : "",
    );
  }

  function discard() {
    setEditingId(null);
    setDraft("");
  }

  async function confirm(row: RowState) {
    const parsed = draft ? parseFloat(draft.replace(/,/g, "")) : 0;
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Monto inválido");
      return;
    }

    setSaving(true);
    if (parsed === 0 && row.budget) {
      // Remove the existing budget
      const result = await removeProjectBudget(projectId, row.category.id);
      setSaving(false);
      if (result.success) {
        toast.success("Partida eliminada");
        setEditingId(null);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
      return;
    }

    if (parsed === 0) {
      setSaving(false);
      setEditingId(null);
      return;
    }

    const result = await upsertProjectBudget(
      projectId,
      row.category.id,
      parsed,
    );
    setSaving(false);
    if (result.success) {
      toast.success("Guardado");
      setEditingId(null);
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          Presupuesto por partida
        </h3>
      </div>
      <div
        className="rounded-lg bg-card overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground/40">
            Sin categorías de costo disponibles
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editingId === row.category.id;
                const amount = row.budget
                  ? Number(row.budget.budgeted_amount_pen)
                  : 0;
                return (
                  <tr
                    key={row.category.id}
                    className={
                      editable && !isEditing
                        ? "cursor-pointer hover:bg-accent/30"
                        : undefined
                    }
                    style={{ borderTop: "1px solid var(--border)" }}
                    onClick={() => !isEditing && startEdit(row)}
                  >
                    <td className="px-3 py-2 text-foreground">
                      {row.category.name}
                    </td>
                    <td className="text-right px-3 py-2">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={draft}
                            onChange={(e) =>
                              setDraft(e.target.value.replace(/[^0-9.]/g, ""))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void confirm(row);
                              if (e.key === "Escape") discard();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            disabled={saving}
                            autoFocus
                            inputMode="decimal"
                            placeholder="0"
                            className="w-28 rounded-md px-2 py-0.5 font-mono text-sm text-right focus:outline-none border border-primary"
                            style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void confirm(row);
                            }}
                            disabled={saving}
                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-emerald-600"
                          >
                            <Check className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              discard();
                            }}
                            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <span
                          className={
                            amount > 0
                              ? "tabular-nums text-foreground"
                              : "text-muted-foreground/40"
                          }
                        >
                          {amount > 0 ? formatPEN(amount) : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
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
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
