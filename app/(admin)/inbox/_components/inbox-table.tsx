"use client";

import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPEN, formatDate } from "@/lib/format";
import type {
  SubmissionRow,
  PaymentSubmissionExtractedData,
  PaymentSubmissionLine,
} from "@/lib/types";

type Props = {
  submissions: SubmissionRow[];
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

export function InboxTable({ submissions }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (submissions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No hay registros en la bandeja.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <table
        className="w-full text-sm"
        style={{ borderCollapse: "separate", borderSpacing: 0 }}
      >
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
                  <td colSpan={11} className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Submission desconocido (source_type={s.source_type})
                  </td>
                </tr>
              );
            }
            const isOpen = expanded.has(s.id);
            const total = totalLines(data.lines);
            const h = data.header;
            const hasError = !data.validation.valid;

            return (
              <PaymentGroupRow
                key={s.id}
                submission={s}
                data={data}
                total={total}
                isOpen={isOpen}
                hasError={hasError}
                onToggle={() => toggle(s.id)}
                headerRaw={h}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PaymentGroupRow({
  submission,
  data,
  total,
  isOpen,
  hasError,
  onToggle,
  headerRaw,
}: {
  submission: SubmissionRow;
  data: PaymentSubmissionExtractedData;
  total: number;
  isOpen: boolean;
  hasError: boolean;
  onToggle: () => void;
  headerRaw: PaymentSubmissionExtractedData["header"];
}) {
  const directionLabel =
    headerRaw.direction === "inbound"
      ? "Entrada"
      : headerRaw.direction === "outbound"
        ? headerRaw.is_detraction
          ? "Salida · detr"
          : "Salida"
        : "—";
  const directionColor =
    headerRaw.direction === "inbound" ? "text-emerald-700" : "text-amber-700";
  const amountColor =
    headerRaw.direction === "inbound" ? "text-emerald-700" : "text-amber-700";
  const amountPrefix = headerRaw.direction === "inbound" ? "+ " : "− ";
  const lineCountColor = hasError
    ? "text-amber-700 font-medium"
    : "text-muted-foreground";

  const rowTint = hasError
    ? "bg-amber-50/40 hover:bg-amber-50/60"
    : "hover:bg-primary/[0.03]";

  return (
    <>
      <tr
        onClick={onToggle}
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
        <td className="px-3 py-2.5 text-xs text-muted-foreground">
          {headerRaw.payment_date
            ? formatDate(headerRaw.payment_date)
            : "—"}
        </td>
        <td className="px-3 py-2.5">
          <span className={`text-xs font-medium ${directionColor}`}>
            {directionLabel}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <p className="text-foreground">{headerRaw.bank_account_label ?? "—"}</p>
        </td>
        <td className="px-3 py-2.5">
          <p className="truncate text-foreground">
            {headerRaw.contact_ruc ?? "—"}
          </p>
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
          {headerRaw.project_code ?? "—"}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
          {headerRaw.bank_reference ?? "—"}
        </td>
        <td className={`px-3 py-2.5 text-center text-xs ${lineCountColor}`}>
          {data.lines.length}
        </td>
        <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${amountColor}`}>
          {amountPrefix}
          {formatPEN(total)}
        </td>
        <td className="px-3 py-2.5">
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Button size="sm" variant="outline" disabled>
              Rechazar
            </Button>
            <Button size="sm" disabled>
              Aprobar
            </Button>
          </div>
        </td>
      </tr>

      {isOpen ? (
        <DetailPanel data={data} submissionId={submission.id} />
      ) : null}
    </>
  );
}

function DetailPanel({
  data,
  submissionId,
}: {
  data: PaymentSubmissionExtractedData;
  submissionId: string;
}) {
  return (
    <tr>
      <td colSpan={11} className="px-0 py-0">
        <div className="bg-muted/30">
          <table className="w-full text-sm">
            <tbody>
              {data.lines.map((line, i) => {
                const lineErrors = data.validation.errors.filter((e) =>
                  e.path.startsWith(`lines[${i}]`),
                );
                const hasLineError = lineErrors.length > 0;
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
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {typeof line.amount === "number"
                        ? line.amount.toFixed(2)
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${lineTypePillClasses(line.line_type)}`}
                      >
                        {line.line_type ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {line.notes ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {line.cost_category_label ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {line.invoice_number_hint ?? "—"}
                    </td>
                    <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground">
                      {hasLineError
                        ? lineErrors[0].message
                        : null}
                    </td>
                    <td className="px-3 py-2" />
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
                <td colSpan={8} />
              </tr>
            </tbody>
          </table>

          {/* Header-level errors (not tied to a specific line) */}
          {data.validation.errors.filter((e) => !e.path.startsWith("lines[")).length > 0 ? (
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
