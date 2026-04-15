"use client";

import { useEffect } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatPEN, formatDate } from "@/lib/format";
import { SUBMISSION_STATUS } from "@/lib/types";
import type {
  SubmissionRow,
  PaymentSubmissionExtractedData,
} from "@/lib/types";
import type { SubmissionPatch } from "@/lib/validators/inbox";
import { getLinkableInvoicesForContact } from "@/app/actions/inbox";
import { EditableCell } from "./editable-cell";
import { RejectButton } from "./reject-button";
import {
  HEADER_FIELD_EDITORS,
  LINE_FIELD_EDITORS,
} from "./editors/field-config";
import type { ComboboxOption } from "./editors/combobox-editor";

type Props = {
  submission: SubmissionRow;
  data: PaymentSubmissionExtractedData;
  activeEditId: string | null;
  savingCellId: string | null;
  pending: boolean;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;
  onCellPatch: (cellId: string, patch: SubmissionPatch) => void;
  onAddLine: () => void;
  onDeleteLine: (index: number) => void;
  onApprove: () => void;
  onReject: (notes?: string) => void;
  onClose: () => void;
  // Prev/next navigation across the filtered list
  navigation: {
    index: number;
    total: number;
    prevId: string | null;
    nextId: string | null;
  };
  onNavigate: (submissionId: string) => void;
  bankOptions: ComboboxOption[];
  projectOptions: ComboboxOption[];
  costCategoryOptions: ComboboxOption[];
};

