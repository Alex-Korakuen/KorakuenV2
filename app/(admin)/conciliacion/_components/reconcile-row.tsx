"use client";

import { useState, useTransition, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";
import { reconcilePayment } from "@/app/actions/payments";
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
  rowIndex: number;
};

export function ReconcileRow({
  payment,
  bank,
  contraparte,
  partnerContact,
  rowIndex,
}: Props) {
  const router = useRouter();
  const [code, setCode] = useState(payment.bank_reference ?? "");
  const [pending, startTransition] = useTransition();
  const [detailOpen, setDetailOpen] = useState(false);

  const isInbound = payment.direction === PAYMENT_DIRECTION.inbound;
  const sign = isInbound ? "+" : "−";
  const amountColor = isInbound ? "text-emerald-700" : "text-amber-700";
  const pillClass = isInbound
    ? "bg-emerald-50 text-emerald-700"
    : "bg-amber-50 text-amber-700";
  const Arrow = isInbound ? ArrowDownLeft : ArrowUpRight;

  const trimmed = code.trim();
  const canConfirm = trimmed.length > 0 && !pending;

  function handleConfirm() {
    if (!canConfirm) return;
    startTransition(async () => {
      const result = await reconcilePayment(payment.id, trimmed);
      if (result.success) {
        toast.success("Conciliado");
        // Focus next row's input
        const nextInput = document.querySelector<HTMLInputElement>(
          `input[data-reconcile-row="${rowIndex + 1}"]`,
        );
        nextInput?.focus();
        nextInput?.select();
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
  }

  function handleRowClick(e: MouseEvent<HTMLTableRowElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("input, button")) return;
    setDetailOpen(true);
  }

  return (
    <>
      <tr
        onClick={handleRowClick}
        className={cn(
          "cursor-pointer transition-colors",
          "hover:bg-accent/20",
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
            {payment.title ?? "—"}
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
        <td className="px-2 py-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            data-reconcile-row={rowIndex}
            placeholder="—"
            disabled={pending}
            className="w-full rounded bg-card px-2 py-1 text-sm font-mono focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            style={{ border: "1px solid var(--border)" }}
          />
        </td>
        <td className="px-2 py-2 text-center">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded transition-colors",
              canConfirm
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                : "text-muted-foreground/30",
            )}
            title="Conciliar"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
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
