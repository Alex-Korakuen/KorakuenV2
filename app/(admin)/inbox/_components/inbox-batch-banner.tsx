"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { approveBatchValid } from "@/app/actions/inbox";

type BatchSummary = {
  import_batch_id: string;
  import_batch_label: string | null;
  uploaded_at: string;
  total: number;
  pending: number;
  valid: number;
  errors: number;
  approved: number;
  rejected: number;
};

type Props = {
  batch: BatchSummary;
};

export function InboxBatchBanner({ batch }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleApproveAll() {
    startTransition(async () => {
      const result = await approveBatchValid(batch.import_batch_id);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      const { approved, failed, skipped } = result.data;
      if (failed.length === 0 && skipped.length === 0) {
        toast.success(`${approved.length} pagos aprobados`);
      } else {
        toast.success(
          `${approved.length} aprobadas, ${failed.length} fallaron, ${skipped.length} con errores`,
        );
      }
      router.refresh();
    });
  }

  const approveDisabled = pending || batch.valid === 0;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
          <FileSpreadsheet className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {batch.import_batch_label ??
              `Lote ${batch.import_batch_id.slice(0, 8)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            Importado {formatDate(batch.uploaded_at)} · {batch.total} filas ·{" "}
            <span className="text-emerald-700">{batch.valid} ✓</span> ·{" "}
            <span className="text-amber-700">{batch.errors} ⚠</span>
            {batch.approved > 0 ? ` · ${batch.approved} aprobadas` : null}
            {batch.rejected > 0 ? ` · ${batch.rejected} rechazadas` : null}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={approveDisabled}
          onClick={handleApproveAll}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Aprobar {batch.valid} válidas
        </Button>
      </div>
    </div>
  );
}
