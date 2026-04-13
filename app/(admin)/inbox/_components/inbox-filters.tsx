"use client";

import Link from "next/link";
import { Search } from "lucide-react";

type BatchOption = {
  import_batch_id: string;
  import_batch_label: string | null;
};

type Props = {
  search: string;
  batchId: string;
  filter: string;
  batches: BatchOption[];
};

const FILTER_TABS = [
  ["pendientes", "Pendientes"],
  ["aprobados", "Aprobados"],
  ["rechazados", "Rechazados"],
  ["todos", "Todos"],
] as const;

function buildHref(
  base: { filter: string; batchId: string; search: string },
  next: Partial<{ filter: string; batchId: string; search: string }>,
): string {
  const merged = { ...base, ...next };
  const params = new URLSearchParams();
  if (merged.filter && merged.filter !== "pendientes") {
    params.set("filter", merged.filter);
  }
  if (merged.batchId) params.set("batch_id", merged.batchId);
  if (merged.search) params.set("search", merged.search);
  const qs = params.toString();
  return qs ? `/inbox?${qs}` : "/inbox";
}

export function InboxFilters({ search, batchId, filter, batches }: Props) {
  return (
    <div className="flex items-center gap-3">
      {/* Search box — GET form preserves other params via hidden inputs */}
      <form className="relative flex-1" action="/inbox" method="get">
        <input type="hidden" name="filter" value={filter} />
        {batchId ? (
          <input type="hidden" name="batch_id" value={batchId} />
        ) : null}
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
        <input
          name="search"
          type="text"
          defaultValue={search}
          placeholder="Buscar por referencia, contacto o RUC…"
          className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
        />
      </form>

      {/* Batch selector (native select for Phase C) */}
      <form
        action="/inbox"
        method="get"
        className="shrink-0"
      >
        <input type="hidden" name="filter" value={filter} />
        {search ? <input type="hidden" name="search" value={search} /> : null}
        <select
          name="batch_id"
          defaultValue={batchId}
          onChange={(e) => {
            const form = (e.target as HTMLSelectElement).form;
            if (form) form.submit();
          }}
          className="rounded-lg border border-input bg-card px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        >
          <option value="">Todos los lotes</option>
          {batches.map((b) => (
            <option key={b.import_batch_id} value={b.import_batch_id}>
              {b.import_batch_label ?? b.import_batch_id.slice(0, 8)}
            </option>
          ))}
        </select>
      </form>

      {/* Status tabs */}
      <div className="flex shrink-0 items-center gap-4 pl-4 text-sm">
        {FILTER_TABS.map(([key, label]) => (
          <Link
            key={key}
            href={buildHref(
              { filter, batchId, search },
              { filter: key },
            )}
            className={
              filter === key || (filter === "" && key === "pendientes")
                ? "font-medium text-primary"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
