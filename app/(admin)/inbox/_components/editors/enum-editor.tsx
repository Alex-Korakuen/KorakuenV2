"use client";

import { useEffect, useRef } from "react";
import type { EnumEditorConfig } from "./field-config";

type Props = {
  config: EnumEditorConfig;
  initialValue: string | null;
  onSave: (next: string | null) => void;
  onCancel: () => void;
};

/**
 * Radio-style toggle over a fixed list of values. Saves immediately on
 * selection — no explicit ✓. Esc still cancels.
 */
export function EnumEditor({ config, initialValue, onSave, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 outline-none"
    >
      {config.options.map(([value, label]) => {
        const active = initialValue === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSave(value)}
            className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
