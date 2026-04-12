"use client";

import { useState, useRef, useEffect } from "react";
import { Check, Pencil, X } from "lucide-react";
import { updateContact } from "@/app/actions/contacts";
import { toast } from "sonner";

type Props = {
  label: string;
  value: string | null;
  fieldName: string;
  contactId: string;
  type?: "text" | "email" | "tel";
};

export function InlineField({
  label,
  value,
  fieldName,
  contactId,
  type = "text",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setDraft(value ?? "");
    setEditing(true);
  }

  function discard() {
    setDraft(value ?? "");
    setEditing(false);
  }

  async function confirm() {
    if (draft === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const result = await updateContact(contactId, {
      [fieldName]: draft || null,
    });
    setSaving(false);
    if (result.success) {
      toast.success("Guardado");
      setEditing(false);
    } else {
      toast.error(result.error.message);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirm();
              if (e.key === "Escape") discard();
            }}
            disabled={saving}
            className="mt-0.5 w-full rounded px-2 py-1 text-sm text-foreground focus:outline-none border border-primary"
            style={{ boxShadow: "0 0 0 2px rgba(196,120,92,0.1)" }}
          />
        </div>
        <div className="flex items-center gap-0.5 mt-3.5">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving}
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted text-emerald-600"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={discard}
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
      className="group flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition-colors hover:bg-primary/[0.04]"
      onClick={startEditing}
    >
      <div className="min-w-0">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <p className="text-sm text-foreground truncate">
          {value || <span className="text-muted-foreground/40">—</span>}
        </p>
      </div>
      <Pencil className="h-3 w-3 shrink-0 ml-2 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}
