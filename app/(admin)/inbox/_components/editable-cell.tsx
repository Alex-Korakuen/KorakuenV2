"use client";

import { type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { InputEditor } from "./editors/input-editor";
import { EnumEditor } from "./editors/enum-editor";
import {
  ComboboxEditor,
  type ComboboxOption,
} from "./editors/combobox-editor";
import type { EditorConfig } from "./editors/field-config";

type Props = {
  /** Unique cell id so only one cell edits at a time across the table. */
  cellId: string;
  /** The current cell id being edited (or null). Passed from parent. */
  activeEditId: string | null;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;

  config: EditorConfig;
  /** Raw value stored in extracted_data (string/number/null). */
  value: string | number | null;
  /**
   * Pre-rendered display for the idle/hover state. Lets each caller
   * render rich content (pills, multi-line, hint subtitles) without the
   * cell having to know about field semantics.
   */
  display: ReactNode;
  /** Called with the new value on save. Parent handles the server call. */
  onSave: (next: string | number | null) => void;

  /** Combobox options, only used when config.kind === "combobox". */
  comboboxOptions?: ComboboxOption[];

  /** Disables editing entirely (e.g. submission is approved). */
  readOnly?: boolean;

  /** Additional classes passed to the outer td or div. */
  className?: string;
};

/**
 * Wraps a display value with click-to-edit behavior. Enforces the
 * "one cell at a time" rule by checking `activeEditId` — if another
 * cell is being edited, clicks on this one are ignored.
 */
export function EditableCell({
  cellId,
  activeEditId,
  onBeginEdit,
  onFinishEdit,
  config,
  value,
  display,
  onSave,
  comboboxOptions,
  readOnly,
  className,
}: Props) {
  const isEditing = activeEditId === cellId;
  const someoneElseEditing = activeEditId !== null && activeEditId !== cellId;

  if (readOnly) {
    return <div className={className}>{display}</div>;
  }

  if (isEditing) {
    return (
      <div
        className={`relative ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {config.kind === "input" ? (
          <InputEditor
            config={config}
            initialValue={value}
            onSave={(next) => {
              onSave(next);
              onFinishEdit();
            }}
            onCancel={onFinishEdit}
          />
        ) : config.kind === "enum" ? (
          <EnumEditor
            config={config}
            initialValue={value == null ? null : String(value)}
            onSave={(next) => {
              onSave(next);
              onFinishEdit();
            }}
            onCancel={onFinishEdit}
          />
        ) : (
          <ComboboxEditor
            config={config}
            options={comboboxOptions ?? []}
            initialValue={value == null ? null : String(value)}
            onSave={(next) => {
              onSave(next);
              onFinishEdit();
            }}
            onCancel={onFinishEdit}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`group relative cursor-text rounded-sm transition-colors ${
        someoneElseEditing
          ? "opacity-60"
          : "hover:bg-primary/[0.08] hover:shadow-[inset_0_-1px_0_0_rgba(196,120,92,0.4)]"
      } ${className ?? ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (someoneElseEditing) return;
        onBeginEdit(cellId);
      }}
    >
      {display}
      <Pencil
        className={`pointer-events-none absolute right-1 top-1 h-3 w-3 text-primary transition-opacity ${
          someoneElseEditing
            ? "opacity-0"
            : "opacity-0 group-hover:opacity-70"
        }`}
      />
    </div>
  );
}
