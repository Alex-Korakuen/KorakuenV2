"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPEN, formatDate } from "@/lib/format";
import { PAYMENT_DIRECTION } from "@/lib/types";
import { cn } from "@/lib/utils";
import { linkPaymentLineToInvoice } from "@/app/actions/payments";
import { getOutgoingInvoices } from "@/app/actions/outgoing-invoices";
import { getIncomingInvoices } from "@/app/actions/incoming-invoices";
import type { OutgoingInvoiceWithComputed } from "@/app/actions/outgoing-invoices";
import type { IncomingInvoiceWithComputed } from "@/app/actions/incoming-invoices";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lineId: string;
  direction: number;
  currency: string;
  contactId: string | null;
};

type OptionRow = {
  id: string;
  label: string;
  date: string;
  outstanding: number;
  total: number;
  currency: string;
};

export function LinkInvoiceDialog({
  open,
  onOpenChange,
  lineId,
  direction,
  currency,
  contactId,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [search, setSearch] = useState("");

  const invoiceType: "outgoing" | "incoming" =
    direction === PAYMENT_DIRECTION.inbound ? "outgoing" : "incoming";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      if (invoiceType === "outgoing") {
        const result = await getOutgoingInvoices({ currency, limit: 100 });
        if (cancelled) return;
        if (result.success) {
          const rows: OptionRow[] = (result.data.data as OutgoingInvoiceWithComputed[])
            .filter((i) => !i._computed.is_fully_paid)
            .map((i) => ({
              id: i.id,
              label: i.serie_numero ?? "—",
              date: i.issue_date,
              outstanding: i._computed.outstanding,
              total: Number(i.total),
              currency: i.currency,
            }));
          setOptions(rows);
        }
      } else {
        const result = await getIncomingInvoices({
          currency,
          contact_id: contactId ?? undefined,
          limit: 100,
        });
        if (cancelled) return;
        if (result.success) {
          const rows: OptionRow[] = (result.data.data as IncomingInvoiceWithComputed[])
            .filter((i) => !i._computed.is_fully_paid)
            .map((i) => ({
              id: i.id,
              label: i.serie_numero ?? "Esperada",
              date: i.fecha_emision ?? i.created_at,
              outstanding: i._computed.outstanding,
              total: Number(i.total),
              currency: i.currency,
            }));
          setOptions(rows);
        }
      }
      if (!cancelled) setLoading(false);
    }

    if (open) load();
    return () => {
      cancelled = true;
    };
  }, [open, invoiceType, currency, contactId]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  function handlePick(invoiceId: string) {
    startTransition(async () => {
      const result = await linkPaymentLineToInvoice(
        lineId,
        invoiceId,
        invoiceType,
      );
      if (result.success) {
        toast.success("Línea vinculada");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 flex flex-col max-h-[calc(100vh-6rem)]">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="text-base">
            Vincular a {invoiceType === "outgoing" ? "factura emitida" : "factura recibida"}
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 py-3 border-b border-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por serie-número…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Cargando…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No hay facturas con saldo pendiente para vincular.
            </p>
          ) : (
            <ul>
              {filtered.map((opt) => (
                <li
                  key={opt.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handlePick(opt.id)}
                    className={cn(
                      "w-full flex items-center gap-4 px-6 py-3 text-left hover:bg-accent/40 transition-colors",
                      pending && "opacity-50",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {opt.label}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDate(opt.date)} · Total {opt.currency}{" "}
                        {opt.total.toLocaleString("es-PE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="text-[10px] uppercase text-muted-foreground/60">
                        Pendiente
                      </p>
                      <p className="text-sm font-medium text-amber-700">
                        {formatPEN(opt.outstanding)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
