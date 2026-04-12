"use client";

import { Plus } from "lucide-react";
import type { ProjectPartnerRow } from "@/lib/types";
import { PROJECT_STATUS } from "@/lib/types";

type Props = {
  projectId: string;
  partners: ProjectPartnerRow[];
  projectStatus: number;
};

export function SociosChips({ partners, projectStatus }: Props) {
  const total = partners.reduce(
    (sum, p) => sum + Number(p.profit_split_pct),
    0,
  );
  const editable = projectStatus === PROJECT_STATUS.prospect;

  return (
    <>
      <span className="text-[11px] text-muted-foreground">Socios</span>
      {partners.length === 0 ? (
        <span className="text-xs text-muted-foreground/40">sin socios</span>
      ) : (
        partners.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!editable}
            className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs hover:bg-accent disabled:cursor-default disabled:hover:bg-card"
            style={{ border: "1px solid var(--border)" }}
          >
            <span className="text-foreground">{p.company_label}</span>
            <span className="tabular-nums font-medium text-primary">
              {Number(p.profit_split_pct).toFixed(0)}%
            </span>
          </button>
        ))
      )}
      {editable && (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs text-primary hover:bg-accent"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {partners.length > 0 && (
        <span
          className="text-[11px] ml-1"
          style={{
            color: Math.abs(total - 100) < 0.01 ? "#047857" : "#b45309",
          }}
        >
          Suma {total.toFixed(0)}%
        </span>
      )}
    </>
  );
}
