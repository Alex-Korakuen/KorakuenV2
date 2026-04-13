import {
  ArrowDownCircle,
  ArrowUpCircle,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { getFinancialPosition } from "@/app/actions/reports";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { formatMoney, formatPEN } from "@/lib/format";
import { TopBar } from "@/components/app-shell/top-bar";
import { ACCOUNT_TYPE } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BankAccountDialog } from "./_components/bank-account-dialog";

export default async function AdminDashboard() {
  const [positionResult, accountsResult] = await Promise.all([
    getFinancialPosition(),
    getBankAccounts({ is_active: true }),
  ]);

  const position = positionResult.success ? positionResult.data : null;
  const accounts = accountsResult.success ? accountsResult.data.data : [];

  const cashTotalPen = position?.cash.total_pen ?? 0;
  const activeAccountCount = position?.cash.accounts.length ?? accounts.length;

  const receivablesTotal = position?.receivables.total_outstanding_pen ?? 0;
  const receivablesInvoiceCount =
    position?.receivables.by_client.reduce((s, c) => s + c.invoice_count, 0) ?? 0;
  const receivablesClientCount = position?.receivables.by_client.length ?? 0;

  const payablesTotal = position?.payables.total_outstanding_pen ?? 0;
  const payablesInvoiceCount =
    position?.payables.by_vendor.reduce((s, v) => s + v.invoice_count, 0) ?? 0;
  const payablesVendorCount = position?.payables.by_vendor.length ?? 0;

  const igvNet = position?.igv.net_pen ?? 0;
  const igvOutput = position?.igv.output_pen ?? 0;
  const igvInput = position?.igv.input_pen ?? 0;

  return (
    <div>
      <TopBar variant="admin" />
      <div className="max-w-4xl px-8 py-8">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Caja total"
          value={formatPEN(cashTotalPen)}
          detail={`${activeAccountCount} ${activeAccountCount === 1 ? "cuenta activa" : "cuentas activas"}`}
          icon={<Wallet className="h-5 w-5" />}
          iconColor="text-muted-foreground"
        />
        <KpiCard
          label="Cuentas por cobrar"
          value={formatPEN(receivablesTotal)}
          detail={`${receivablesInvoiceCount} facturas · ${receivablesClientCount} clientes`}
          icon={<ArrowDownCircle className="h-5 w-5" />}
          iconColor="text-emerald-400"
        />
        <KpiCard
          label="Cuentas por pagar"
          value={formatPEN(payablesTotal)}
          detail={`${payablesInvoiceCount} facturas · ${payablesVendorCount} proveedores`}
          icon={<ArrowUpCircle className="h-5 w-5" />}
          iconColor="text-amber-400"
        />
        <KpiCard
          label="IGV neto del mes"
          value={formatPEN(igvNet)}
          detail={`Débito ${formatPEN(igvOutput)} · Crédito ${formatPEN(igvInput)}`}
          icon={<Receipt className="h-5 w-5" />}
          iconColor="text-muted-foreground"
        />
      </div>

      {/* Caja por cuenta */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Caja por cuenta
          </h3>
          <BankAccountDialog mode="create">
            <button className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:opacity-80">
              <Plus className="h-3.5 w-3.5" />
              Nueva cuenta
            </button>
          </BankAccountDialog>
        </div>

        {accounts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay cuentas bancarias.{" "}
            <BankAccountDialog mode="create">
              <button className="text-primary underline underline-offset-2">
                Crear la primera
              </button>
            </BankAccountDialog>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {accounts.map((account) => {
              const isBN =
                account.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
              const isUSD = account.currency === "USD";
              // Display only the last 4 chars of account_number (masked)
              const maskedNumber = account.account_number
                ? `···· ${account.account_number.slice(-4)}`
                : null;
              return (
                <div
                  key={account.id}
                  className="group flex items-center justify-between rounded-lg px-3 py-3.5 transition-colors hover:bg-primary/[0.04]"
                >
                  <div className="flex items-center gap-3">
                    <Landmark
                      className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        isBN ? "text-amber-500" : "text-border",
                      )}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-foreground">
                          {account.name}
                        </p>
                        {isBN && (
                          <span className="text-[11px] text-amber-600">
                            detracciones
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[account.bank_name, maskedNumber, account.currency]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-foreground">
                        {formatMoney(
                          account._computed.balance_native,
                          account.currency,
                        )}
                      </p>
                      {isUSD && (
                        <p className="text-xs text-muted-foreground">
                          ≈ {formatPEN(account._computed.balance_pen)}
                        </p>
                      )}
                    </div>
                    <BankAccountDialog mode="edit" account={account}>
                      <button
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </BankAccountDialog>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  icon,
  iconColor,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  iconColor: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
