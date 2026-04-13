"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createInboxBatch } from "@/app/actions/inbox";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB — must match the server cap

type Phase =
  | { kind: "idle" }
  | { kind: "selected"; file: File; text: string }
  | { kind: "uploading" }
  | { kind: "error"; message: string };

type Props = {
  children: ReactNode;
};

export function ImportCsvDialog({ children }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    setPhase({ kind: "idle" });
    setDragActive(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Delay the state reset so the dialog-closing animation doesn't
      // see a content flash.
      setTimeout(reset, 200);
    }
  }

  async function acceptFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setPhase({
        kind: "error",
        message: "El archivo debe tener extensión .csv",
      });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setPhase({
        kind: "error",
        message: `El archivo excede el tamaño máximo (${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB)`,
      });
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setPhase({ kind: "error", message: "El archivo está vacío" });
        return;
      }
      setPhase({ kind: "selected", file, text });
    } catch (err) {
      setPhase({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "No se pudo leer el archivo",
      });
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void acceptFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void acceptFile(file);
  }

  async function handleSubmit() {
    if (phase.kind !== "selected") return;
    const { file, text } = phase;
    setPhase({ kind: "uploading" });

    const result = await createInboxBatch({
      csvText: text,
      filename: file.name,
    });

    if (!result.success) {
      setPhase({ kind: "error", message: result.error.message });
      return;
    }

    const { batchId, totalGroups, validCount, errorCount } = result.data;
    toast.success(
      `${totalGroups} pagos importados · ${validCount} válidas${errorCount > 0 ? ` · ${errorCount} con errores` : ""}`,
    );
    setOpen(false);
    setTimeout(reset, 200);
    router.push(`/inbox?batch_id=${batchId}`);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>Importar pagos desde CSV</DialogTitle>

        <div className="mt-4 space-y-5">
          {/* Step 1 — download template */}
          <Step number={1} title="Descarga la plantilla">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-1.5"
            >
              <a href="/api/inbox/template" download>
                <Download className="h-3.5 w-3.5" />
                plantilla-pagos.csv
              </a>
            </Button>
          </Step>

          {/* Step 2 — instructions */}
          <Step number={2} title="Llena la plantilla">
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              <li>• Una fila por línea de pago</li>
              <li>
                • Mismo{" "}
                <span className="font-mono text-[11px]">group_id</span> para
                líneas del mismo pago
              </li>
              <li>• RUC desconocido se crea vía SUNAT automáticamente</li>
            </ul>
          </Step>

          {/* Step 3 — drop zone */}
          <Step number={3} title="Sube el archivo">
            <DropZone
              phase={phase}
              dragActive={dragActive}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              onChangeFile={reset}
            />
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </Step>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={phase.kind === "uploading"}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleSubmit}
            disabled={phase.kind !== "selected"}
          >
            {phase.kind === "uploading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Subir y revisar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {number}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}

function DropZone({
  phase,
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onChangeFile,
}: {
  phase: Phase;
  dragActive: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
  onChangeFile: () => void;
}) {
  if (phase.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-red-900">Error</p>
            <p className="mt-0.5 text-xs text-red-800">{phase.message}</p>
          </div>
        </div>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onChangeFile}
          >
            Intentar de nuevo
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "selected") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileSpreadsheet className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {phase.file.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {(phase.file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onChangeFile}
          className="shrink-0 text-xs"
        >
          Cambiar
        </Button>
      </div>
    );
  }

  if (phase.kind === "uploading") {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 px-4 py-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="mt-3 text-sm text-foreground">Procesando…</p>
        <p className="text-xs text-muted-foreground">
          Parseando, resolviendo contactos y guardando
        </p>
      </div>
    );
  }

  // idle
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
        dragActive
          ? "border-primary bg-primary/10"
          : "border-border bg-muted/20 hover:bg-muted/30"
      }`}
    >
      <FileSpreadsheet className="h-6 w-6 text-primary" />
      <p className="mt-2 text-sm text-foreground">Arrastra tu CSV aquí</p>
      <p className="text-xs text-muted-foreground">
        o haz clic para seleccionar
      </p>
    </div>
  );
}
