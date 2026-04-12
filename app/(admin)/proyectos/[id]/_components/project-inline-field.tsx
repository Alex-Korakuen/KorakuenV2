"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Check, Pencil, X } from "lucide-react";
import { updateProject } from "@/app/actions/projects";
import { toast } from "sonner";

type Props = {
  label: string;
  display: ReactNode;
  projectId: string;
  // Custom render for the edit inputs. Called with value state and setters.
  // Return true from onConfirm to close the editor; false to keep open.
  renderEdit: (props: {
    onConfirm: () => void;
    onDiscard: () => void;
    saving: boolean;
  }) => ReactNode;
  // The payload to send to updateProject on confirm.
  buildPayload: () => Record<string, unknown> | null;
  borderRight?: boolean;
};

export function ProjectInlineField({
  label,
  display,
  projectId,
  renderEdit,
  buildPayload,
  borderRight,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const first = wrapperRef.current?.querySelector<HTMLInputElement>(
      "input, select, textarea",
    );
    first?.focus();
  }, [editing]);

  async function onConfirm() {
    const payload = buildPayload();
    if (!payload) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await updateProject(projectId, payload);
    setSaving(false);
    if (result.success) {
      toast.success("Guardado");
      setEditing(false);
    } else {
      toast.error(result.error.message);
    }
  }

  function onDiscard() {
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        ref={wrapperRef}
        className="flex items-start gap-1.5 px-2.5 py-1.5"
        style={borderRight ? { borderRight: "1px solid var(--border)" } : undefined}
      >
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          <div className="mt-0.5">
            {renderEdit({ onConfirm, onDiscard, saving })}
          </div>
        </div>
        <div className="flex items-center gap-0.5 mt-4">
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-emerald-600"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start justify-between px-2.5 py-1.5 cursor-pointer rounded transition-colors hover:bg-primary/[0.04]"
      style={borderRight ? { borderRight: "1px solid var(--border)" } : undefined}
      onClick={() => setEditing(true)}
    >
      <div className="min-w-0 flex-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="text-sm text-foreground truncate">{display}</div>
      </div>
      <Pencil className="h-3 w-3 shrink-0 ml-2 mt-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
