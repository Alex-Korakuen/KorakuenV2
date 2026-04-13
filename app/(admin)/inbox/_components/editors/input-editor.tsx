"use client";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import type { InputEditorConfig } from "./field-config";

type Props = {
  config: InputEditorConfig;
  initialValue: string | number | null;
  onSave: (next: string | number | null) => void;
  onCancel: () => void;
};

/**
 * Plain HTML input with explicit save (Enter / ✓) and cancel (Esc / ✗).
 * Auto-selects text on mount for fast overwrite.
 */
export function InputEditor({ config, initialValue, onSave, onCancel }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (config.inputType !== "date") {
      el.select();
    }
  }, [config.inputType]);

  function commit() {
    const raw = ref.current?.value ?? "";
    if (raw === "") {
      onSave(null);
      return;
    }
    if (config.inputType === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        onCancel();
        return;
      }
      onSave(n);
    } else {
      onSave(raw.trim());
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={ref}
        type={config.inputType}
        defaultValue={initialValue == null ? "" : String(initialValue)}
        placeholder={config.placeholder}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="min-w-0 flex-1 rounded border border-primary/60 bg-white px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted"
        title="Cancelar (Esc)"
      >
        <X className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          commit();
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary text-white hover:bg-primary/90"
        title="Guardar (Enter)"
      >
        <Check className="h-3 w-3" />
      </button>
    </div>
  );
}
