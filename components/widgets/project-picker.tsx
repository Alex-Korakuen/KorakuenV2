"use client";

import { useState, useEffect, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getProjects } from "@/app/actions/projects";
import { PROJECT_STATUS } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ProjectRow } from "@/lib/types";

type Props = {
  value: string | null;
  onChange: (project: ProjectRow | null) => void;
  statuses?: number[];
  placeholder?: string;
  className?: string;
};

export function ProjectPicker({
  value,
  onChange,
  statuses = [PROJECT_STATUS.prospect, PROJECT_STATUS.active],
  placeholder = "Buscar proyecto…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [selected, setSelected] = useState<ProjectRow | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      // Fetch each allowed status and merge. getProjects filter.status is a single value.
      const results = await Promise.all(
        statuses.map((s) =>
          getProjects({ status: s, search: search.trim() || undefined }),
        ),
      );
      const merged: ProjectRow[] = [];
      for (const r of results) {
        if (r.success) merged.push(...r.data.data);
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setProjects(merged);

      if (value && !selected) {
        const found = merged.find((p) => p.id === value);
        if (found) setSelected(found);
      }
    });
  }, [search, statuses, value, selected]);

  function handleSelect(project: ProjectRow) {
    setSelected(project);
    onChange(project);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/30 focus:outline-none focus:border-primary/50",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">
                  {selected.code ?? "—"}
                </span>
                <span className="mx-1.5">·</span>
                {selected.name}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                onSelect={() => handleSelect(project)}
              >
                <Check
                  className={cn(
                    "h-4 w-4",
                    value === project.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate">{project.name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {project.code ?? "—"}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
