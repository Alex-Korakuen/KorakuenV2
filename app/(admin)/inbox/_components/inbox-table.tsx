"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { formatPEN, formatDate } from "@/lib/format";
import {
  approveSubmission,
  rejectSubmission,
  updateSubmission,
  addSubmissionLine,
  deleteSubmissionLine,
} from "@/app/actions/inbox";
import { SUBMISSION_STATUS } from "@/lib/types";
import type {
  SubmissionRow,
  PaymentSubmissionExtractedData,
  BankAccountRow,
  ProjectRow,
  CostCategoryRow,
  ContactRow,
} from "@/lib/types";
import type { SubmissionPatch } from "@/lib/validators/inbox";
import { SubmissionStatusPill } from "./submission-status-pill";
import { PaymentEditorDialog } from "./payment-editor-dialog";
import type { ComboboxOption } from "./editors/combobox-editor";

type Props = {
  submissions: SubmissionRow[];
  bankAccounts: BankAccountRow[];
  projects: ProjectRow[];
  costCategories: CostCategoryRow[];
  partners: ContactRow[];
};

function partnerShortLabel(contact: ContactRow): string {
  const source = contact.nombre_comercial?.trim() || contact.razon_social;
  return source.slice(0, 3).toUpperCase();
}

function isPaymentData(
  data: unknown,
): data is PaymentSubmissionExtractedData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: string }).kind === "payment"
  );
}

