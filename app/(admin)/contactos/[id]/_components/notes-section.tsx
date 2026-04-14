"use client";

import { useState } from "react";
import { updateContact } from "@/app/actions/contacts";
import { toast } from "sonner";
import { Markdown } from "@/components/ui/markdown";

type Props = {
  contactId: string;
  initialNotes: string | null;
};

export function NotesSection({ contactId, initialNotes }: Props) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updateContact(contactId, {
      notes: draft || null,
    });
    setSaving(false);
    if (result.success) {
      setNotes(draft);
      setEditing(false);
      toast.success("Notas guardadas");
    } else {
      toast.error(result.error.message);
    }
  }

  function handleCancel() {
    setDraft(notes);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg bg-card p-5" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-muted-foreground">Notas</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          placeholder="Escribe notas sobre este contacto…"
          className="w-full resize-y rounded-lg border border-input bg-background px-4 py-3 text-sm leading-relaxed text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
          autoFocus
        />
        <p className="mt-2 text-xs text-muted-foreground/40">
          Admite formato markdown
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg bg-card p-5 cursor-pointer transition-colors hover:bg-accent/30"
      style={{ border: "1px solid var(--border)" }}
      onClick={() => {
        setDraft(notes);
        setEditing(true);
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground">Notas</h3>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setDraft(notes);
            setEditing(true);
          }}
          className="text-xs font-medium text-primary"
        >
          Editar
        </button>
      </div>
      {notes ? (
        <Markdown>{notes}</Markdown>
      ) : (
        <p className="text-sm text-muted-foreground/40">
          Sin notas. Haz clic para agregar.
        </p>
      )}
    </div>
  );
}
