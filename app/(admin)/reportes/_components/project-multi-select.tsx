"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS } from "@/lib/types";

type ProjectOption = {
  id: string;
  name: string;
  code: string | null;
  status: number;
};

type Props = {
  projects: ProjectOption[];
  selectedIds: string[];
};

const STATUS_LABEL: Record<number, { label: string; className: string }> = {
  [PROJECT_STATUS.prospect]: {
    label: "Prospecto",
    className: "bg-amber-50 text-amber-700",
  },
  [PROJECT_STATUS.active]: {
    label: "Activo",
    className: "bg-emerald-50 text-emerald-700",
  },
  [PROJECT_STATUS.completed]: {
    label: "Completado",
    className: "bg-stone-100 text-stone-600",
  },
  [PROJECT_STATUS.archived]: {
    label: "Archivado",
    className: "bg-stone-100 text-stone-500",
  },
  [PROJECT_STATUS.rejected]: {
    label: "Rechazado",
    className: "bg-stone-100 text-stone-400",
  },
};

export function ProjectMultiSelect({ projects, selectedIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const triggerLabel = useMemo(() => {
    if (selectedIds.length === 0) return "Ningún proyecto";
    if (selectedIds.length === projects.length) {
      return `Todos los proyectos (${projects.length})`;
    }
    if (selectedIds.length === 1) {
      const p = projects.find((p) => p.id === selectedIds[0]);
      return p?.name ?? "1 proyecto";
    }
    return `${selectedIds.length} de ${projects.length} proyectos`;
  }, [selectedIds, projects]);

  function updateUrl(nextIds: string[]) {
    const params = new URLSearchParams();
    if (
      nextIds.length > 0 &&
      nextIds.length < projects.length
    ) {
      for (const id of nextIds) params.append("project", id);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/reportes?${qs}` : "/reportes");
    });
  }

  function toggle(id: string) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateUrl(Array.from(next));
  }

  function selectAll() {
    updateUrl(projects.map((p) => p.id));
  }

  function clearAll() {
    // send an impossible id so the server returns no selection
    const params = new URLSearchParams();
    params.append("project", "__none__");
    startTransition(() => {
      router.push(`/reportes?${params.toString()}`);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-between rounded-md bg-card px-3 py-1.5 pr-9 text-sm font-medium text-foreground focus:outline-none focus:border-primary/50 relative"
          style={{ border: "1px solid var(--border)", minWidth: 320 }}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0"
        sideOffset={4}
      >
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={selectAll}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Seleccionar todos
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Limpiar
          </button>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {projects.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No hay proyectos.
            </li>
          ) : (
            projects.map((p) => {
              const status = STATUS_LABEL[p.status];
              const checked = selectedSet.has(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="h-3.5 w-3.5 rounded"
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span className="flex-1 text-sm text-foreground truncate">
                      {p.name}
                    </span>
                    {status && (
                      <span
                        className={cn(
                          "inline-flex h-4 items-center rounded px-1.5 text-[9px] font-medium",
                          status.className,
                        )}
                      >
                        {status.label}
                      </span>
                    )}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
