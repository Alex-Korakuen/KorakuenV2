"use client";

import { useState } from "react";
import { updateProject } from "@/app/actions/projects";
import { toast } from "sonner";

type Props = {
  projectId: string;
  initialNotes: string | null;
};

export function ProjectNotes({ projectId, initialNotes }: Props) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const result = await updateProject(projectId, { notes: draft || null });
    setSaving(false);
    if (result.success) {
      setNotes(draft);
      setEditing(false);
      toast.success("Notas guardadas");
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-muted-foreground">Notas</h3>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(notes);
              setEditing(true);
            }}
            className="text-xs font-medium text-primary"
          >
            Editar
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(notes);
                setEditing(false);
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="text-xs font-medium text-primary"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        )}
      </div>
      <div
        className="rounded-lg bg-card p-4"
        style={{ border: "1px solid var(--border)" }}
      >
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="Notas internas sobre el proyecto…"
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            autoFocus
          />
        ) : notes ? (
          <div className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
            {notes}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/40">
            Sin notas. Haz clic en Editar para agregar.
          </p>
        )}
      </div>
    </div>
  );
}
