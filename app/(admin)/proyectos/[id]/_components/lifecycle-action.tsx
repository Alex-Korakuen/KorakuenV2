"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CheckCircle2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  activateProject,
  completeProject,
  archiveProject,
} from "@/app/actions/projects";
import { PROJECT_STATUS } from "@/lib/types";
import type { ProjectRow } from "@/lib/types";
import { toast } from "sonner";

type Props = {
  project: ProjectRow;
};

export function LifecycleAction({ project }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(
    fn: (id: string) => Promise<{ success: boolean; error?: { message: string } }>,
    successMessage: string,
  ) {
    setBusy(true);
    const result = await fn(project.id);
    setBusy(false);
    if (result.success) {
      toast.success(successMessage);
      router.refresh();
    } else {
      toast.error(result.error?.message ?? "Error");
    }
  }

  if (project.status === PROJECT_STATUS.prospect) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="gap-1.5" disabled={busy}>
            <PlayCircle className="h-3.5 w-3.5" />
            Activar proyecto
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activar proyecto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Activar este proyecto? Los socios y el presupuesto quedarán
              congelados después de activar. Verifica que la suma de
              porcentajes de socios sea exactamente 100%.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(activateProject, "Proyecto activado")}
            >
              Activar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (project.status === PROJECT_STATUS.active) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" className="gap-1.5" disabled={busy}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Completar proyecto
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Completar proyecto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Marcar este proyecto como completado? Se establecerá la fecha
              de finalización a hoy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(completeProject, "Proyecto completado")}
            >
              Completar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (project.status === PROJECT_STATUS.completed) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy}
          >
            <Archive className="h-3.5 w-3.5" />
            Archivar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archivar proyecto</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Archivar este proyecto? Quedará oculto del listado activo pero
              permanecerá en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void run(archiveProject, "Proyecto archivado")}
            >
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return null;
}
