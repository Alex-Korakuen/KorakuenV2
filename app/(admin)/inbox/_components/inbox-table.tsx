"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPEN, formatDate } from "@/lib/format";
import {
  approveSubmission,
  rejectSubmission,
  updateSubmission,
  addSubmissionLine,
  deleteSubmissionLine,
  getLinkableInvoicesForContact,
} from "@/app/actions/inbox";
import { SUBMISSION_STATUS } from "@/lib/types";
import type {
  SubmissionRow,
  PaymentSubmissionExtractedData,
  PaymentSubmissionLine,
  BankAccountRow,
  ProjectRow,
  CostCategoryRow,
} from "@/lib/types";
import type { SubmissionPatch } from "@/lib/validators/inbox";
import { EditableCell } from "./editable-cell";
import { ImportCsvDialog } from "./import-csv-dialog";
import type { ComboboxOption } from "./editors/combobox-editor";
import {
  HEADER_FIELD_EDITORS,
  LINE_FIELD_EDITORS,
} from "./editors/field-config";

type Props = {
  submissions: SubmissionRow[];
  bankAccounts: BankAccountRow[];
  projects: ProjectRow[];
  costCategories: CostCategoryRow[];
};

function isPaymentData(
  data: unknown,
): data is PaymentSubmissionExtractedData {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: string }).kind === "payment"
  );
}

function totalLines(lines: PaymentSubmissionLine[]): number {
  return lines.reduce(
    (acc, l) => acc + (typeof l.amount === "number" ? l.amount : 0),
    0,
  );
}

function lineTypePillClasses(t: PaymentSubmissionLine["line_type"]): string {
  if (t === "invoice")
    return "bg-blue-50 text-blue-700 border border-blue-200";
  if (t === "bank_fee")
    return "bg-stone-100 text-stone-600 border border-stone-200";
  if (t === "detraction")
    return "bg-amber-50 text-amber-700 border border-amber-200";
  if (t === "loan")
    return "bg-purple-50 text-purple-700 border border-purple-200";
  return "bg-stone-100 text-stone-600 border border-stone-200";
}

