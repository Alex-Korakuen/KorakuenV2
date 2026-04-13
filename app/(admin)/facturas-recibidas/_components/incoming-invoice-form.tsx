"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactPicker } from "@/components/widgets/contact-picker";
import { ProjectPicker } from "@/components/widgets/project-picker";
import {
  createIncomingInvoice,
  updateIncomingInvoice,
  setIncomingInvoiceLineItems,
  markIncomingInvoiceAsReceived,
} from "@/app/actions/incoming-invoices";
import { getCostCategories } from "@/app/actions/project-budgets";
import { INCOMING_INVOICE_FACTURA_STATUS } from "@/lib/types";
import { roundMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  IncomingInvoiceRow,
  IncomingInvoiceLineItemRow,
  ProjectRow,
  CostCategoryRow,
} from "@/lib/types";

type LineItemDraft = {
  key: string;
  description: string;
  cost_category_id: string | null;
  quantity: string;
  unit_price: string;
  igv_applies: boolean;
};

type Props = {
  invoice?: IncomingInvoiceRow;
  existingLineItems?: IncomingInvoiceLineItemRow[];
  initialProject?: ProjectRow;
  initialVendorId?: string | null;
  onAfterSave?: () => void;
  variant?: "page" | "dialog";
};

const IGV_RATE = 0.18;

