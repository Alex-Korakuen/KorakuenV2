"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  disabled?: boolean;
  onConfirm: (notes: string | undefined) => void;
};

/**
 * Rechazar button that opens a small popover capturing an optional
 * rejection note. The note is passed to the parent's confirm handler
 * (which calls rejectSubmission). Empty/whitespace notes become
 * `undefined` so the server stores null.
 */
export function RejectButton({ disabled, onConfirm }: Props) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");

  function handleConfirm() {
    const trimmed = notes.trim();
    onConfirm(trimmed || undefined);
    setNotes("");
    setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setNotes("");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
        >
          Rechazar
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium text-foreground">
          Rechazar submission
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Opcional: anota por qué la rechazas para revisarla más tarde.
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleConfirm();
            }
          }}
          placeholder="Motivo (opcional)…"
          rows={3}
          className="mt-3 text-sm"
          autoFocus
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleConfirm}
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
          >
            Rechazar
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          ⌘ Enter para confirmar
        </p>
      </PopoverContent>
    </Popover>
  );
}
