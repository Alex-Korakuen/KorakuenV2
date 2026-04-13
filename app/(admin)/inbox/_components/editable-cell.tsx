"use client";

import { type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { InputEditor } from "./editors/input-editor";
import { EnumEditor } from "./editors/enum-editor";
import {
  ComboboxEditor,
  type ComboboxOption,
  type ComboboxSelection,
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

  /** Combobox — preloaded options. */
  comboboxOptions?: ComboboxOption[];
  /** Combobox — async loader used instead of `comboboxOptions`. */
  comboboxAsyncLoad?: () => Promise<ComboboxOption[]>;
  /** Combobox — shown when async load is gated (e.g. contact unset). */
  comboboxDisabledReason?: string;
  /** Combobox — label for the "create with this query" tail option. */
  comboboxCreateTailLabel?: (query: string) => string;
  /**
   * Combobox — alternate handler that receives the full selection shape
   * (option pick, create tail, clear). Overrides `onSave` when present.
   * Used by the invoice cell to dispatch a `set_line_invoice` patch that
   * carries both the label and the resolved id.
   */
  onComboboxPick?: (selection: ComboboxSelection) => void;

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
  comboboxAsyncLoad,
  comboboxDisabledReason,
  comboboxCreateTailLabel,
  onComboboxPick,
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
            options={comboboxOptions}
            asyncLoad={comboboxAsyncLoad}
            disabledReason={comboboxDisabledReason}
            createTailLabel={comboboxCreateTailLabel}
            initialValue={value == null ? null : String(value)}
            onPick={(selection) => {
              if (onComboboxPick) {
                onComboboxPick(selection);
              } else if (selection.kind === "option") {
                onSave(selection.option.value);
              } else if (selection.kind === "clear") {
                onSave(null);
              } else {
                // create tail fallback for non-invoice combos that
                // happen to show a create tail — stores the query text
                onSave(selection.query);
              }
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
