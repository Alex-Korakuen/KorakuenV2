"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Link2,
  Link2Off,
  Trash2,
  FileClock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { formatPEN, formatDate } from "@/lib/format";
import { PAYMENT_DIRECTION } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  deletePayment,
  reconcilePayment,
  unreconcilePayment,
  unlinkPaymentLineFromInvoice,
} from "@/app/actions/payments";
import type {
  BankAccountRow,
  ContactRow,
} from "@/lib/types";
import type { PaymentWithLinesAndComputed } from "@/app/actions/payments";
import { lineIsUnlinked } from "@/lib/payment-lines";
import { toast } from "sonner";
import { LinkInvoiceDialog } from "./link-invoice-dialog";
import { CreateExpectedInvoiceDialog } from "./create-expected-invoice-dialog";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payment: PaymentWithLinesAndComputed;
  bank: BankAccountRow | undefined;
  contraparte: ContactRow | undefined;
  partnerContact: ContactRow | undefined;
};

export function PaymentDetailDialog({
  open,
  onOpenChange,
  payment,
  bank,
  contraparte,
  partnerContact,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkingLineId, setLinkingLineId] = useState<string | null>(null);
  const [expectingLineId, setExpectingLineId] = useState<string | null>(null);

  const isInbound = payment.direction === PAYMENT_DIRECTION.inbound;
  const sign = isInbound ? "+" : "−";
  const amountColor = isInbound ? "text-emerald-700" : "text-amber-700";

  const sortedLines = [...payment.lines].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const linesTotalPen = sortedLines.reduce(
    (acc, l) => acc + Number(l.amount_pen),
    0,
  );
  const roundedLinesTotal = Math.round(linesTotalPen * 100) / 100;
  const matches =
    Math.abs(roundedLinesTotal - Number(payment.total_amount_pen)) < 0.01;

  const unlinkedPen = sortedLines.reduce(
    (acc, l) => (lineIsUnlinked(l) ? acc + Math.abs(Number(l.amount_pen)) : acc),
    0,
  );
  const roundedUnlinked = Math.round(unlinkedPen * 100) / 100;

  function handleReconcileToggle() {
    startTransition(async () => {
      const result = payment.reconciled
        ? await unreconcilePayment(payment.id)
        : await reconcilePayment(payment.id, payment.bank_reference ?? "");
      if (result.success) {
        toast.success(payment.reconciled ? "Desconciliado" : "Conciliado");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deletePayment(payment.id);
      if (result.success) {
        toast.success("Pago eliminado");
        setConfirmDelete(false);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  function handleUnlink(lineId: string) {
    startTransition(async () => {
      const result = await unlinkPaymentLineFromInvoice(lineId);
      if (result.success) {
        toast.success("Línea desvinculada");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-4xl max-h-[calc(100vh-3rem)] p-0 gap-0 flex flex-col"
          showCloseButton
        >
          <DialogTitle className="sr-only">
            {payment.title ?? "Detalle de pago"}
          </DialogTitle>

          {/* Header */}
          <div className="flex items-start gap-3 px-6 py-4 border-b border-border">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground truncate">
                {payment.title ?? "Pago sin título"}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  {isInbound ? (
                    <ArrowDownLeft className="h-3 w-3 text-emerald-700" />
                  ) : (
                    <ArrowUpRight className="h-3 w-3 text-amber-700" />
                  )}
                  {isInbound ? "Entrada" : "Salida"}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>{formatDate(payment.payment_date)}</span>
                {partnerContact && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{partnerContact.razon_social}</span>
                  </>
                )}
                {contraparte && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="truncate">{contraparte.razon_social}</span>
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleReconcileToggle}
              disabled={pending}
              className={cn(
                "shrink-0 inline-flex h-7 items-center rounded-full px-3 text-[11px] font-medium transition-colors",
                payment.reconciled
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "bg-stone-100 text-muted-foreground hover:bg-stone-200",
              )}
            >
              {payment.reconciled ? (
                <>
                  <Check className="mr-1 h-3 w-3" />
                  Conciliado
                </>
              ) : (
                "Sin conciliar"
              )}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-stone-100"
              title="Eliminar pago"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Stats strip — mirrors the list row meta */}
            <div
              className="grid grid-cols-4 gap-0 px-6 py-4 bg-background/50"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <Stat
                label="Código"
                value={
                  <span className="font-mono text-[12px]">
                    {payment.bank_reference ?? "—"}
                  </span>
                }
              />
              <Stat
                label="Banco"
                value={
                  bank ? (
                    <>
                      {bank.name}
                      {bank.account_number && (
                        <span className="text-muted-foreground">
                          {" "}···· {bank.account_number.slice(-4)}
                        </span>
                      )}
                    </>
                  ) : payment.bank_account_id == null ? (
                    <span className="italic text-muted-foreground">Off-book</span>
                  ) : (
                    "—"
                  )
                }
              />
              <Stat
                label="Total"
                value={
                  <span className={cn("tabular-nums", amountColor)}>
                    {sign}{" "}
                    {payment.currency !== "PEN" && `${payment.currency} `}
                    {Number(payment.total_amount).toLocaleString("es-PE", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                }
              />
              <Stat
                label="Sin vincular"
                value={
                  roundedUnlinked > 0 ? (
                    <span className="tabular-nums text-amber-700">
                      {formatPEN(roundedUnlinked)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )
                }
              />
            </div>

            {/* Lines */}
            <div className="px-6 py-5">
              <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Líneas · {sortedLines.length}
              </h4>
              <div
                className="rounded-lg bg-card overflow-hidden"
                style={{ border: "1px solid var(--border)" }}
              >
                <table
                  className="w-full text-sm"
                  style={{ tableLayout: "fixed" }}
                >
                  <colgroup>
                    <col style={{ width: "32px" }} />
                    <col />
                    <col style={{ width: "120px" }} />
                    <col style={{ width: "54px" }} />
                    <col style={{ width: "76px" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-background">
                      <th className="text-right px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        #
                      </th>
                      <th className="text-left px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Descripción
                      </th>
                      <th className="text-right px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Monto
                      </th>
                      <th className="text-center px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Vinc.
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLines.map((line, idx) => {
                      const unlinked = lineIsUnlinked(line);
                      const isLinkedInvoice =
                        line.outgoing_invoice_id != null ||
                        line.incoming_invoice_id != null;
                      const isLinkedLoan = line.loan_id != null;
                      const hasAnyLink = isLinkedInvoice || isLinkedLoan;
                      return (
                        <tr
                          key={line.id}
                          style={{ borderTop: "1px solid var(--border)" }}
                          className={unlinked ? "bg-amber-50/40" : ""}
                        >
                          <td className="px-2 py-2 text-right tabular-nums text-[11px] text-muted-foreground/60">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 overflow-hidden">
                            <p className="truncate text-sm text-foreground">
                              {line.description ?? "—"}
                            </p>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-mono text-sm whitespace-nowrap">
                            {Number(line.amount).toLocaleString("es-PE", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {hasAnyLink ? (
                              <Check className="inline h-3.5 w-3.5 text-emerald-600" />
                            ) : unlinked ? (
                              <span className="text-[11px] text-amber-700">✗</span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/40">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {unlinked ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setLinkingLineId(line.id)}
                                    disabled={pending}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-sky-700 hover:bg-sky-50"
                                    style={{ border: "1px solid var(--border)" }}
                                    title="Vincular a factura"
                                  >
                                    <Link2 className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setExpectingLineId(line.id)}
                                    disabled={pending}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-amber-700 hover:bg-amber-50"
                                    style={{ border: "1px solid var(--border)" }}
                                    title="Crear factura esperada"
                                  >
                                    <FileClock className="h-3 w-3" />
                                  </button>
                                </>
                              ) : isLinkedInvoice ? (
                                <button
                                  type="button"
                                  onClick={() => handleUnlink(line.id)}
                                  disabled={pending}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-stone-100 hover:text-destructive"
                                  title="Desvincular factura"
                                >
                                  <Link2Off className="h-3 w-3" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr
                      className="bg-background"
                      style={{ borderTop: "1px solid var(--border)" }}
                    >
                      <td
                        colSpan={2}
                        className="px-3 py-2 text-[11px] text-muted-foreground"
                      >
                        Suma de líneas
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums font-semibold text-foreground whitespace-nowrap">
                        {formatPEN(roundedLinesTotal)}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {matches ? (
                          <Check className="inline h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <span className="text-[10px] text-amber-700">≠</span>
                        )}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el pago y sus líneas. Si hay líneas vinculadas
              a facturas, no podrás eliminarlo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {linkingLineId && (
        <LinkInvoiceDialog
          open={true}
          onOpenChange={(v) => !v && setLinkingLineId(null)}
          lineId={linkingLineId}
          direction={payment.direction}
          currency={payment.currency}
          contactId={payment.contact_id}
        />
      )}

      {expectingLineId && (
        <CreateExpectedInvoiceDialog
          open={true}
          onOpenChange={(v) => !v && setExpectingLineId(null)}
          lineId={expectingLineId}
          payment={payment}
          defaultContactId={payment.contact_id}
        />
      )}
    </>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-medium text-foreground">{value}</p>
    </div>
  );
}

