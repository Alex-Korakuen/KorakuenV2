"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, PlayCircle, XCircle } from "lucide-react";
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
  rejectProject,
} from "@/app/actions/projects";
import { PROJECT_STATUS } from "@/lib/types";
import type { ProjectRow } from "@/lib/types";
import { toast } from "sonner";

type Props = {
  project: ProjectRow;
};

type ActionFn = (id: string) => Promise<{
  success: boolean;
  error?: { message: string };
}>;

export function LifecycleAction({ project }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(fn: ActionFn, successMessage: string) {
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

  const canReject =
    project.status === PROJECT_STATUS.prospect ||
    project.status === PROJECT_STATUS.active;

  return (
    <div className="flex items-center gap-2">
      {project.status === PROJECT_STATUS.prospect && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={busy}>
              <PlayCircle className="h-3.5 w-3.5" />
              Activar
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
      )}

      {project.status === PROJECT_STATUS.active && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" className="gap-1.5" disabled={busy}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Completar
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
      )}

      {canReject && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              disabled={busy}
            >
              <XCircle className="h-3.5 w-3.5" />
              Rechazar
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rechazar proyecto</AlertDialogTitle>
              <AlertDialogDescription>
                ¿Marcar este proyecto como rechazado? Esta acción indica que
                el proyecto no procederá.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void run(rejectProject, "Proyecto rechazado")}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Rechazar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
