"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Plus,
  Trash2,
} from "lucide-react";
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
  ContactRow,
} from "@/lib/types";
import type { SubmissionPatch } from "@/lib/validators/inbox";
import { EditableCell } from "./editable-cell";
import { RejectButton } from "./reject-button";
import { SubmissionStatusPill } from "./submission-status-pill";
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

function totalLines(lines: PaymentSubmissionLine[]): number {
  return lines.reduce(
    (acc, l) => acc + (typeof l.amount === "number" ? l.amount : 0),
    0,
  );
}

export function InboxTable({
  submissions,
  bankAccounts,
  projects,
  costCategories,
  partners,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [savingCellId, setSavingCellId] = useState<string | null>(null);
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
  // Partner lookup: ruc → short label (first 3 uppercase chars of
  // nombre_comercial, falling back to razon_social). The submission header
  // carries partner_ruc before approval resolves partner_id, so we key on
  // ruc to match early display.
  const partnerLabelByRuc = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const p of partners) {
      if (p.ruc) map.set(p.ruc, partnerShortLabel(p));
    }
    return map;
  }, [partners]);

  const costCategoryOptions = useMemo<ComboboxOption[]>(() => {
    const byId = new Map(costCategories.map((c) => [c.id, c]));

    // Walk up the parent_id chain and join the ancestor names with " > "
    // so the combobox hint shows the full path instead of only the
    // immediate parent. Leaf name stays in `label` for compact display;
    // ancestors-only in `hint` below it.
    function ancestorPath(category: CostCategoryRow): string | undefined {
      const chain: string[] = [];
      let current: CostCategoryRow | undefined = category.parent_id
        ? byId.get(category.parent_id)
        : undefined;
      // Hard cap to avoid infinite loops from bad parent_id data
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

  function handleReject(id: string, notes?: string) {
    startTransition(async () => {
      const result = await rejectSubmission(id, notes);
      if (result.success) {
        toast.success("Submission rechazada");
      } else {
        toast.error(result.error.message);
      }
      router.refresh();
    });
  }

  /**
   * Apply a patch that originated from a specific cell. Sets savingCellId
   * so only that cell shows a spinner; the rest of the table stays
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

  /**
   * Apply a patch that isn't scoped to a single cell (add_line /
   * delete_line). No per-cell spinner — uses the global `pending` flag.
   */
  function handleTablePatch(submissionId: string, patch: SubmissionPatch) {
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
          Usa el botón <span className="font-medium">Importar CSV</span>{" "}
          arriba a la derecha para subir pagos y revisarlos antes de que
          entren al sistema.
        </p>
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
          <col className="w-10" />{/* chevron */}
          <col className="w-24" />{/* fecha + dir */}
          <col className="w-14" />{/* partner */}
          <col />{/* título (flex) */}
          <col className="w-28" />{/* cód. banco */}
          <col className="w-36" />{/* banco */}
          <col className="w-32" />{/* monto */}
          <col className="w-28" />{/* acciones */}
        </colgroup>
        <thead>
          <tr className="bg-background">
            <th className="w-8 px-3 py-2.5" />
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
                    colSpan={8}
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
                savingCellId={savingCellId}
                onBeginEdit={setActiveEditId}
                onFinishEdit={() => setActiveEditId(null)}
                onToggle={() => toggle(s.id)}
                onApprove={() => handleApprove(s.id)}
                onReject={(notes) => handleReject(s.id, notes)}
                onCellPatch={(cellId, patch) =>
                  handleCellPatch(cellId, s.id, patch)
                }
                onAddLine={() => handleAddLine(s.id)}
                onDeleteLine={(i) => handleDeleteLine(s.id, i)}
                pending={pending}
                bankOptions={bankOptions}
                projectOptions={projectOptions}
                costCategoryOptions={costCategoryOptions}
                partnerLabelByRuc={partnerLabelByRuc}
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
  savingCellId: string | null;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;
  onToggle: () => void;
  onApprove: () => void;
  onReject: (notes?: string) => void;
  onCellPatch: (cellId: string, patch: SubmissionPatch) => void;
  onAddLine: () => void;
  onDeleteLine: (index: number) => void;
  pending: boolean;
  bankOptions: ComboboxOption[];
  projectOptions: ComboboxOption[];
  costCategoryOptions: ComboboxOption[];
  partnerLabelByRuc: Map<string, string>;
};

function PaymentGroupRow({
  submission,
  data,
  isOpen,
  activeEditId,
  savingCellId,
  onBeginEdit,
  onFinishEdit,
  onToggle,
  onApprove,
  onReject,
  onCellPatch,
  onAddLine,
  onDeleteLine,
  pending,
  bankOptions,
  projectOptions,
  costCategoryOptions,
  partnerLabelByRuc,
}: PaymentGroupRowProps) {
  const header = data.header;
  const hasHeaderError = data.validation.errors.some(
    (e) => !e.path.startsWith("lines["),
  );
  const hasLineErrors = data.validation.errors.some((e) =>
    e.path.startsWith("lines["),
  );
  const hasError = !data.validation.valid;
  const total = totalLines(data.lines);
  const readOnly = submission.review_status !== SUBMISSION_STATUS.pending;
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

  const cellId = (suffix: string) => `${submission.id}:${suffix}`;

  // Tab navigation cell order for the main row, reflecting the new 8-col
  // layout. Partner is derived (via partner_ruc), so editing still targets
  // project_code + bank_reference + bank_account_label + payment_date + title.
  const mainRowCellOrder = [
    cellId("header.payment_date"),
    cellId("header.title"),
    cellId("header.project_code"),
    cellId("header.bank_reference"),
    cellId("header.bank_account_label"),
  ];

  function advanceMainRowCell(
    fromId: string,
    direction: "forward" | "backward",
  ) {
    const idx = mainRowCellOrder.indexOf(fromId);
    if (idx < 0) return;
    const nextIdx = direction === "forward" ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= mainRowCellOrder.length) return;
    onBeginEdit(mainRowCellOrder[nextIdx]);
  }

  const editProps = {
    activeEditId,
    savingCellId,
    onBeginEdit,
    onFinishEdit,
    readOnly,
    onAdvance: advanceMainRowCell,
  };

  // Red cell-err tint on the chevron td when any line has validation
  // errors — signals "something's wrong inside" from the collapsed view.
  const chevronCellClass = hasLineErrors
    ? "px-3 py-2.5 text-center bg-red-50 border-l-2 border-red-300"
    : "px-3 py-2.5 text-center";
  const chevronColor = hasLineErrors
    ? "text-red-600"
    : isOpen
      ? "text-foreground"
      : "text-muted-foreground/40";

  return (
    <>
      <tr
        onClick={() => {
          if (activeEditId) return; // don't collapse while editing
          onToggle();
        }}
        className={`cursor-pointer border-t border-border transition-colors ${rowTint} ${isOpen ? "bg-primary/[0.04]" : ""}`}
      >
        {/* Chevron */}
        <td className={chevronCellClass}>
          {isOpen ? (
            <ChevronDown className={`inline h-4 w-4 ${chevronColor}`} />
          ) : (
            <ChevronRight className={`inline h-4 w-4 ${chevronColor}`} />
          )}
        </td>
        {/* Fecha + Dir (merged) */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded text-[11px] font-semibold ${directionBg} ${directionColor}`}
              title={header.direction === "inbound" ? "Entrada" : "Salida"}
            >
              {directionArrow}
            </span>
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
                onCellPatch(cellId("header.payment_date"), {
                  kind: "set_header",
                  field: "payment_date",
                  value: next,
                })
              }
            />
          </div>
        </td>
        {/* Partner (derived, read-only pill) */}
        <td className="px-3 py-2.5">
          <span className="inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {partnerLabel}
          </span>
        </td>
        {/* Título — editable, with Proyecto badge beside it */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <EditableCell
                {...editProps}
                cellId={cellId("header.title")}
                config={HEADER_FIELD_EDITORS.title}
                value={header.title}
                display={
                  <p className="truncate text-foreground">
                    {header.title ?? (
                      <span className="italic text-muted-foreground">—</span>
                    )}
                  </p>
                }
                onSave={(next) =>
                  onCellPatch(cellId("header.title"), {
                    kind: "set_header",
                    field: "title",
                    value: next,
                  })
                }
              />
            </div>
            <div className="shrink-0">
              <EditableCell
                {...editProps}
                cellId={cellId("header.project_code")}
                config={HEADER_FIELD_EDITORS.project_code}
                value={header.project_code}
                comboboxOptions={projectOptions}
                display={
                  header.project_code ? (
                    <span
                      className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      title="Proyecto"
                    >
                      {header.project_code}
                    </span>
                  ) : (
                    <span className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/60">
                      proy?
                    </span>
                  )
                }
                onSave={(next) =>
                  onCellPatch(cellId("header.project_code"), {
                    kind: "set_header",
                    field: "project_code",
                    value: next,
                  })
                }
              />
            </div>
          </div>
        </td>
        {/* Cód. banco */}
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
              onCellPatch(cellId("header.bank_reference"), {
                kind: "set_header",
                field: "bank_reference",
                value: next,
              })
            }
          />
        </td>
        {/* Banco */}
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
              onCellPatch(cellId("header.bank_account_label"), {
                kind: "set_header",
                field: "bank_account_label",
                value: next,
              })
            }
          />
        </td>
        {/* Monto */}
        <td
          className={`px-3 py-2.5 text-right font-medium tabular-nums ${amountColor}`}
        >
          {amountPrefix}
          {formatPEN(total)}
        </td>
        {/* Acciones */}
        <td className="px-3 py-2.5">
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {readOnly ? (
              <SubmissionStatusPill
                reviewStatus={submission.review_status}
                errorCount={data.validation.errors.length}
              />
            ) : (
              <>
                <RejectButton
                  disabled={pending || activeEditId !== null}
                  onConfirm={(notes) => onReject(notes)}
                />
                <button
                  type="button"
                  disabled={pending || hasError || activeEditId !== null}
                  onClick={onApprove}
                  title={hasError ? "Resuelve los errores antes de aprobar" : "Aprobar"}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {submission.review_status === SUBMISSION_STATUS.rejected &&
      submission.rejection_notes ? (
        <tr className="border-t border-border bg-muted/30">
          <td />
          <td colSpan={7} className="px-3 py-1.5 text-[11px] italic text-muted-foreground">
            Rechazado: {submission.rejection_notes}
          </td>
        </tr>
      ) : null}

      {isOpen ? (
        <DetailPanel
          data={data}
          submissionId={submission.id}
          activeEditId={activeEditId}
          savingCellId={savingCellId}
          onBeginEdit={onBeginEdit}
          onFinishEdit={onFinishEdit}
          onCellPatch={onCellPatch}
          onAddLine={onAddLine}
          onDeleteLine={onDeleteLine}
          readOnly={readOnly}
          costCategoryOptions={costCategoryOptions}
          headerContactId={header.contact_id}
          headerDirection={header.direction}
          hasHeaderError={hasHeaderError}
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
  savingCellId,
  onBeginEdit,
  onFinishEdit,
  onCellPatch,
  onAddLine,
  onDeleteLine,
  readOnly,
  costCategoryOptions,
  headerContactId,
  headerDirection,
  hasHeaderError,
}: {
  data: PaymentSubmissionExtractedData;
  submissionId: string;
  activeEditId: string | null;
  savingCellId: string | null;
  onBeginEdit: (cellId: string) => void;
  onFinishEdit: () => void;
  onCellPatch: (cellId: string, patch: SubmissionPatch) => void;
  onAddLine: () => void;
  onDeleteLine: (index: number) => void;
  readOnly: boolean;
  costCategoryOptions: ComboboxOption[];
  headerContactId: string | null;
  headerDirection: "inbound" | "outbound" | null;
  hasHeaderError: boolean;
}) {
  const headerErrors = data.validation.errors.filter(
    (e) => !e.path.startsWith("lines["),
  );
  return (
    <>
      {data.lines.map((line, i) => {
        const lineErrors = data.validation.errors.filter((e) =>
          e.path.startsWith(`lines[${i}]`),
        );
        const hasLineError = lineErrors.length > 0;
        const cid = (f: string) => `${submissionId}:lines[${i}].${f}`;

        // Tab navigation order for this line. Line-level editors share
        // the same advance helper so Tab moves through amount →
        // description → category → invoice hint → (back to amount of next line).
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
          const nextIdx = direction === "forward" ? idx + 1 : idx - 1;
          if (nextIdx < 0 || nextIdx >= lineCellOrder.length) return;
          onBeginEdit(lineCellOrder[nextIdx]);
        }

        const editProps = {
          activeEditId,
          savingCellId,
          onBeginEdit,
          onFinishEdit,
          readOnly,
          onAdvance: advanceLineCell,
        };

        // Pick the first error to surface as a tooltip on the description
        // cell when the description/invoice cells are "—".
        const firstErrorMsg = hasLineError ? lineErrors[0].message : undefined;

        return (
          <tr
            key={`${submissionId}-${i}`}
            className={`border-t border-dashed border-border/70 bg-muted/30 text-xs ${hasLineError ? "bg-red-50/50" : ""}`}
          >
            {/* #N marker in the chev col — preserves column alignment and
                visually anchors the continuation rows to the parent chevron. */}
            <td className="px-3 py-2 text-center font-mono text-[10px] text-muted-foreground">
              #{i + 1}
            </td>
            {/* Descripción spans fecha + partner + título (3 main cols). */}
            <td colSpan={3} className="px-3 py-2" title={firstErrorMsg}>
              <EditableCell
                {...editProps}
                cellId={cid("description")}
                config={LINE_FIELD_EDITORS.description}
                value={line.description}
                display={
                  <span className="block truncate text-foreground">
                    {line.description ?? (
                      <span className="italic text-muted-foreground">—</span>
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
            {/* Categoría spans cód. banco + banco (2 main cols) */}
            <td colSpan={2} className="px-3 py-2">
              <EditableCell
                {...editProps}
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
            {/* Monto */}
            <td className="px-3 py-2 text-right">
              <EditableCell
                {...editProps}
                cellId={cid("amount")}
                config={LINE_FIELD_EDITORS.amount}
                value={line.amount}
                display={
                  <span className="tabular-nums text-foreground">
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
            {/* Acciones — invoice link chip + delete */}
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1.5">
                <EditableCell
                  {...editProps}
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
                    const cellKey = cid("invoice_number_hint");
                    if (selection.kind === "option") {
                      onCellPatch(cellKey, {
                        kind: "set_line_invoice",
                        index: i,
                        hint: selection.option.label,
                        invoiceId: selection.option.id,
                        direction: headerDirection,
                      });
                    } else if (selection.kind === "create") {
                      onCellPatch(cellKey, {
                        kind: "set_line_invoice",
                        index: i,
                        hint: selection.query,
                        invoiceId: null,
                        direction: headerDirection,
                      });
                    } else {
                      onCellPatch(cellKey, {
                        kind: "set_line_invoice",
                        index: i,
                        hint: null,
                        invoiceId: null,
                        direction: headerDirection,
                      });
                    }
                  }}
                  onSave={() => {
                    /* combobox path handles selection */
                  }}
                />
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
              </div>
            </td>
          </tr>
        );
      })}

      {!readOnly ? (
        <tr className="border-t border-dashed border-border/70 bg-muted/30">
          <td className="px-3 py-1.5" />
          <td colSpan={6} />
          <td className="px-3 py-1.5 text-right">
            <button
              type="button"
              onClick={onAddLine}
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <Plus className="h-3 w-3" /> Agregar línea
            </button>
          </td>
        </tr>
      ) : null}

      {hasHeaderError ? (
        <tr className="border-t border-amber-200 bg-amber-50">
          <td />
          <td colSpan={7} className="px-4 py-2">
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
          </td>
        </tr>
      ) : null}
    </>
  );
}
