"use client";

import { useState, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { BankAccountPicker } from "@/components/widgets/bank-account-picker";
import { PartnerPicker } from "@/components/widgets/partner-picker";
import { createPayment } from "@/app/actions/payments";
import { PAYMENT_DIRECTION } from "@/lib/types";
import { roundMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BankAccountRow, ProjectRow, ContactRow } from "@/lib/types";

type LineDraft = {
  key: string;
  description: string;
  amount: string;
};

function newLineDraft(): LineDraft {
  return {
    key: crypto.randomUUID(),
    description: "",
    amount: "",
  };
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function NewPaymentDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [direction, setDirection] = useState<number>(PAYMENT_DIRECTION.outbound);
  const [bankAccount, setBankAccount] = useState<BankAccountRow | null>(null);
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [currency, setCurrency] = useState<"PEN" | "USD">("PEN");
  const [contactId, setContactId] = useState<string | null>(null);
  const [partner, setPartner] = useState<ContactRow | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLineDraft()]);

  function reset() {
    setDirection(PAYMENT_DIRECTION.outbound);
    setBankAccount(null);
    setPaymentDate(new Date().toISOString().split("T")[0]);
    setCurrency("PEN");
    setContactId(null);
    setPartner(null);
    setProject(null);
    setBankReference("");
    setTitle("");
    setLines([newLineDraft()]);
  }

  const total = useMemo(() => {
    let sum = 0;
    for (const line of lines) sum += parseNum(line.amount);
    return roundMoney(sum);
  }, [lines]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }
  function addLine() {
    setLines((prev) => [...prev, newLineDraft()]);
  }

  async function handleSave() {
    if (!partner) {
      toast.error("Selecciona el partner al que se atribuye el pago");
      return;
    }
    // Bank account is mandatory only when Korakuen is the partner; a
    // non-Korakuen partner paying out of pocket produces an off-book
    // payment (bank_account_id = null on the server).
    if (!bankAccount && partner.is_self) {
      toast.error(
        "Selecciona una cuenta bancaria (Korakuen no puede pagar sin cuenta)",
      );
      return;
    }
    const cleanLines = lines.filter((l) => parseNum(l.amount) > 0);
    if (cleanLines.length === 0) {
      toast.error("Agrega al menos una línea con monto");
      return;
    }

    setSaving(true);

    const result = await createPayment(
      {
        direction,
        bank_account_id: bankAccount?.id ?? null,
        project_id: project?.id ?? null,
        contact_id: contactId,
        paid_by_partner_id: partner.id,
        currency,
        payment_date: paymentDate,
        bank_reference: bankReference.trim() || null,
        title: title.trim() || null,
      },
      cleanLines.map((l, i) => {
        const amt = parseNum(l.amount);
        // amount_pen equals amount for PEN; for USD the server computes via exchange rate
        return {
          sort_order: i,
          amount: amt,
          amount_pen: currency === "PEN" ? amt : amt,
          description: l.description.trim() || null,
        };
      }),
    );

    setSaving(false);
    if (result.success) {
      toast.success("Pago registrado");
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-4xl max-h-[calc(100vh-3rem)] p-0 gap-0 flex flex-col"
        showCloseButton
      >
        <DialogTitle className="sr-only">Nuevo pago</DialogTitle>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Nuevo pago</h3>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* Cabecera */}
          <div className="rounded-lg p-4 bg-background" style={{ border: "1px solid var(--border)" }}>
            {/* Row 1: Dirección + Banco + Fecha + Moneda */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <label className="text-[11px] text-muted-foreground">Dirección</label>
                <div
                  className="mt-0.5 flex items-center rounded-lg overflow-hidden"
                  style={{ border: "1px solid var(--border)", background: "white" }}
                >
                  <button
                    type="button"
                    onClick={() => setDirection(PAYMENT_DIRECTION.inbound)}
                    className={cn(
                      "flex-1 px-2 py-2 text-xs transition-colors",
                      direction === PAYMENT_DIRECTION.inbound
                        ? "bg-primary/10 font-semibold text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                    style={{ borderRight: "1px solid var(--border)" }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <ArrowDownLeft className="h-3 w-3" />
                      Entrada
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection(PAYMENT_DIRECTION.outbound)}
                    className={cn(
                      "flex-1 px-2 py-2 text-xs transition-colors",
                      direction === PAYMENT_DIRECTION.outbound
                        ? "bg-primary/10 font-semibold text-accent-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpRight className="h-3 w-3" />
                      Salida
                    </span>
                  </button>
                </div>
              </div>
              <div className="col-span-4">
                <label className="text-[11px] text-muted-foreground">
                  Banco
                  {partner && !partner.is_self ? (
                    <span className="text-muted-foreground/60"> (opcional — off-book)</span>
                  ) : null}
                </label>
                <BankAccountPicker
                  value={bankAccount?.id ?? null}
                  onChange={(b) => {
                    setBankAccount(b);
                    if (b) setCurrency(b.currency as "PEN" | "USD");
                  }}
                  className="mt-0.5"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[11px] text-muted-foreground">Fecha</label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="mt-0.5"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Moneda</label>
                <Select value={currency} onValueChange={(v) => setCurrency(v as "PEN" | "USD")}>
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

            {/* Row 2: Contraparte + Proyecto + Código */}
            <div className="mt-3 grid grid-cols-12 gap-3">
              <div className="col-span-5">
                <label className="text-[11px] text-muted-foreground">
                  Contraparte <span className="text-muted-foreground/60">(opcional)</span>
                </label>
                <ContactPicker
                  value={contactId}
                  onChange={(id) => setContactId(id)}
                  filter="all"
                  placeholder="Buscar contacto…"
                  className="mt-0.5"
                />
              </div>
              <div className="col-span-4">
                <label className="text-[11px] text-muted-foreground">
                  Proyecto <span className="text-muted-foreground/60">(opcional)</span>
                </label>
                <ProjectPicker
                  value={project?.id ?? null}
                  onChange={setProject}
                  placeholder="Sin proyecto"
                  className="mt-0.5"
                />
              </div>
              <div className="col-span-3">
                <label className="text-[11px] text-muted-foreground">Código bancario</label>
                <Input
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value)}
                  placeholder="88102"
                  className="mt-0.5 font-mono"
                />
              </div>
            </div>

            {/* Row 3: Partner attribution (required — drives settlement math) */}
            <div className="mt-3 grid grid-cols-12 gap-3">
              <div className="col-span-6">
                <label className="text-[11px] text-muted-foreground">
                  Atribuido a{" "}
                  <span className="text-muted-foreground/60">
                    (partner que {direction === PAYMENT_DIRECTION.inbound ? "cobra" : "paga"})
                  </span>
                </label>
                <PartnerPicker
                  value={partner?.id ?? null}
                  onChange={setPartner}
                  className="mt-0.5"
                />
              </div>
            </div>

            {/* Row 3: Título */}
            <div className="mt-3">
              <label className="text-[11px] text-muted-foreground">
                Título <span className="text-muted-foreground/60">(texto del estado de cuenta)</span>
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Pago a Materiales El Bosque"
                className="mt-0.5"
              />
            </div>
          </div>

          {/* Líneas */}
          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                Líneas del pago
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
              <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col />
                  <col style={{ width: "140px" }} />
                  <col style={{ width: "40px" }} />
                </colgroup>
                <thead>
                  <tr className="bg-background">
                    <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Descripción
                    </th>
                    <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Monto
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.key} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-2 py-1.5 overflow-hidden">
                        <input
                          type="text"
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.key, { description: e.target.value })
                          }
                          placeholder="Descripción o nota"
                          className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm rounded focus:outline-none focus:border-primary focus:bg-background"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.amount}
                          onChange={(e) =>
                            updateLine(line.key, { amount: e.target.value })
                          }
                          placeholder="0.00"
                          className="w-full border border-transparent bg-transparent px-1.5 py-1 text-sm font-mono text-right rounded focus:outline-none focus:border-primary focus:bg-background"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
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
                <tfoot>
                  <tr
                    className="bg-background"
                    style={{ borderTop: "1px solid var(--border)" }}
                  >
                    <td className="px-3 py-2 text-[11px] font-medium text-muted-foreground">
                      Total
                    </td>
                    <td className="text-right px-3 py-2 tabular-nums font-semibold text-foreground">
                      {total.toLocaleString("es-PE", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/60">
              Las líneas pueden vincularse a una factura desde el detalle del pago después de guardar.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              reset();
            }}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
