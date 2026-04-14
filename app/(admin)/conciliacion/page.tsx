import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getPayments } from "@/app/actions/payments";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { formatPEN, formatDate } from "@/lib/format";
import { BankAccountSelect } from "./_components/bank-account-select";
import { ReconcileRow } from "./_components/reconcile-row";
import { UnreconcileRow } from "./_components/unreconcile-row";
import { DateRangeFilter } from "./_components/date-range-filter";
import type { PaymentWithLinesAndComputed } from "@/app/actions/payments";
import type { BankAccountRow, ContactRow } from "@/lib/types";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function ConciliacionPage({ searchParams }: Props) {
  const params = await searchParams;
  const accountId = pickFirst(params.account).trim();
  const view = pickFirst(params.view).trim() || "sin-conciliar";
  const dateFrom = pickFirst(params.from).trim();
  const dateTo = pickFirst(params.to).trim();

  const banksResult = await getBankAccounts({ is_active: true });
  const banks = banksResult.success ? banksResult.data.data : [];
  const effectiveAccountId =
    accountId || (banks[0]?.id ?? "");
  const selectedBank = banks.find(
    (b) => b.id === effectiveAccountId,
  ) as BankAccountRow | undefined;

  let unreconciled: PaymentWithLinesAndComputed[] = [];
  let reconciledList: PaymentWithLinesAndComputed[] = [];
  let latestReconciled: PaymentWithLinesAndComputed | null = null;

  if (effectiveAccountId) {
    const [unrecResult, latestResult] = await Promise.all([
      getPayments({
        bank_account_id: effectiveAccountId,
        reconciled: false,
        limit: 200,
      }),
      getPayments({
        bank_account_id: effectiveAccountId,
        reconciled: true,
        limit: 1,
      }),
    ]);
    if (unrecResult.success) unreconciled = unrecResult.data.data;
    if (latestResult.success && latestResult.data.data.length > 0) {
      latestReconciled = latestResult.data.data[0];
    }

    if (view === "conciliados") {
      const recResult = await getPayments({
        bank_account_id: effectiveAccountId,
        reconciled: true,
        limit: 200,
        ...(dateFrom ? { date_from: dateFrom } : {}),
        ...(dateTo ? { date_to: dateTo } : {}),
      });
      if (recResult.success) reconciledList = recResult.data.data;
    }
  }

  // Sin conciliar: oldest first (ascending) to match the bank statement order
  const sinConciliar = [...unreconciled].sort((a, b) =>
    a.payment_date < b.payment_date ? -1 : a.payment_date > b.payment_date ? 1 : 0,
  );

  const unrecCount = sinConciliar.length;
  const unrecPendientePen = sinConciliar.reduce(
    (acc, p) => acc + Math.abs(Number(p.total_amount_pen)),
    0,
  );

  // Fetch contacts referenced by any row (Map for display)
  const contactIds = new Set<string>();
  const rowsForContacts = view === "conciliados" ? reconciledList : sinConciliar;
  for (const p of rowsForContacts) {
    if (p.contact_id) contactIds.add(p.contact_id);
    if (p.paid_by_partner_id) contactIds.add(p.paid_by_partner_id);
  }
  const contactsResult = await getContacts({ limit: 500 });
  const contactsById = new Map<string, ContactRow>(
    (contactsResult.success ? contactsResult.data.data : []).map((c) => [c.id, c]),
  );

  const banksById = new Map<string, BankAccountRow>(banks.map((b) => [b.id, b]));

  const isSinConciliar = view !== "conciliados";

  return (
    <div>
      <TopBar
        left={
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Conciliación
            </span>
            <BankAccountSelect
              accounts={banks}
              value={effectiveAccountId || null}
            />
          </div>
        }
        right={<ExchangeRateChip />}
      />

      <div className="max-w-6xl px-8 py-8">
        {/* Filter tabs + summary strip */}
        <div className="mb-6 flex items-center gap-6">
          <div className="flex items-center gap-4 text-sm">
            <Link
              href={{
                pathname: "/conciliacion",
                query: { account: effectiveAccountId },
              }}
              className={
                isSinConciliar
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Sin conciliar
            </Link>
            <Link
              href={{
                pathname: "/conciliacion",
                query: { account: effectiveAccountId, view: "conciliados" },
              }}
              className={
                !isSinConciliar
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Conciliados
            </Link>
          </div>
          <div className="flex-1" />
          <div
            className="flex items-center gap-4 shrink-0 pl-4"
            style={{ borderLeft: "1px solid var(--border)" }}
          >
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Sin conciliar</p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {unrecCount} pagos
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Pendiente</p>
              <p className="text-sm font-medium tabular-nums text-amber-700">
                {formatPEN(unrecPendientePen)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Última</p>
              <p className="text-sm font-medium tabular-nums text-muted-foreground">
                {latestReconciled
                  ? formatDate(latestReconciled.payment_date)
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Date range filter — only on Conciliados view */}
        {!isSinConciliar && (
          <div className="mb-4">
            <DateRangeFilter
              accountId={effectiveAccountId}
              from={dateFrom || null}
              to={dateTo || null}
            />
          </div>
        )}

        {/* Content */}
        {!effectiveAccountId ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No hay cuentas bancarias activas.
          </p>
        ) : isSinConciliar ? (
          sinConciliar.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              <p className="text-sm text-muted-foreground">
                No hay pagos sin conciliar en esta cuenta.
              </p>
            </div>
          ) : (
            <div
              className="rounded-lg bg-card overflow-hidden"
              style={{ border: "1px solid var(--border)" }}
            >
              <table
                className="w-full text-sm"
                style={{ tableLayout: "fixed" }}
              >
                <colgroup>
                  <col style={{ width: "72px" }} />
                  <col style={{ width: "40px" }} />
                  <col />
                  <col style={{ width: "200px" }} />
                  <col style={{ width: "120px" }} />
                  <col style={{ width: "180px" }} />
                  <col style={{ width: "56px" }} />
                </colgroup>
                <thead>
                  <tr className="bg-background">
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Fecha
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Dir
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Título
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Contraparte
                    </th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Monto
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Código bancario
                    </th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sinConciliar.map((payment, idx) => (
                    <ReconcileRow
                      key={payment.id}
                      payment={payment}
                      bank={
                      payment.bank_account_id
                        ? banksById.get(payment.bank_account_id)
                        : undefined
                    }
                      contraparte={
                        payment.contact_id
                          ? contactsById.get(payment.contact_id)
                          : undefined
                      }
                      partnerContact={
                        payment.paid_by_partner_id
                          ? contactsById.get(payment.paid_by_partner_id)
                          : undefined
                      }
                      rowIndex={idx}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : reconciledList.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No hay pagos conciliados en este rango.
          </p>
        ) : (
          <div
            className="rounded-lg bg-card overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "72px" }} />
                <col style={{ width: "40px" }} />
                <col />
                <col style={{ width: "200px" }} />
                <col style={{ width: "120px" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr className="bg-background">
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Dir
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Título
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Contraparte
                  </th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Monto
                  </th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Código
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reconciledList.map((payment) => (
                  <UnreconcileRow
                    key={payment.id}
                    payment={payment}
                    bank={
                      payment.bank_account_id
                        ? banksById.get(payment.bank_account_id)
                        : undefined
                    }
                    contraparte={
                      payment.contact_id
                        ? contactsById.get(payment.contact_id)
                        : undefined
                    }
                    partnerContact={
                      payment.paid_by_partner_id
                        ? contactsById.get(payment.paid_by_partner_id)
                        : undefined
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isSinConciliar && sinConciliar.length > 0 && (
          <p className="mt-3 text-[11px] text-muted-foreground/60">
            Revisa que fecha, monto y contraparte coincidan con el estado de
            cuenta. Pega el código bancario y presiona{" "}
            <kbd className="rounded border border-border bg-background px-1 text-[10px]">
              Enter
            </kbd>{" "}
            o ✓ para conciliar. El foco salta al siguiente pago.
          </p>
        )}
      </div>
    </div>
  );
}