function newLineDraft(): LineItemDraft {
  return {
    key: crypto.randomUUID(),
    description: "",
    cost_category_id: null,
    quantity: "",
    unit_price: "",
    igv_applies: true,
  };
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function IncomingInvoiceForm({
  invoice,
  existingLineItems,
  initialProject,
  initialVendorId,
  onAfterSave,
  variant = "page",
}: Props) {
  const router = useRouter();
  const isEdit = !!invoice;

  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(
    initialProject ?? null,
  );
  const [vendorId, setVendorId] = useState<string | null>(
    invoice?.contact_id ?? initialVendorId ?? null,
  );
  const [facturaStatus, setFacturaStatus] = useState<number>(
    invoice?.factura_status ?? INCOMING_INVOICE_FACTURA_STATUS.expected,
  );
  const [fechaEmision, setFechaEmision] = useState(
    invoice?.fecha_emision ?? new Date().toISOString().split("T")[0],
  );
  const [currency, setCurrency] = useState<"PEN" | "USD">(
    (invoice?.currency as "PEN" | "USD") ?? "PEN",
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");

  // SUNAT
  const [serie, setSerie] = useState(
    invoice?.serie_numero?.split("-")[0] ?? "",
  );
  const [numero, setNumero] = useState(
    invoice?.serie_numero?.split("-")[1] ?? "",
  );
  const [rucEmisor, setRucEmisor] = useState(invoice?.ruc_emisor ?? "");
  const [tipoDocumento, setTipoDocumento] = useState(
    invoice?.tipo_documento_code ?? "01",
  );

  // Cost categories (loaded once for line item dropdowns)
  const [categories, setCategories] = useState<CostCategoryRow[]>([]);
  useEffect(() => {
    void getCostCategories().then((r) => {
      if (r.success) setCategories(r.data);
    });
  }, []);

  const [lines, setLines] = useState<LineItemDraft[]>(() => {
    if (existingLineItems && existingLineItems.length > 0) {
      return existingLineItems.map((li) => ({
        key: li.id,
        description: li.description,
        cost_category_id: li.cost_category_id,
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
    invoice?.detraction_rate != null ? String(invoice.detraction_rate) : "12",
  );
  const [detraccionAmount, setDetraccionAmount] = useState(
    invoice?.detraction_amount != null
      ? String(invoice.detraction_amount)
      : "",
  );

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
    const detraccion = detraccionEnabled
      ? detraccionAmount
        ? parseNum(detraccionAmount)
        : roundMoney((total * parseNum(detraccionRate)) / 100)
      : 0;
    const neto = roundMoney(total - detraccion);
    return { subtotal, igv, total, detraccion, neto };
  }, [lines, detraccionEnabled, detraccionRate, detraccionAmount]);

  function updateLine(key: string, patch: Partial<LineItemDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
          unit: null,
          quantity: qty,
          unit_price: price,
          subtotal: sub,
          igv_applies: l.igv_applies,
          igv_amount: igvAmount,
          total: roundMoney(sub + igvAmount),
          cost_category_id: l.cost_category_id,
        };
      });
  }

  async function handleSave() {
    if (!vendorId) {
      toast.error("Selecciona un proveedor");
      return;
    }
    const cleanLines = buildLineItemsInput();
    if (cleanLines.length === 0) {
      toast.error("Agrega al menos una línea");
      return;
    }

    const isReceived = facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.received;
    if (isReceived && (!serie.trim() || !numero.trim() || !rucEmisor.trim())) {
      toast.error("Serie, número y RUC emisor son requeridos para una factura recibida");
      return;
    }

    setSaving(true);

    const serieNumero =
      serie.trim() && numero.trim() ? `${serie.trim()}-${numero.trim()}` : null;

    if (!isEdit) {
      const result = await createIncomingInvoice({
        contact_id: vendorId,
        project_id: project?.id ?? null,
        factura_status: facturaStatus,
        currency,
        subtotal: totals.subtotal,
        igv_amount: totals.igv,
        total: totals.total,
        detraction_rate: detraccionEnabled ? parseNum(detraccionRate) : null,
        detraction_amount: detraccionEnabled ? totals.detraccion : null,
        serie_numero: serieNumero,
        fecha_emision: fechaEmision || null,
        tipo_documento_code: isReceived ? tipoDocumento : null,
        ruc_emisor: rucEmisor.trim() || null,
        notes: notes.trim() || null,
        line_items: cleanLines,
      });

      setSaving(false);
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      toast.success("Factura guardada");
      if (onAfterSave) {
        onAfterSave();
        router.refresh();
      } else {
        router.push(`/facturas-recibidas/${result.data.id}`);
      }
      return;
    }

    // Edit flow
    const headerResult = await updateIncomingInvoice(invoice.id, {
      project_id: project?.id ?? null,
      currency,
      detraction_rate: detraccionEnabled ? parseNum(detraccionRate) : null,
      detraction_amount: detraccionEnabled ? totals.detraccion : null,
      serie_numero: serieNumero,
      fecha_emision: fechaEmision || null,
      tipo_documento_code: isReceived ? tipoDocumento : null,
      ruc_emisor: rucEmisor.trim() || null,
      notes: notes.trim() || null,
    });
    if (!headerResult.success) {
      setSaving(false);
      toast.error(headerResult.error.message);
      return;
    }

    const linesResult = await setIncomingInvoiceLineItems(invoice.id, cleanLines);
    if (!linesResult.success) {
      setSaving(false);
      toast.error(linesResult.error.message);
      return;
    }

    // Trigger expected → received transition if user changed status
    if (isReceived && invoice.factura_status !== INCOMING_INVOICE_FACTURA_STATUS.received) {
      const markResult = await markIncomingInvoiceAsReceived(invoice.id, {
        serie_numero: serieNumero,
        fecha_emision: fechaEmision || null,
        tipo_documento_code: tipoDocumento,
        ruc_emisor: rucEmisor.trim() || null,
      });
      if (!markResult.success) {
        setSaving(false);
        toast.error(markResult.error.message);
        return;
      }
    }

    setSaving(false);
    toast.success("Cambios guardados");
    if (onAfterSave) onAfterSave();
    router.refresh();
  }

  const wrapperClass = variant === "page" ? "max-w-4xl px-8 py-8" : "";

  return (
    <div className={wrapperClass}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold text-foreground">
          {isEdit ? "Editar factura recibida" : "Nueva factura recibida"}
        </h2>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      {/* Cabecera card */}
      <section className="mb-6">
        <div
          className="rounded-lg bg-background p-4"
          style={{ border: "1px solid var(--border)" }}
        >
          {/* Row 1: Proveedor + Proyecto */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-muted-foreground">Proveedor</label>
              <ContactPicker
                value={vendorId}
                onChange={(id) => setVendorId(id)}
                filter="vendor"
                placeholder="Buscar proveedor…"
                className="mt-0.5"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">
                Proyecto <span className="text-muted-foreground/60">(opcional)</span>
              </label>
              <ProjectPicker
                value={project?.id ?? null}
                onChange={setProject}
                placeholder="Sin proyecto (gastos generales)"
                className="mt-0.5"
              />
            </div>
          </div>

          {/* Row 2: Estado + Fecha + Moneda */}
          <div className="mt-3 grid grid-cols-12 gap-3">
            <div className="col-span-5">
              <label className="text-[11px] text-muted-foreground">Estado</label>
              <div
                className="mt-0.5 flex items-center rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--border)", background: "white" }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setFacturaStatus(INCOMING_INVOICE_FACTURA_STATUS.expected)
                  }
                  className={cn(
                    "flex-1 px-3 py-2 text-xs transition-colors",
                    facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.expected
                      ? "bg-primary/10 font-semibold text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                  style={{ borderRight: "1px solid var(--border)" }}
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    <Clock className="h-3 w-3" />
                    Esperada
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setFacturaStatus(INCOMING_INVOICE_FACTURA_STATUS.received)
                  }
                  className={cn(
                    "flex-1 px-3 py-2 text-xs transition-colors",
                    facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.received
                      ? "bg-primary/10 font-semibold text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    <Check className="h-3 w-3" />
                    Recibida
                  </span>
                </button>
              </div>
            </div>
            <div className="col-span-4">
              <label className="text-[11px] text-muted-foreground">Fecha emisión</label>
              <Input
                type="date"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="mt-0.5"
              />
            </div>
            <div className="col-span-3">
              <label className="text-[11px] text-muted-foreground">Moneda</label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as "PEN" | "USD")}
              >
                <SelectTrigger className="mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEN">PEN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 3: SUNAT (only when Recibida) */}
          {facturaStatus === INCOMING_INVOICE_FACTURA_STATUS.received && (
            <div
              className="mt-3 pt-3 grid grid-cols-12 gap-3"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Serie</label>
                <Input
                  value={serie}
                  onChange={(e) => setSerie(e.target.value)}
                  placeholder="F003"
                  className="mt-0.5 font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Número</label>
                <Input
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="00128"
                  className="mt-0.5 font-mono"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[11px] text-muted-foreground">RUC emisor</label>
                <Input
                  value={rucEmisor}
                  onChange={(e) => setRucEmisor(e.target.value)}
                  placeholder="20423156789"
                  className="mt-0.5 font-mono"
                />
              </div>
              <div className="col-span-5">
                <label className="text-[11px] text-muted-foreground">Tipo documento</label>
                <Select value={tipoDocumento} onValueChange={setTipoDocumento}>
                  <SelectTrigger className="mt-0.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="01">01 Factura</SelectItem>
                    <SelectItem value="03">03 Boleta</SelectItem>
                    <SelectItem value="02">02 Recibo por honorarios</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Líneas */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] text-muted-foreground">Líneas de la factura</h3>
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
                  style={{ width: "35%" }}
                >
                  Descripción
                </th>
                <th
                  className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  style={{ width: "20%" }}
                >
                  Partida
                </th>
                <th
                  className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  style={{ width: "8%" }}
                >
                  Cant
                </th>
                <th
                  className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  style={{ width: "12%" }}
                >
                  P. Unit.
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
                    <select
                      value={line.cost_category_id ?? ""}
                      onChange={(e) =>
                        updateLine(line.key, {
                          cost_category_id: e.target.value || null,
                        })
                      }
                      className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm rounded focus:outline-none focus:border-primary focus:bg-background"
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
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
      <section className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-[11px] text-muted-foreground mb-2">Detracción</h3>
          <div
            className="rounded-lg bg-card p-3 space-y-2"
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
                  <Input
                    value={detraccionRate}
                    onChange={(e) => setDetraccionRate(e.target.value)}
                    className="mt-0.5 font-mono text-right"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Monto</label>
                  <Input
                    value={detraccionAmount || totals.detraccion.toFixed(2)}
                    onChange={(e) => setDetraccionAmount(e.target.value)}
                    className="mt-0.5 font-mono text-right"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-[11px] text-muted-foreground mb-2">Totales</h3>
          <div
            className="rounded-lg bg-card p-3 space-y-1.5"
            style={{ border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums text-foreground">
                {currency === "USD" ? "$" : "S/"}{" "}
                {totals.subtotal.toLocaleString("es-PE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">IGV (18%)</span>
              <span className="tabular-nums text-foreground">
                {currency === "USD" ? "$" : "S/"}{" "}
                {totals.igv.toLocaleString("es-PE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            <div
              className="flex items-center justify-between text-sm pt-2"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <span className="font-medium text-foreground">Total factura</span>
              <span className="tabular-nums font-semibold text-foreground">
                {currency === "USD" ? "$" : "S/"}{" "}
                {totals.total.toLocaleString("es-PE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
            {detraccionEnabled && totals.detraccion > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: "#b45309" }}>− Detracción</span>
                  <span className="tabular-nums" style={{ color: "#b45309" }}>
                    {currency === "USD" ? "$" : "S/"}{" "}
                    {totals.detraccion.toLocaleString("es-PE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between text-sm pt-2"
                  style={{ borderTop: "1px solid var(--border)" }}
                >
                  <span className="font-medium text-foreground">Neto a pagar</span>
                  <span
                    className="tabular-nums font-semibold"
                    style={{ color: "#b45309" }}
                  >
                    {currency === "USD" ? "$" : "S/"}{" "}
                    {totals.neto.toLocaleString("es-PE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
