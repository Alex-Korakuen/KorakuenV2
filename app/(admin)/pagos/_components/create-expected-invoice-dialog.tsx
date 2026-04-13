"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactPicker } from "@/components/widgets/contact-picker";
import { ProjectPicker } from "@/components/widgets/project-picker";
import { createExpectedInvoiceFromPaymentLine } from "@/app/actions/payments";
import { roundMoney } from "@/lib/format";
import type { ProjectRow } from "@/lib/types";
import type { PaymentWithLinesAndComputed } from "@/app/actions/payments";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lineId: string;
  payment: PaymentWithLinesAndComputed;
  defaultContactId: string | null;
};

function parseNum(s: string): number {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function CreateExpectedInvoiceDialog({
  open,
  onOpenChange,
  lineId,
  payment,
  defaultContactId,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const line = useMemo(
    () => payment.lines.find((l) => l.id === lineId),
    [payment.lines, lineId],
  );

  const [contactId, setContactId] = useState<string | null>(defaultContactId);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [subtotal, setSubtotal] = useState(() =>
    line ? String(roundMoney(Number(line.amount) / 1.18)) : "",
  );
  const [igv, setIgv] = useState(() =>
    line
      ? String(roundMoney(Number(line.amount) - Number(line.amount) / 1.18))
      : "",
  );
  const [total, setTotal] = useState(() =>
    line ? String(Number(line.amount).toFixed(2)) : "",
  );
  const [notes, setNotes] = useState("");

  function handleSave() {
    if (!contactId) {
      toast.error("Selecciona un proveedor");
      return;
    }
    startTransition(async () => {
      const result = await createExpectedInvoiceFromPaymentLine(lineId, {
        project_id: project?.id ?? null,
        contact_id: contactId,
        currency: payment.currency,
        subtotal: parseNum(subtotal),
        igv_amount: parseNum(igv),
        total: parseNum(total),
        notes: notes.trim() || null,
      });
      if (result.success) {
        toast.success("Factura esperada creada y vinculada");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="text-base">
            Crear factura esperada
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5 space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground">
              Proveedor
            </label>
            <ContactPicker
              value={contactId}
              onChange={setContactId}
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
              placeholder="Sin proyecto"
              className="mt-0.5"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-muted-foreground">
                Subtotal
              </label>
              <Input
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                className="mt-0.5 font-mono text-right"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">IGV</label>
              <Input
                value={igv}
                onChange={(e) => setIgv(e.target.value)}
                className="mt-0.5 font-mono text-right"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Total</label>
              <Input
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="mt-0.5 font-mono text-right"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Notas</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descripción del gasto"
              className="mt-0.5"
            />
          </div>
        </div>
        <DialogFooter className="border-t border-border px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={pending}>
            {pending ? "Creando…" : "Crear y vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