export function InboxTable({
  submissions,
  bankAccounts,
  projects,
  costCategories,
  partners,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [savingCellId, setSavingCellId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Pre-compute combobox options shared across all rows/the dialog.
  const bankOptions = useMemo<ComboboxOption[]>(
    () =>
      bankAccounts.map((b) => ({
        id: b.id,
        label: b.name,
        value: b.name,
        hint: `${b.bank_name} · ${b.currency}${
          b.account_number ? ` · ···· ${b.account_number.slice(-4)}` : ""
        }`,
      })),
    [bankAccounts],
  );
  const projectOptions = useMemo<ComboboxOption[]>(
    () =>
      projects
        .filter((p) => p.code != null)
        .map((p) => ({
          id: p.id,
          label: p.code ?? "",
          value: p.code ?? "",
          hint: p.name,
        })),
    [projects],
  );
  const partnerLabelByRuc = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of partners) {
      if (p.ruc) map.set(p.ruc, partnerShortLabel(p));
    }
    return map;
  }, [partners]);

  const costCategoryOptions = useMemo<ComboboxOption[]>(() => {
    const byId = new Map(costCategories.map((c) => [c.id, c]));

    function ancestorPath(category: CostCategoryRow): string | undefined {
      const chain: string[] = [];
      let current: CostCategoryRow | undefined = category.parent_id
        ? byId.get(category.parent_id)
        : undefined;
      let safety = 16;
      while (current && safety-- > 0) {
        chain.unshift(current.name);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return chain.length > 0 ? chain.join(" > ") : undefined;
    }

    return costCategories.map((c) => ({
      id: c.id,
      label: c.name,
      value: c.name,
      hint: ancestorPath(c),
    }));
  }, [costCategories]);

  // Navigation helpers — list order matches the table order.
  const orderedIds = useMemo(
    () => submissions.map((s) => s.id),
    [submissions],
  );

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveSubmission(id);
      if (result.success) {
        toast.success("Pago creado");
        closeDialog();
      } else {
        toast.error(result.error.message);
      }
      router.refresh();
    });
  }

  function handleReject(id: string, notes?: string) {
    startTransition(async () => {
      const result = await rejectSubmission(id, notes);
      if (result.success) {
        toast.success("Submission rechazada");
        closeDialog();
      } else {
        toast.error(result.error.message);
      }
      router.refresh();
    });
  }

  /**
   * Apply a patch that originated from a specific cell. Sets savingCellId
   * so only that cell shows a spinner; the rest of the dialog stays
   * interactive.
   */
  function handleCellPatch(
    cellId: string,
    submissionId: string,
    patch: SubmissionPatch,
  ) {
    setSavingCellId(cellId);
    startTransition(async () => {
      try {
        const result = await updateSubmission(submissionId, patch);
        if (result.success) {
          router.refresh();
        } else {
          toast.error(result.error.message);
        }
      } finally {
        setSavingCellId(null);
      }
    });
  }

  function handleAddLine(submissionId: string) {
    startTransition(async () => {
      const result = await addSubmissionLine(submissionId);
      if (result.success) router.refresh();
      else toast.error(result.error.message);
    });
  }

  function handleDeleteLine(submissionId: string, index: number) {
    startTransition(async () => {
      const result = await deleteSubmissionLine(submissionId, index);
      if (result.success) router.refresh();
      else toast.error(result.error.message);
    });
  }

  function closeDialog() {
    setSelectedId(null);
    // Delay so the closing animation doesn't strand a stale editor.
    setTimeout(() => {
      setActiveEditId(null);
      setSavingCellId(null);
    }, 200);
  }

  // Look up the selected submission live from props so it always reflects
  // the freshest data after router.refresh().
  const selectedSubmission = selectedId
    ? submissions.find((s) => s.id === selectedId) ?? null
    : null;
  const selectedData =
    selectedSubmission && isPaymentData(selectedSubmission.extracted_data)
      ? selectedSubmission.extracted_data
      : null;
  const selectedIndex = selectedId ? orderedIds.indexOf(selectedId) : -1;

  if (submissions.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
        </div>
        <p className="mt-4 text-sm font-medium text-foreground">
          No hay registros en la bandeja
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Usa el botón <span className="font-medium">Importar CSV</span>{" "}
          arriba a la derecha para subir pagos y revisarlos antes de que
          entren al sistema.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table
          className="w-full table-fixed text-sm"
          style={{ borderCollapse: "separate", borderSpacing: 0 }}
        >
          <colgroup>
            <col className="w-24" />{/* fecha + dir */}
            <col className="w-14" />{/* partner */}
            <col />{/* título (flex) */}
            <col className="w-28" />{/* cód. banco */}
            <col className="w-36" />{/* banco */}
            <col className="w-32" />{/* monto */}
            <col className="w-28" />{/* estado */}
          </colgroup>
          <thead>
            <tr className="bg-background">
              <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Fecha
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Partner
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Título
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Cód. banco
              </th>
              <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Banco
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Monto
              </th>
              <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => {
              const data = isPaymentData(s.extracted_data)
                ? s.extracted_data
                : null;
              if (!data) {
                return (
                  <tr key={s.id} className="border-t border-border">
                    <td
                      colSpan={7}
                      className="px-3 py-4 text-center text-xs text-muted-foreground"
                    >
                      Submission desconocido (source_type={s.source_type})
                    </td>
                  </tr>
                );
              }
              return (
                <PaymentRow
                  key={s.id}
                  submission={s}
                  data={data}
                  partnerLabelByRuc={partnerLabelByRuc}
                  onOpen={() => setSelectedId(s.id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedSubmission && selectedData ? (
        <PaymentEditorDialog
          submission={selectedSubmission}
          data={selectedData}
          activeEditId={activeEditId}
          savingCellId={savingCellId}
          pending={pending}
          onBeginEdit={setActiveEditId}
          onFinishEdit={() => setActiveEditId(null)}
          onCellPatch={(cellId, patch) =>
            handleCellPatch(cellId, selectedSubmission.id, patch)
          }
          onAddLine={() => handleAddLine(selectedSubmission.id)}
          onDeleteLine={(i) => handleDeleteLine(selectedSubmission.id, i)}
          onApprove={() => handleApprove(selectedSubmission.id)}
          onReject={(notes) => handleReject(selectedSubmission.id, notes)}
          onClose={closeDialog}
          navigation={{
            index: selectedIndex,
            total: orderedIds.length,
            prevId: selectedIndex > 0 ? orderedIds[selectedIndex - 1] : null,
            nextId:
              selectedIndex >= 0 && selectedIndex < orderedIds.length - 1
                ? orderedIds[selectedIndex + 1]
                : null,
          }}
          onNavigate={(id) => setSelectedId(id)}
          bankOptions={bankOptions}
          projectOptions={projectOptions}
          costCategoryOptions={costCategoryOptions}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// PaymentRow — compact single-line row, click to open the modal.
// ---------------------------------------------------------------------------

type PaymentRowProps = {
  submission: SubmissionRow;
  data: PaymentSubmissionExtractedData;
  partnerLabelByRuc: Map<string, string>;
  onOpen: () => void;
};

function PaymentRow({
  submission,
  data,
  partnerLabelByRuc,
  onOpen,
}: PaymentRowProps) {
  const header = data.header;
  const hasError = !data.validation.valid;
  const total = data.lines.reduce(
    (acc, l) => acc + (typeof l.amount === "number" ? l.amount : 0),
    0,
  );
  const rowTint = hasError
    ? "bg-red-50/40 hover:bg-red-50/60"
    : "hover:bg-primary/[0.03]";
  const directionArrow = header.direction === "inbound" ? "←" : "→";
  const directionColor =
    header.direction === "inbound" ? "text-emerald-700" : "text-amber-700";
  const directionBg =
    header.direction === "inbound" ? "bg-emerald-50" : "bg-amber-50";
  const amountColor = directionColor;
  const amountPrefix = header.direction === "inbound" ? "+ " : "− ";

  const partnerLabel = header.partner_ruc
    ? partnerLabelByRuc.get(header.partner_ruc) ?? "—"
    : "—";

  return (
    <tr
      onClick={onOpen}
      className={`cursor-pointer border-t border-border transition-colors ${rowTint}`}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold ${directionBg} ${directionColor}`}
            title={header.direction === "inbound" ? "Entrada" : "Salida"}
          >
            {directionArrow}
          </span>
          <span className="text-xs text-muted-foreground">
            {header.payment_date ? formatDate(header.payment_date) : "—"}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {partnerLabel}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-foreground">
            {header.title ?? (
              <span className="italic text-muted-foreground">—</span>
            )}
          </p>
          <span
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              header.project_code
                ? "border-border bg-background text-muted-foreground"
                : "border-dashed border-border text-muted-foreground/60"
            }`}
            title="Proyecto"
          >
            {header.project_code ?? "proy?"}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {header.bank_reference ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <p className="truncate text-foreground">
          {header.bank_account_label ?? "—"}
        </p>
      </td>
      <td
        className={`px-3 py-2.5 text-right font-medium tabular-nums ${amountColor}`}
      >
        {amountPrefix}
        {formatPEN(total)}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end">
          <SubmissionStatusPill
            reviewStatus={submission.review_status}
            errorCount={data.validation.errors.length}
          />
        </div>
      </td>
    </tr>
  );
}
