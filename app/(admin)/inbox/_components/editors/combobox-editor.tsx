"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ComboboxEditorConfig } from "./field-config";

export type ComboboxOption = {
  id: string;
  label: string;
  /** Value stored in the submission (usually label, sometimes code). */
  value: string;
  hint?: string;
};

export type ComboboxSelection =
  | { kind: "option"; option: ComboboxOption }
  | { kind: "create"; query: string }
  | { kind: "clear" };

type Props = {
  config: ComboboxEditorConfig;
  /** Preloaded options — only used when asyncLoad is not provided. */
  options?: ComboboxOption[];
  /** Async loader — takes priority over preloaded options. */
  asyncLoad?: () => Promise<ComboboxOption[]>;
  /** Shown when async load is blocked (e.g. contact not set yet). */
  disabledReason?: string;
  /** Label for a "create with this query" tail option, if applicable. */
  createTailLabel?: (query: string) => string;
  initialValue: string | null;
  onPick: (selection: ComboboxSelection) => void;
  onCancel: () => void;
};

/**
 * Searchable dropdown backed by a preloaded options array. Saves
 * immediately on selection. "Clear" option at the bottom nulls the field.
 * Used for bank account, project, cost category fields — all of which
 * store a label/code in the submission and let the server re-resolve to
 * an id.
 */
export function ComboboxEditor({
  options: preloadedOptions,
  asyncLoad,
  disabledReason,
  createTailLabel,
  initialValue,
  onPick,
  onCancel,
}: Props) {
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOptions, setLoadedOptions] = useState<ComboboxOption[] | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    triggerRef.current?.focus();
  }, []);

  // Async load on mount, once. If disabledReason is set we skip entirely.
  useEffect(() => {
    if (disabledReason) return;
    if (!asyncLoad) return;
    let cancelled = false;
    setLoading(true);
    asyncLoad()
      .then((opts) => {
        if (!cancelled) setLoadedOptions(opts);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = asyncLoad
    ? loadedOptions ?? []
    : preloadedOptions ?? [];

  const selected = useMemo(
    () => options.find((o) => o.value === initialValue) ?? null,
    [options, initialValue],
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Dismiss by clicking outside = cancel (no value change yet).
      onCancel();
    }
  }

  const showCreateTail =
    createTailLabel !== undefined &&
    query.trim().length > 0 &&
    !options.some(
      (o) =>
        o.label.toLowerCase() === query.trim().toLowerCase() ||
        o.value.toLowerCase() === query.trim().toLowerCase(),
    );

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full items-center justify-between rounded border border-primary/60 bg-white px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
        >
          <span className="truncate">
            {selected?.label ?? initialValue ?? "Seleccionar…"}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(420px,var(--radix-popover-trigger-width))] p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {disabledReason ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {disabledReason}
          </div>
        ) : (
          <Command shouldFilter={asyncLoad ? false : true}>
            <CommandInput
              placeholder="Buscar…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Cargando…
                </div>
              ) : (
                <>
                  <CommandEmpty>Sin resultados.</CommandEmpty>
                  {options
                    .filter((opt) => {
                      if (!asyncLoad) return true;
                      if (!query.trim()) return true;
                      const q = query.trim().toLowerCase();
                      return (
                        opt.label.toLowerCase().includes(q) ||
                        (opt.hint?.toLowerCase().includes(q) ?? false)
                      );
                    })
                    .map((opt) => (
                      <CommandItem
                        key={opt.id}
                        value={`${opt.label} ${opt.hint ?? ""}`}
                        onSelect={() => {
                          setOpen(false);
                          onPick({ kind: "option", option: opt });
                        }}
                      >
                        <Check
                          className={`mr-2 h-3.5 w-3.5 ${
                            initialValue === opt.value
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-sm">{opt.label}</span>
                          {opt.hint ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                              {opt.hint}
                            </span>
                          ) : null}
                        </div>
                      </CommandItem>
                    ))}
                  {showCreateTail ? (
                    <CommandItem
                      value={`__create__:${query}`}
                      onSelect={() => {
                        setOpen(false);
                        onPick({ kind: "create", query: query.trim() });
                      }}
                      className="text-primary"
                    >
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      {createTailLabel!(query.trim())}
                    </CommandItem>
                  ) : null}
                  <CommandItem
                    value="__clear__"
                    onSelect={() => {
                      setOpen(false);
                      onPick({ kind: "clear" });
                    }}
                    className="text-muted-foreground"
                  >
                    Limpiar campo
                  </CommandItem>
                </>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