export function InboxTable({
  submissions,
  bankAccounts,
  projects,
  costCategories,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Pre-compute combobox options shared across rows.
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
  const costCategoryOptions = useMemo<ComboboxOption[]>(
    () => {
      const byId = new Map(costCategories.map((c) => [c.id, c]));
      return costCategories.map((c) => {
        const parent = c.parent_id ? byId.get(c.parent_id) : null;
        return {
          id: c.id,
          label: c.name,
          value: c.name,
          hint: parent?.name,
        };
      });
    },
    [costCategories],
  );

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveSubmission(id);
      if (result.success) {
        toast.success("Pago creado");
      } else {
        toast.error(result.error.message);
      }
      router.refresh();
    });
  }

  function handleReject(id: string) {
    startTransition(async () => {
      const result = await rejectSubmission(id);
      if (result.success) {
        toast.success("Submission rechazada");
      } else {
        toast.error(result.error.message);
      }
      router.refresh();
    });
  }

  function handlePatch(submissionId: string, patch: SubmissionPatch) {
    startTransition(async () => {
      const result = await updateSubmission(submissionId, patch);
      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error.message);
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
          Importa un CSV con tus pagos para revisarlos y aprobarlos antes
          de que entren al sistema.
        </p>
        <div className="mt-5">
          <ImportCsvDialog>
            <Button size="sm" className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Importar CSV
            </Button>
          </ImportCsvDialog>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table
        className="w-full table-fixed text-sm"
        style={{ borderCollapse: "separate", borderSpacing: 0 }}
      >
        <colgroup>
          <col className="w-10" />
          <col className="w-24" />
          <col className="w-16" />
          <col className="w-20" />
          <col />
          <col className="w-32" />
          <col className="w-24" />
          <col />
          <col className="w-16" />
          <col className="w-28" />
          <col className="w-40" />
        </colgroup>
        <thead>
          <tr className="bg-background">
            <th className="w-8 px-3 py-2.5" />
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Estado
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Fecha
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Dir
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Cuenta
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Contacto
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Proyecto
            </th>
            <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Ref.
            </th>
            <th className="px-3 py-2.5 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Líneas
            </th>
            <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Monto
            </th>
            <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Acciones
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
                    colSpan={11}
                    className="px-3 py-4 text-center text-xs text-muted-foreground"
                  >
                    Submission desconocido (source_type={s.source_type})
                  </td>
                </tr>
              );
            }
            return (
              <PaymentGroupRow
                key={s.id}
                submission={s}
                data={data}
                isOpen={expanded.has(s.id)}
                activeEditId={activeEditId}
                onBeginEdit={setActiveEditId}
                onFinishEdit={() => setActiveEditId(null)}
                onToggle={() => toggle(s.id)}
                onApprove={() => handleApprove(s.id)}
                onReject={() => handleReject(s.id)}
                onPatch={(patch) => handlePatch(s.id, patch)}
                onAddLine={() => handleAddLine(s.id)}
                onDeleteLine={(i) => handleDeleteLine(s.id, i)}
                pending={pending}
                bankOptions={bankOptions}
                projectOptions={projectOptions}
                costCategoryOptions={costCategoryOptions}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaymentGroupRow
// ---------------------------------------------------------------------------

type PaymentGroupRowProps = {
  submission: SubmissionRow;
  data: PaymentSubmissionExtractedData;
  isOpen: boolean;
  activeEditId: string | null;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onPatch: (patch: SubmissionPatch) => void;
  onAddLine: () => void;
  onDeleteLine: (index: number) => void;
  pending: boolean;
  bankOptions: ComboboxOption[];
  projectOptions: ComboboxOption[];
  costCategoryOptions: ComboboxOption[];
};

function PaymentGroupRow({
  submission,
  data,
  isOpen,
  activeEditId,
  onBeginEdit,
  onFinishEdit,
  onToggle,
  onApprove,
  onReject,
  onPatch,
  onAddLine,
  onDeleteLine,
  pending,
  bankOptions,
  projectOptions,
  costCategoryOptions,
}: PaymentGroupRowProps) {
  const header = data.header;
  const hasError = !data.validation.valid;
  const total = totalLines(data.lines);
  const readOnly = submission.review_status !== SUBMISSION_STATUS.pending;
  const rowTint = hasError
    ? "bg-amber-50/40 hover:bg-amber-50/60"
    : "hover:bg-primary/[0.03]";
  const directionLabel =
    header.direction === "inbound"
      ? "Entrada"
      : header.direction === "outbound"
        ? header.is_detraction
          ? "Salida · detr"
          : "Salida"
        : "—";
  const directionColor =
    header.direction === "inbound" ? "text-emerald-700" : "text-amber-700";
  const amountColor = directionColor;
  const amountPrefix = header.direction === "inbound" ? "+ " : "− ";
  const lineCountColor = hasError
    ? "text-amber-700 font-medium"
    : "text-muted-foreground";

  const cellId = (suffix: string) => `${submission.id}:${suffix}`;
  const editProps = {
    activeEditId,
    onBeginEdit,
    onFinishEdit,
    readOnly,
  };

  return (
    <>
      <tr
        onClick={() => {
          if (activeEditId) return; // don't collapse while editing
          onToggle();
        }}
        className={`cursor-pointer border-t border-border transition-colors ${rowTint} ${isOpen ? "bg-primary/[0.04]" : ""}`}
      >
        <td className="px-3 py-2.5 text-center">
          {isOpen ? (
            <ChevronDown className="inline h-4 w-4 text-amber-700" />
          ) : (
            <ChevronRight className="inline h-4 w-4 text-muted-foreground/40" />
          )}
        </td>
        <td className="px-3 py-2.5">
          {hasError ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {data.validation.errors.length}{" "}
              {data.validation.errors.length === 1 ? "error" : "errores"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              <Check className="h-3 w-3" />
              Válido
            </span>
          )}
        </td>
        {/* Fecha */}
        <td className="px-3 py-2.5">
          <EditableCell
            {...editProps}
            cellId={cellId("header.payment_date")}
            config={HEADER_FIELD_EDITORS.payment_date}
            value={header.payment_date}
            display={
              <span className="text-xs text-muted-foreground">
                {header.payment_date ? formatDate(header.payment_date) : "—"}
              </span>
            }
            onSave={(next) =>
              onPatch({
                kind: "set_header",
                field: "payment_date",
                value: next,
              })
            }
          />
        </td>
        {/* Dirección — locked, not editable */}
        <td className="px-3 py-2.5">
          <span className={`text-xs font-medium ${directionColor}`}>
            {directionLabel}
          </span>
        </td>
        {/* Cuenta */}
        <td className="px-3 py-2.5">
          <EditableCell
            {...editProps}
            cellId={cellId("header.bank_account_label")}
            config={HEADER_FIELD_EDITORS.bank_account_label}
            value={header.bank_account_label}
            comboboxOptions={bankOptions}
            display={
              <p className="truncate text-foreground">
                {header.bank_account_label ?? "—"}
              </p>
            }
            onSave={(next) =>
              onPatch({
                kind: "set_header",
                field: "bank_account_label",
                value: next,
              })
            }
          />
        </td>
        {/* Contacto (RUC) */}
        <td className="px-3 py-2.5">
          <EditableCell
            {...editProps}
            cellId={cellId("header.contact_ruc")}
            config={HEADER_FIELD_EDITORS.contact_ruc}
            value={header.contact_ruc}
            display={
              <p className="truncate font-mono text-xs text-foreground">
                {header.contact_ruc ?? "—"}
              </p>
            }
            onSave={(next) =>
              onPatch({
                kind: "set_header",
                field: "contact_ruc",
                value: next,
              })
            }
          />
        </td>
        {/* Proyecto */}
        <td className="px-3 py-2.5">
          <EditableCell
            {...editProps}
            cellId={cellId("header.project_code")}
            config={HEADER_FIELD_EDITORS.project_code}
            value={header.project_code}
            comboboxOptions={projectOptions}
            display={
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {header.project_code ?? "—"}
              </span>
            }
            onSave={(next) =>
              onPatch({
                kind: "set_header",
                field: "project_code",
                value: next,
              })
            }
          />
        </td>
        {/* Ref */}
        <td className="px-3 py-2.5">
          <EditableCell
            {...editProps}
            cellId={cellId("header.bank_reference")}
            config={HEADER_FIELD_EDITORS.bank_reference}
            value={header.bank_reference}
            display={
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {header.bank_reference ?? "—"}
              </span>
            }
            onSave={(next) =>
              onPatch({
                kind: "set_header",
                field: "bank_reference",
                value: next,
              })
            }
          />
        </td>
        <td className={`px-3 py-2.5 text-center text-xs ${lineCountColor}`}>
          {data.lines.length}
        </td>
        <td
          className={`px-3 py-2.5 text-right font-medium tabular-nums ${amountColor}`}
        >
          {amountPrefix}
          {formatPEN(total)}
        </td>
        <td className="px-3 py-2.5">
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={pending || activeEditId !== null || readOnly}
              onClick={onReject}
            >
              Rechazar
            </Button>
            <Button
              size="sm"
              disabled={pending || hasError || activeEditId !== null || readOnly}
              onClick={onApprove}
            >
              Aprobar
            </Button>
          </div>
        </td>
      </tr>

      {isOpen ? (
        <DetailPanel
          data={data}
          submissionId={submission.id}
          activeEditId={activeEditId}
          onBeginEdit={onBeginEdit}
          onFinishEdit={onFinishEdit}
          onPatch={onPatch}
          onAddLine={onAddLine}
          onDeleteLine={onDeleteLine}
          readOnly={readOnly}
          costCategoryOptions={costCategoryOptions}
          headerContactId={header.contact_id}
          headerDirection={header.direction}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// DetailPanel — lines sub-table
// ---------------------------------------------------------------------------

function DetailPanel({
  data,
  submissionId,
  activeEditId,
  onBeginEdit,
  onFinishEdit,
  onPatch,
  onAddLine,
  onDeleteLine,
  readOnly,
  costCategoryOptions,
  headerContactId,
  headerDirection,
}: {
  data: PaymentSubmissionExtractedData;
  submissionId: string;
  activeEditId: string | null;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;
  onPatch: (patch: SubmissionPatch) => void;
  onAddLine: () => void;
  onDeleteLine: (index: number) => void;
  readOnly: boolean;
  costCategoryOptions: ComboboxOption[];
  headerContactId: string | null;
  headerDirection: "inbound" | "outbound" | null;
}) {
  const editProps = { activeEditId, onBeginEdit, onFinishEdit, readOnly };

  return (
    <tr>
      <td colSpan={11} className="px-0 py-0">
        <div className="bg-muted/30">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-28" />
              <col />
              <col className="w-36" />
              <col className="w-32" />
              <col />
              <col />
              <col />
              <col className="w-12" />
            </colgroup>
            <tbody>
              {data.lines.map((line, i) => {
                const lineErrors = data.validation.errors.filter((e) =>
                  e.path.startsWith(`lines[${i}]`),
                );
                const hasLineError = lineErrors.length > 0;
                const cid = (f: string) => `${submissionId}:lines[${i}].${f}`;
                return (
                  <tr
                    key={`${submissionId}-${i}`}
                    className={`border-t border-border ${hasLineError ? "bg-red-50/50" : ""}`}
                  >
                    <td className="w-8 px-3 py-2 text-center">
                      {hasLineError ? (
                        <AlertCircle className="inline h-4 w-4 text-red-600" />
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                      línea {i + 1}
                    </td>
                    {/* Amount */}
                    <td className="px-3 py-2 text-right">
                      <EditableCell
                        {...editProps}
                        cellId={cid("amount")}
                        config={LINE_FIELD_EDITORS.amount}
                        value={line.amount}
                        display={
                          <span className="tabular-nums text-foreground">
                            {typeof line.amount === "number"
                              ? line.amount.toFixed(2)
                              : "—"}
                          </span>
                        }
                        onSave={(next) =>
                          onPatch({
                            kind: "set_line",
                            index: i,
                            field: "amount",
                            value: next,
                          })
                        }
                      />
                    </td>
                    {/* Line type */}
                    <td className="px-3 py-2">
                      <EditableCell
                        {...editProps}
                        cellId={cid("line_type")}
                        config={LINE_FIELD_EDITORS.line_type}
                        value={line.line_type}
                        display={
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${lineTypePillClasses(line.line_type)}`}
                          >
                            {line.line_type ?? "—"}
                          </span>
                        }
                        onSave={(next) =>
                          onPatch({
                            kind: "set_line",
                            index: i,
                            field: "line_type",
                            value: next,
                          })
                        }
                      />
                    </td>
                    {/* Notes */}
                    <td className="px-3 py-2">
                      <EditableCell
                        {...editProps}
                        cellId={cid("notes")}
                        config={LINE_FIELD_EDITORS.notes}
                        value={line.notes}
                        display={
                          <span className="text-xs text-muted-foreground">
                            {line.notes ?? "—"}
                          </span>
                        }
                        onSave={(next) =>
                          onPatch({
                            kind: "set_line",
                            index: i,
                            field: "notes",
                            value: next,
                          })
                        }
                      />
                    </td>
                    {/* Cost category */}
                    <td className="px-3 py-2">
                      <EditableCell
                        {...editProps}
                        cellId={cid("cost_category_label")}
                        config={LINE_FIELD_EDITORS.cost_category_label}
                        value={line.cost_category_label}
                        comboboxOptions={costCategoryOptions}
                        display={
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {line.cost_category_label ?? "—"}
                          </span>
                        }
                        onSave={(next) =>
                          onPatch({
                            kind: "set_line",
                            index: i,
                            field: "cost_category_label",
                            value: next,
                          })
                        }
                      />
                    </td>
                    {/* Invoice number — combobox of outstanding invoices for the contact */}
                    <td className="px-3 py-2">
                      <EditableCell
                        {...editProps}
                        cellId={cid("invoice_number_hint")}
                        config={LINE_FIELD_EDITORS.invoice_number_hint}
                        value={line.invoice_number_hint}
                        display={
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {line.invoice_number_hint ?? "—"}
                          </span>
                        }
                        comboboxAsyncLoad={
                          headerContactId && headerDirection
                            ? async () => {
                                const r = await getLinkableInvoicesForContact({
                                  direction: headerDirection,
                                  contactId: headerContactId,
                                });
                                if (!r.success) return [];
                                return r.data.map((inv) => ({
                                  id: inv.id,
                                  label: inv.serie_numero,
                                  value: inv.serie_numero,
                                  hint: `${formatPEN(inv.outstanding_pen)} pendiente · ${inv.fecha_emision ?? ""}`,
                                }));
                              }
                            : undefined
                        }
                        comboboxDisabledReason={
                          !headerContactId
                            ? "Primero resuelve el contacto del pago"
                            : undefined
                        }
                        comboboxCreateTailLabel={(q) =>
                          `Usar "${q}" como factura esperada`
                        }
                        onComboboxPick={(selection) => {
                          if (!headerDirection) return;
                          if (selection.kind === "option") {
                            onPatch({
                              kind: "set_line_invoice",
                              index: i,
                              hint: selection.option.label,
                              invoiceId: selection.option.id,
                              direction: headerDirection,
                            });
                          } else if (selection.kind === "create") {
                            // Hint-only: the invoice will be created at
                            // approval time per Option B.
                            onPatch({
                              kind: "set_line_invoice",
                              index: i,
                              hint: selection.query,
                              invoiceId: null,
                              direction: headerDirection,
                            });
                          } else {
                            onPatch({
                              kind: "set_line_invoice",
                              index: i,
                              hint: null,
                              invoiceId: null,
                              direction: headerDirection,
                            });
                          }
                        }}
                        onSave={() => {
                          /* unused — onComboboxPick handles all selection types */
                        }}
                      />
                    </td>
                    <td
                      colSpan={3}
                      className="px-3 py-2 text-xs text-muted-foreground"
                    >
                      {hasLineError ? lineErrors[0].message : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!readOnly && data.lines.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => onDeleteLine(i)}
                          className="text-muted-foreground hover:text-red-600"
                          title="Eliminar línea"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border bg-background">
                <td className="w-8 px-3 py-2" />
                <td className="px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  total
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                  {totalLines(data.lines).toFixed(2)}
                </td>
                <td colSpan={7} />
                <td className="px-3 py-2 text-right">
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={onAddLine}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" /> Agregar línea
                    </button>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>

          {data.validation.errors.filter((e) => !e.path.startsWith("lines["))
            .length > 0 ? (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-2.5">
              <ul className="space-y-1">
                {data.validation.errors
                  .filter((e) => !e.path.startsWith("lines["))
                  .map((err, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-amber-900"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-700" />
                      <span>
                        <span className="font-mono text-[10px] text-amber-700">
                          {err.path}
                        </span>{" "}
                        — {err.message}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