export function PaymentEditorDialog({
  submission,
  data,
  activeEditId,
  savingCellId,
  pending,
  onBeginEdit,
  onFinishEdit,
  onCellPatch,
  onAddLine,
  onDeleteLine,
  onApprove,
  onReject,
  onClose,
  navigation,
  onNavigate,
  bankOptions,
  projectOptions,
  costCategoryOptions,
}: Props) {
  const header = data.header;
  const readOnly = submission.review_status !== SUBMISSION_STATUS.pending;
  const headerErrors = data.validation.errors.filter(
    (e) => !e.path.startsWith("lines["),
  );
  const hasError = !data.validation.valid;
  const total = data.lines.reduce(
    (acc, l) => acc + (typeof l.amount === "number" ? l.amount : 0),
    0,
  );

  const directionArrow = header.direction === "inbound" ? "←" : "→";
  const directionColor =
    header.direction === "inbound" ? "text-emerald-700" : "text-amber-700";
  const directionBg =
    header.direction === "inbound" ? "bg-emerald-50" : "bg-amber-50";
  const totalColor = directionColor;
  const totalPrefix = header.direction === "inbound" ? "+ " : "− ";

  // Arrow-key navigation across submissions when no cell is being edited.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (activeEditId !== null) return;
      if (e.key === "ArrowLeft" && navigation.prevId) {
        e.preventDefault();
        onNavigate(navigation.prevId);
      } else if (e.key === "ArrowRight" && navigation.nextId) {
        e.preventDefault();
        onNavigate(navigation.nextId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeEditId, navigation.prevId, navigation.nextId, onNavigate]);

  // Tab navigation across header cells inside the modal.
  const headerCellOrder = [
    cellId("header.payment_date"),
    cellId("header.bank_reference"),
    cellId("header.bank_account_label"),
    cellId("header.contact_ruc"),
    cellId("header.project_code"),
    cellId("header.title"),
  ];
  function advanceHeaderCell(
    fromId: string,
    direction: "forward" | "backward",
  ) {
    const idx = headerCellOrder.indexOf(fromId);
    if (idx < 0) return;
    const nextIdx = direction === "forward" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= headerCellOrder.length) return;
    onBeginEdit(headerCellOrder[nextIdx]);
  }

  const headerEditProps = {
    activeEditId,
    savingCellId,
    onBeginEdit,
    onFinishEdit,
    readOnly,
    onAdvance: advanceHeaderCell,
  };

  function cellId(suffix: string): string {
    return `${submission.id}:${suffix}`;
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-3xl">
        {/* Header bar */}
        <div className="flex items-start justify-between border-b border-border px-6 py-4 pr-12">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded text-[12px] font-semibold ${directionBg} ${directionColor}`}
                title={header.direction === "inbound" ? "Entrada" : "Salida"}
              >
                {directionArrow}
              </span>
              <DialogTitle className="truncate">
                {header.title ?? (
                  <span className="italic text-muted-foreground">
                    (sin título)
                  </span>
                )}
              </DialogTitle>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {header.payment_date
                  ? formatDate(header.payment_date)
                  : "sin fecha"}
              </span>
              <span>·</span>
              <span className="truncate">
                {header.bank_account_label ?? "sin banco"}
              </span>
              {header.bank_reference ? (
                <>
                  <span>·</span>
                  <span className="font-mono">{header.bank_reference}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Header fields grid */}
          <section className="mb-6">
            <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cabecera
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fecha">
                <EditableCell
                  {...headerEditProps}
                  cellId={cellId("header.payment_date")}
                  config={HEADER_FIELD_EDITORS.payment_date}
                  value={header.payment_date}
                  display={
                    <span className="block text-sm">
                      {header.payment_date
                        ? formatDate(header.payment_date)
                        : "—"}
                    </span>
                  }
                  onSave={(next) =>
                    onCellPatch(cellId("header.payment_date"), {
                      kind: "set_header",
                      field: "payment_date",
                      value: next,
                    })
                  }
                />
              </Field>
              <Field label="Cód. operación">
                <EditableCell
                  {...headerEditProps}
                  cellId={cellId("header.bank_reference")}
                  config={HEADER_FIELD_EDITORS.bank_reference}
                  value={header.bank_reference}
                  display={
                    <span className="block font-mono text-sm">
                      {header.bank_reference ?? "—"}
                    </span>
                  }
                  onSave={(next) =>
                    onCellPatch(cellId("header.bank_reference"), {
                      kind: "set_header",
                      field: "bank_reference",
                      value: next,
                    })
                  }
                />
              </Field>
              <Field label="Banco">
                <EditableCell
                  {...headerEditProps}
                  cellId={cellId("header.bank_account_label")}
                  config={HEADER_FIELD_EDITORS.bank_account_label}
                  value={header.bank_account_label}
                  comboboxOptions={bankOptions}
                  display={
                    <span className="block truncate text-sm">
                      {header.bank_account_label ?? "—"}
                    </span>
                  }
                  onSave={(next) =>
                    onCellPatch(cellId("header.bank_account_label"), {
                      kind: "set_header",
                      field: "bank_account_label",
                      value: next,
                    })
                  }
                />
              </Field>
              <Field label="Contacto">
                <EditableCell
                  {...headerEditProps}
                  cellId={cellId("header.contact_ruc")}
                  config={HEADER_FIELD_EDITORS.contact_ruc}
                  value={header.contact_ruc}
                  display={
                    <span className="block font-mono text-sm">
                      {header.contact_ruc ?? "—"}
                    </span>
                  }
                  onSave={(next) =>
                    onCellPatch(cellId("header.contact_ruc"), {
                      kind: "set_header",
                      field: "contact_ruc",
                      value: next,
                    })
                  }
                />
              </Field>
              <Field label="Proyecto">
                <EditableCell
                  {...headerEditProps}
                  cellId={cellId("header.project_code")}
                  config={HEADER_FIELD_EDITORS.project_code}
                  value={header.project_code}
                  comboboxOptions={projectOptions}
                  display={
                    <span className="block font-mono text-sm">
                      {header.project_code ?? "—"}
                    </span>
                  }
                  onSave={(next) =>
                    onCellPatch(cellId("header.project_code"), {
                      kind: "set_header",
                      field: "project_code",
                      value: next,
                    })
                  }
                />
              </Field>
              <Field label="Partner">
                <span className="block font-mono text-sm text-muted-foreground">
                  {header.partner_ruc ?? "—"}
                </span>
              </Field>
              <div className="col-span-3">
                <Field label="Título">
                  <EditableCell
                    {...headerEditProps}
                    cellId={cellId("header.title")}
                    config={HEADER_FIELD_EDITORS.title}
                    value={header.title}
                    display={
                      <span className="block truncate text-sm">
                        {header.title ?? (
                          <span className="italic text-muted-foreground">
                            —
                          </span>
                        )}
                      </span>
                    }
                    onSave={(next) =>
                      onCellPatch(cellId("header.title"), {
                        kind: "set_header",
                        field: "title",
                        value: next,
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* Header-level validation errors */}
          {headerErrors.length > 0 ? (
            <section className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <ul className="space-y-1">
                {headerErrors.map((err, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11px] text-amber-900"
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
            </section>
          ) : null}

          {/* Lines table */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Líneas ({data.lines.length})
              </h3>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={onAddLine}
                  disabled={pending}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" /> Agregar línea
                </button>
              ) : null}
            </div>

            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-8" />
                <col />
                <col className="w-44" />
                <col className="w-28" />
                <col className="w-32" />
                <col className="w-8" />
              </colgroup>
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">#</th>
                  <th className="py-1.5 text-left font-medium">Descripción</th>
                  <th className="py-1.5 text-left font-medium">Categoría</th>
                  <th className="py-1.5 text-right font-medium">Monto</th>
                  <th className="py-1.5 text-right font-medium">Factura</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line, i) => {
                  const lineErrors = data.validation.errors.filter((e) =>
                    e.path.startsWith(`lines[${i}]`),
                  );
                  const hasLineError = lineErrors.length > 0;
                  const cid = (f: string) =>
                    `${submission.id}:lines[${i}].${f}`;

                  const lineCellOrder = [
                    cid("amount"),
                    cid("description"),
                    cid("cost_category_label"),
                    cid("invoice_number_hint"),
                  ];
                  function advanceLineCell(
                    fromId: string,
                    direction: "forward" | "backward",
                  ) {
                    const idx = lineCellOrder.indexOf(fromId);
                    if (idx < 0) return;
                    const nextIdx =
                      direction === "forward" ? idx + 1 : idx - 1;
                    if (nextIdx < 0 || nextIdx >= lineCellOrder.length) return;
                    onBeginEdit(lineCellOrder[nextIdx]);
                  }
                  const lineEditProps = {
                    activeEditId,
                    savingCellId,
                    onBeginEdit,
                    onFinishEdit,
                    readOnly,
                    onAdvance: advanceLineCell,
                  };

                  const firstErrorMsg = hasLineError
                    ? lineErrors[0].message
                    : undefined;

                  return (
                    <tr
                      key={i}
                      className={`border-t border-border ${
                        hasLineError ? "bg-red-50/50" : ""
                      }`}
                    >
                      <td className="py-2 font-mono text-[11px] text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-2 pr-2" title={firstErrorMsg}>
                        <EditableCell
                          {...lineEditProps}
                          cellId={cid("description")}
                          config={LINE_FIELD_EDITORS.description}
                          value={line.description}
                          display={
                            <span className="block truncate">
                              {line.description ?? (
                                <span className="italic text-muted-foreground">
                                  —
                                </span>
                              )}
                            </span>
                          }
                          onSave={(next) =>
                            onCellPatch(cid("description"), {
                              kind: "set_line",
                              index: i,
                              field: "description",
                              value: next,
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <EditableCell
                          {...lineEditProps}
                          cellId={cid("cost_category_label")}
                          config={LINE_FIELD_EDITORS.cost_category_label}
                          value={line.cost_category_label}
                          comboboxOptions={costCategoryOptions}
                          display={
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {line.cost_category_label ?? "—"}
                            </span>
                          }
                          onSave={(next) =>
                            onCellPatch(cid("cost_category_label"), {
                              kind: "set_line",
                              index: i,
                              field: "cost_category_label",
                              value: next,
                            })
                          }
                        />
                      </td>
                      <td className="py-2 text-right">
                        <EditableCell
                          {...lineEditProps}
                          cellId={cid("amount")}
                          config={LINE_FIELD_EDITORS.amount}
                          value={line.amount}
                          display={
                            <span className="tabular-nums">
                              {typeof line.amount === "number"
                                ? formatPEN(line.amount)
                                : "—"}
                            </span>
                          }
                          onSave={(next) =>
                            onCellPatch(cid("amount"), {
                              kind: "set_line",
                              index: i,
                              field: "amount",
                              value: next,
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <EditableCell
                          {...lineEditProps}
                          cellId={cid("invoice_number_hint")}
                          config={LINE_FIELD_EDITORS.invoice_number_hint}
                          value={line.invoice_number_hint}
                          display={
                            line.invoice_number_hint ? (
                              <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                → {line.invoice_number_hint}
                              </span>
                            ) : (
                              <span className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60">
                                + factura
                              </span>
                            )
                          }
                          comboboxAsyncLoad={
                            header.contact_id && header.direction
                              ? async () => {
                                  const r =
                                    await getLinkableInvoicesForContact({
                                      direction: header.direction!,
                                      contactId: header.contact_id!,
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
                            !header.contact_id
                              ? "Primero resuelve el contacto del pago"
                              : undefined
                          }
                          comboboxCreateTailLabel={(q) =>
                            `Usar "${q}" como factura esperada`
                          }
                          onComboboxPick={(selection) => {
                            if (!header.direction) return;
                            const key = cid("invoice_number_hint");
                            if (selection.kind === "option") {
                              onCellPatch(key, {
                                kind: "set_line_invoice",
                                index: i,
                                hint: selection.option.label,
                                invoiceId: selection.option.id,
                                direction: header.direction,
                              });
                            } else if (selection.kind === "create") {
                              onCellPatch(key, {
                                kind: "set_line_invoice",
                                index: i,
                                hint: selection.query,
                                invoiceId: null,
                                direction: header.direction,
                              });
                            } else {
                              onCellPatch(key, {
                                kind: "set_line_invoice",
                                index: i,
                                hint: null,
                                invoiceId: null,
                                direction: header.direction,
                              });
                            }
                          }}
                          onSave={() => {
                            /* combobox path handles selection */
                          }}
                        />
                      </td>
                      <td className="py-2 pl-2 text-right">
                        {!readOnly && data.lines.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => onDeleteLine(i)}
                            disabled={pending}
                            className="text-muted-foreground hover:text-red-600 disabled:opacity-40"
                            title="Eliminar línea"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-border">
                  <td />
                  <td colSpan={2} className="py-2 text-xs text-muted-foreground">
                    Total
                  </td>
                  <td
                    className={`py-2 text-right font-semibold tabular-nums ${totalColor}`}
                  >
                    {totalPrefix}
                    {formatPEN(total)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </section>

          {submission.review_status === SUBMISSION_STATUS.rejected &&
          submission.rejection_notes ? (
            <section className="mt-5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs italic text-muted-foreground">
              Rechazado: {submission.rejection_notes}
            </section>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                navigation.prevId && onNavigate(navigation.prevId)
              }
              disabled={!navigation.prevId || activeEditId !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
              title="Anterior (←)"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {navigation.index + 1} de {navigation.total}
            </span>
            <button
              type="button"
              onClick={() =>
                navigation.nextId && onNavigate(navigation.nextId)
              }
              disabled={!navigation.nextId || activeEditId !== null}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
              title="Siguiente (→)"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          {readOnly ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Cerrar
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <RejectButton
                disabled={pending || activeEditId !== null}
                onConfirm={(notes) => onReject(notes)}
              />
              <button
                type="button"
                disabled={pending || hasError || activeEditId !== null}
                onClick={onApprove}
                title={
                  hasError ? "Resuelve los errores antes de aprobar" : "Aprobar"
                }
                className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Aprobar
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}</label>
      <div className="mt-1 min-h-[32px] rounded border border-border bg-background px-3 py-1.5">
        {children}
      </div>
    </div>
  );
}
