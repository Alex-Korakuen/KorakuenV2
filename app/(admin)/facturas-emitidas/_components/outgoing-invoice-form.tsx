"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectPicker } from "@/components/widgets/project-picker";
import {
  createOutgoingInvoice,
  updateOutgoingInvoice,
  setOutgoingInvoiceLineItems,
  markOutgoingInvoiceAsSent,
} from "@/app/actions/outgoing-invoices";
import { roundMoney } from "@/lib/format";
import { toast } from "sonner";
import type {
  OutgoingInvoiceRow,
  OutgoingInvoiceLineItemRow,
  ProjectRow,
} from "@/lib/types";

type LineItemDraft = {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unit_price: string;
  igv_applies: boolean;
};

type Props = {
  // If provided, we are editing an existing invoice
  invoice?: OutgoingInvoiceRow;
  existingLineItems?: OutgoingInvoiceLineItemRow[];
  initialProject?: ProjectRow;
};

const IGV_RATE = 0.18;

function newLineDraft(): LineItemDraft {
  return {
    key: crypto.randomUUID(),
    description: "",
    unit: "und",
    quantity: "",
    unit_price: "",
    igv_applies: true,
  };
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function OutgoingInvoiceForm({
  invoice,
  existingLineItems,
  initialProject,
}: Props) {
  const router = useRouter();
  const isEdit = !!invoice;

  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(
    initialProject ?? null,
  );
  const [issueDate, setIssueDate] = useState(
    invoice?.issue_date ??
      new Date().toISOString().split("T")[0],
  );
  const [currency, setCurrency] = useState<"PEN" | "USD">(
    (invoice?.currency as "PEN" | "USD") ?? "PEN",
  );
  const [periodStart, setPeriodStart] = useState(invoice?.period_start ?? "");
  const [periodEnd, setPeriodEnd] = useState(invoice?.period_end ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");

  const [lines, setLines] = useState<LineItemDraft[]>(() => {
    if (existingLineItems && existingLineItems.length > 0) {
      return existingLineItems.map((li) => ({
        key: li.id,
        description: li.description,
        unit: li.unit ?? "",
        quantity: String(li.quantity),
        unit_price: String(li.unit_price),
        igv_applies: li.igv_applies,
      }));
    }
    return [newLineDraft()];
  });

  // Detracción
  const [detraccionEnabled, setDetraccionEnabled] = useState(
    invoice?.detraction_rate != null && Number(invoice.detraction_rate) > 0,
  );
  const [detraccionRate, setDetraccionRate] = useState(
    invoice?.detraction_rate != null
      ? String(invoice.detraction_rate)
      : "12",
  );
  const [detraccionAmount, setDetraccionAmount] = useState(
    invoice?.detraction_amount != null
      ? String(invoice.detraction_amount)
      : "",
  );

  // SUNAT
  const [serie, setSerie] = useState(
    invoice?.serie_numero?.split("-")[0] ?? "",
  );
  const [numero, setNumero] = useState(
    invoice?.serie_numero?.split("-")[1] ?? "",
  );

  // Live totals
  const totals = useMemo(() => {
    let subtotal = 0;
    let igv = 0;
    for (const line of lines) {
      const qty = parseNum(line.quantity);
      const price = parseNum(line.unit_price);
      const lineSubtotal = roundMoney(qty * price);
      subtotal += lineSubtotal;
      if (line.igv_applies) {
        igv += roundMoney(lineSubtotal * IGV_RATE);
      }
    }
    subtotal = roundMoney(subtotal);
    igv = roundMoney(igv);
    const total = roundMoney(subtotal + igv);
    const detraccion =
      detraccionEnabled
        ? detraccionAmount
          ? parseNum(detraccionAmount)
          : roundMoney((total * parseNum(detraccionRate)) / 100)
        : 0;
    const neto = roundMoney(total - detraccion);
    return { subtotal, igv, total, detraccion, neto };
  }, [lines, detraccionEnabled, detraccionRate, detraccionAmount]);

  function updateLine(key: string, patch: Partial<LineItemDraft>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function addLine() {
    setLines((prev) => [...prev, newLineDraft()]);
  }

  function lineSubtotal(line: LineItemDraft): number {
    return roundMoney(parseNum(line.quantity) * parseNum(line.unit_price));
  }

  function lineTotal(line: LineItemDraft): number {
    const sub = lineSubtotal(line);
    const igv = line.igv_applies ? roundMoney(sub * IGV_RATE) : 0;
    return roundMoney(sub + igv);
  }

  function buildLineItemsInput() {
    return lines
      .filter((l) => l.description.trim() && parseNum(l.quantity) > 0)
      .map((l, i) => {
        const qty = parseNum(l.quantity);
        const price = parseNum(l.unit_price);
        const sub = roundMoney(qty * price);
        const igvAmount = l.igv_applies ? roundMoney(sub * IGV_RATE) : 0;
        return {
          sort_order: i,
          description: l.description.trim(),
          unit: l.unit || null,
          quantity: qty,
          unit_price: price,
          subtotal: sub,
          igv_applies: l.igv_applies,
          igv_amount: igvAmount,
          total: roundMoney(sub + igvAmount),
        };
      });
  }

  async function handleSave(markSent: boolean) {
    if (!project) {
      toast.error("Selecciona un proyecto");
      return;
    }
    if (!issueDate || !periodStart || !periodEnd) {
      toast.error("Fechas requeridas");
      return;
    }
    const cleanLines = buildLineItemsInput();
    if (cleanLines.length === 0) {
      toast.error("Agrega al menos una línea");
      return;
    }

    setSaving(true);

    const serieNumero =
      serie.trim() && numero.trim()
        ? `${serie.trim()}-${numero.trim()}`
        : null;

    if (!isEdit) {
      const result = await createOutgoingInvoice({
        project_id: project.id,
        period_start: periodStart,
        period_end: periodEnd,
        issue_date: issueDate,
        currency,
        detraction_rate: detraccionEnabled ? parseNum(detraccionRate) : null,
        detraction_amount: detraccionEnabled ? totals.detraccion : null,
        serie_numero: serieNumero,
        notes: notes.trim() || null,
        line_items: cleanLines,
      });

      if (!result.success) {
        setSaving(false);
        toast.error(result.error.message);
        return;
      }

      if (markSent) {
        const sentResult = await markOutgoingInvoiceAsSent(result.data.id);
        if (!sentResult.success) {
          setSaving(false);
          toast.error(
            `Creada pero no emitida: ${sentResult.error.message}`,
          );
          router.push(`/facturas-emitidas/${result.data.id}`);
          return;
        }
      }

      setSaving(false);
      toast.success(markSent ? "Factura emitida" : "Borrador guardado");
      router.push(`/facturas-emitidas/${result.data.id}`);
      return;
    }

    // Edit flow
    const headerResult = await updateOutgoingInvoice(invoice.id, {
      period_start: periodStart,
      period_end: periodEnd,
      issue_date: issueDate,
      currency,
      detraction_rate: detraccionEnabled ? parseNum(detraccionRate) : null,
      detraction_amount: detraccionEnabled ? totals.detraccion : null,
      serie_numero: serieNumero,
      notes: notes.trim() || null,
    });
    if (!headerResult.success) {
      setSaving(false);
      toast.error(headerResult.error.message);
      return;
    }

    const linesResult = await setOutgoingInvoiceLineItems(
      invoice.id,
      cleanLines,
    );
    if (!linesResult.success) {
      setSaving(false);
      toast.error(linesResult.error.message);
      return;
    }

    setSaving(false);
    toast.success("Cambios guardados");
    router.refresh();
  }

  const canSendFromDraft = !isEdit || invoice?.status === 1;

  return (
    <div className="max-w-4xl px-8 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">
          {isEdit ? "Editar factura emitida" : "Nueva factura emitida"}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSave(false)}
            disabled={saving}
          >
            {saving ? "Guardando…" : "Guardar borrador"}
          </Button>
          {canSendFromDraft && (
            <Button
              size="sm"
              onClick={() => void handleSave(true)}
              disabled={saving}
            >
              Crear y emitir
            </Button>
          )}
        </div>
      </div>

        {/* Cabecera */}
        <section className="mb-8">
          <h3 className="text-[11px] text-muted-foreground mb-3">Cabecera</h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Proyecto</label>
              <ProjectPicker
                value={project?.id ?? null}
                onChange={setProject}
                className="mt-0.5"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Fecha emisión</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Moneda</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as "PEN" | "USD")}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              >
                <option value="PEN">PEN (S/)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground">Periodo inicio</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Periodo fin</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Notas internas</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="4to avance · hito de entrega"
                className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
        </section>

        {/* Líneas */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground">
              Líneas de la factura
            </h3>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              <Plus className="h-3 w-3" />
              Agregar línea
            </button>
          </div>
          <div
            className="rounded-lg bg-card overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th
                    className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "45%" }}
                  >
                    Descripción
                  </th>
                  <th
                    className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "10%" }}
                  >
                    Unidad
                  </th>
                  <th
                    className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "10%" }}
                  >
                    Cantidad
                  </th>
                  <th
                    className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "12%" }}
                  >
                    P. Unitario
                  </th>
                  <th
                    className="text-center px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "6%" }}
                  >
                    IGV
                  </th>
                  <th
                    className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    style={{ width: "15%" }}
                  >
                    Total
                  </th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr
                    key={line.key}
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        placeholder="Descripción"
                        className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm rounded focus:outline-none focus:border-primary focus:bg-background"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(line.key, { unit: e.target.value })
                        }
                        placeholder="und"
                        className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm rounded focus:outline-none focus:border-primary focus:bg-background"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value })
                        }
                        placeholder="0"
                        className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm font-mono text-right rounded focus:outline-none focus:border-primary focus:bg-background"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.unit_price}
                        onChange={(e) =>
                          updateLine(line.key, { unit_price: e.target.value })
                        }
                        placeholder="0.00"
                        className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm font-mono text-right rounded focus:outline-none focus:border-primary focus:bg-background"
                      />
                    </td>
                    <td className="text-center px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={line.igv_applies}
                        onChange={(e) =>
                          updateLine(line.key, { igv_applies: e.target.checked })
                        }
                        className="h-3.5 w-3.5 rounded accent-primary"
                      />
                    </td>
                    <td className="text-right px-3 py-1.5 tabular-nums text-foreground">
                      {lineTotal(line).toLocaleString("es-PE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="text-center px-2">
                      <button
                        type="button"
                        onClick={() => removeLine(line.key)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Detracción + Totales */}
        <section className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-[11px] text-muted-foreground mb-3">Detracción</h3>
            <div
              className="rounded-lg bg-card p-4 space-y-3"
              style={{ border: "1px solid var(--border)" }}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={detraccionEnabled}
                  onChange={(e) => setDetraccionEnabled(e.target.checked)}
                  className="h-4 w-4 rounded accent-primary"
                />
                <span className="text-sm text-foreground/80">Aplicar detracción</span>
              </label>
              {detraccionEnabled && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Tasa (%)</label>
                    <input
                      type="text"
                      value={detraccionRate}
                      onChange={(e) => setDetraccionRate(e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-right focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Monto</label>
                    <input
                      type="text"
                      value={
                        detraccionAmount || totals.detraccion.toFixed(2)
                      }
                      onChange={(e) => setDetraccionAmount(e.target.value)}
                      className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-right focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground/60">
                El cliente retiene este monto y lo deposita en Banco de la Nación
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-[11px] text-muted-foreground mb-3">Totales</h3>
            <div
              className="rounded-lg bg-card p-4 space-y-2"
              style={{ border: "1px solid var(--border)" }}
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums text-foreground">
                  {currency === "USD" ? "$" : "S/"} {totals.subtotal.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">IGV (18%)</span>
                <span className="tabular-nums text-foreground">
                  {currency === "USD" ? "$" : "S/"} {totals.igv.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div
                className="flex items-center justify-between text-sm pt-2"
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <span className="font-medium text-foreground">Total factura</span>
                <span className="tabular-nums font-semibold text-foreground">
                  {currency === "USD" ? "$" : "S/"} {totals.total.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {detraccionEnabled && totals.detraccion > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span style={{ color: "#b45309" }}>− Detracción</span>
                    <span className="tabular-nums" style={{ color: "#b45309" }}>
                      {currency === "USD" ? "$" : "S/"} {totals.detraccion.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div
                    className="flex items-center justify-between text-sm pt-2"
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <span className="font-medium text-foreground">Neto a recibir</span>
                    <span
                      className="tabular-nums font-semibold"
                      style={{ color: "#047857" }}
                    >
                      {currency === "USD" ? "$" : "S/"} {totals.neto.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* SUNAT */}
        <section className="mb-10">
          <details>
            <summary className="cursor-pointer text-xs font-medium text-primary hover:opacity-80 inline-flex items-center gap-1">
              <ChevronDown className="h-3 w-3" />
              Datos SUNAT{" "}
              <span className="text-muted-foreground/60">
                (opcional al crear borrador)
              </span>
            </summary>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground">Serie</label>
                <input
                  type="text"
                  value={serie}
                  onChange={(e) => setSerie(e.target.value)}
                  placeholder="F001"
                  className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Número</label>
                <input
                  type="text"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="00052"
                  className="mt-0.5 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/60">
              Puedes dejar esto en blanco y editarlo después cuando tengas los
              datos reales de SUNAT
            </p>
          </details>
        </section>
    </div>
  );
}
