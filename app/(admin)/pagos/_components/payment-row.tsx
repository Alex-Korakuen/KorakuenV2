"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { formatPEN, formatDate } from "@/lib/format";
import { PAYMENT_DIRECTION, PAYMENT_LINE_TYPE } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BankAccountRow, ContactRow, PaymentLineRow } from "@/lib/types";
import type { PaymentWithLinesAndComputed } from "@/app/actions/payments";
import { PaymentDetailDialog } from "./payment-detail-dialog";

type Props = {
  payment: PaymentWithLinesAndComputed;
  banksById: Map<string, BankAccountRow>;
  contactsById: Map<string, ContactRow>;
};

function deriveShortLabel(razonSocial: string): string {
  const cleaned = razonSocial
    .replace(/\b(S\.?A\.?C?\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?)\b/gi, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  }
  return (words[0] ?? razonSocial).slice(0, 3).toUpperCase();
}

function unlinkedAmountPen(lines: PaymentLineRow[]): number {
  let total = 0;
  for (const line of lines) {
    if (
      line.line_type === PAYMENT_LINE_TYPE.general &&
      line.outgoing_invoice_id == null &&
      line.incoming_invoice_id == null &&
      line.loan_id == null
    ) {
      total += Math.abs(Number(line.amount_pen));
    }
  }
  return Math.round(total * 100) / 100;
}

export function PaymentRow({ payment, banksById, contactsById }: Props) {
  const [open, setOpen] = useState(false);

  const bank = payment.bank_account_id
    ? banksById.get(payment.bank_account_id)
    : undefined;
  const partnerContact = payment.paid_by_partner_id
    ? contactsById.get(payment.paid_by_partner_id)
    : undefined;
  const socioLabel = partnerContact
    ? deriveShortLabel(partnerContact.razon_social)
    : "—";
  const isInbound = payment.direction === PAYMENT_DIRECTION.inbound;
  const sign = isInbound ? "+" : "−";
  const amountColor = isInbound ? "text-emerald-700" : "text-amber-700";
  const unlinked = unlinkedAmountPen(payment.lines);
  const contraparte = payment.contact_id
    ? contactsById.get(payment.contact_id)
    : undefined;
  const lineCount = payment.lines.length;
  const hasMultipleLines = lineCount > 1;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-accent/30"
        style={{ borderTop: "1px solid var(--border)" }}
        onClick={() => setOpen(true)}
      >
        <td className="px-3 py-3 text-xs text-muted-foreground">
          {formatDate(payment.payment_date)}
        </td>
        <td className="px-3 py-3">
          <span
            className="inline-flex h-5 items-center rounded-full bg-card px-2 text-[11px] font-medium text-foreground"
            style={{ border: "1px solid var(--border)" }}
          >
            {socioLabel}
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm truncate text-foreground">
              {payment.title ?? "—"}
            </p>
            {hasMultipleLines && (
              <span className="inline-flex items-center gap-0.5 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {lineCount} líneas
                <span className="opacity-60">▸</span>
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
          {payment.bank_reference ?? "—"}
        </td>
        <td className="px-3 py-3">
          {bank ? (
            <>
              <p className="text-sm truncate text-foreground">{bank.name}</p>
              {bank.account_number && (
                <p className="text-[11px] text-muted-foreground">
                  ···· {bank.account_number.slice(-4)}
                </p>
              )}
            </>
          ) : payment.bank_account_id == null ? (
            <p className="text-sm italic text-muted-foreground">
              Off-book
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </td>
        <td
          className={cn(
            "text-right px-3 py-3 tabular-nums font-medium whitespace-nowrap",
            amountColor,
          )}
        >
          {sign} {formatPEN(Number(payment.total_amount_pen))}
        </td>
        <td
          className={cn(
            "text-right px-3 py-3 tabular-nums whitespace-nowrap",
            unlinked > 0
              ? "font-medium text-amber-700"
              : "text-xs text-muted-foreground/40",
          )}
        >
          {unlinked > 0 ? formatPEN(unlinked) : "—"}
        </td>
        <td className="text-center px-3 py-3">
          {payment.reconciled ? (
            <Check className="inline h-4 w-4 text-emerald-700" />
          ) : (
            <X className="inline h-4 w-4 text-muted-foreground/40" />
          )}
        </td>
      </tr>
      <PaymentDetailDialog
        open={open}
        onOpenChange={setOpen}
        payment={payment}
        bank={bank}
        contraparte={contraparte}
        partnerContact={partnerContact}
      />
    </>
  );
}
