"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { unreconcilePayment } from "@/app/actions/payments";
import { PAYMENT_DIRECTION } from "@/lib/types";
import { formatPEN, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { BankAccountRow, ContactRow } from "@/lib/types";
import type { PaymentWithLinesAndComputed } from "@/app/actions/payments";
import { PaymentDetailDialog } from "@/app/(admin)/pagos/_components/payment-detail-dialog";

type Props = {
  payment: PaymentWithLinesAndComputed;
  bank: BankAccountRow | undefined;
  contraparte: ContactRow | undefined;
  partnerContact: ContactRow | undefined;
};

export function UnreconcileRow({
  payment,
  bank,
  contraparte,
  partnerContact,
}: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const isInbound = payment.direction === PAYMENT_DIRECTION.inbound;
  const sign = isInbound ? "+" : "−";
  const amountColor = isInbound ? "text-emerald-700" : "text-amber-700";
  const pillClass = isInbound
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";
  const Arrow = isInbound ? ArrowDownLeft : ArrowUpRight;

  function handleUnreconcile() {
    startTransition(async () => {
      const result = await unreconcilePayment(payment.id);
      if (result.success) {
        toast.success("Desconciliado");
        setConfirm(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleRowClick(e: MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    setDetailOpen(true);
  }

  return (
    <>
      <tr
        onClick={handleRowClick}
        className={cn(
          "cursor-pointer hover:bg-accent/20",
          pending && "opacity-50",
        )}
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <td className="px-3 py-3 text-xs text-muted-foreground">
          {formatDate(payment.payment_date)}
        </td>
        <td className="px-3 py-3">
          <span
            className={cn(
              "inline-flex h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-medium",
              pillClass,
            )}
          >
            <Arrow className="h-2.5 w-2.5" />
          </span>
        </td>
        <td className="px-3 py-3 overflow-hidden">
          <p className="truncate text-sm text-foreground">
            {payment.notes ?? "—"}
          </p>
        </td>
        <td className="px-3 py-3 overflow-hidden">
          <p className="truncate text-xs text-muted-foreground">
            {contraparte?.razon_social ?? "—"}
          </p>
        </td>
        <td
          className={cn(
            "text-right px-3 py-3 tabular-nums font-medium whitespace-nowrap",
            amountColor,
          )}
        >
          {sign} {formatPEN(Number(payment.total_amount_pen))}
        </td>
        <td className="px-3 py-3 font-mono text-xs text-muted-foreground truncate">
          {payment.bank_reference ?? "—"}
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-stone-100 hover:text-foreground"
            title="Desconciliar"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconciliar este pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Volverá a la cola de pagos sin conciliar. Los cambios que hagas
              sobre el pago volverán a ser posibles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnreconcile}
              disabled={pending}
            >
              Desconciliar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PaymentDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        payment={payment}
        bank={bank}
        contraparte={contraparte}
        partnerContact={partnerContact}
      />
    </>
  );
}
