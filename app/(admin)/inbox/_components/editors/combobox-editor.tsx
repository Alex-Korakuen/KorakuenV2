"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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

type Props = {
  config: ComboboxEditorConfig;
  options: ComboboxOption[];
  initialValue: string | null;
  onSave: (next: string | null) => void;
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
  options,
  initialValue,
  onSave,
  onCancel,
}: Props) {
  const [open, setOpen] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    triggerRef.current?.focus();
  }, []);

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
        className="w-[min(360px,var(--radix-popover-trigger-width))] p-0"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {options.map((opt) => (
              <CommandItem
                key={opt.id}
                value={`${opt.label} ${opt.hint ?? ""}`}
                onSelect={() => {
                  setOpen(false);
                  onSave(opt.value);
                }}
              >
                <Check
                  className={`mr-2 h-3.5 w-3.5 ${
                    initialValue === opt.value ? "opacity-100" : "opacity-0"
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
            <CommandItem
              value="__clear__"
              onSelect={() => {
                setOpen(false);
                onSave(null);
              }}
              className="text-muted-foreground"
            >
              Limpiar campo
            </CommandItem>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
