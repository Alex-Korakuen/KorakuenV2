import Link from "next/link";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  FolderPlus,
  Landmark,
  Receipt,
  UserPlus,
  Wallet,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getFinancialPosition } from "@/app/actions/reports";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { formatMoney, formatPEN } from "@/lib/format";
import { TopBar } from "@/components/app-shell/top-bar";
import { ACCOUNT_TYPE } from "@/lib/types";
import { cn } from "@/lib/utils";

export default async function AdminDashboard() {
  const user = await requireAdmin();
  const firstName = (user.display_name ?? user.email).split(/[\s@]/)[0];

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
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-foreground">
          Bienvenido, {firstName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Posición financiera de Constructora Korakuen E.I.R.L.
        </p>
      </div>

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
          <Link
            href="/configuracion/bancos"
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-muted-foreground"
          >
            Gestionar
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {accounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aún no hay cuentas bancarias.{" "}
            <Link
              href="/configuracion/bancos"
              className="text-muted-foreground underline underline-offset-2 hover:text-stone-800"
            >
              Crear la primera
            </Link>
          </p>
        ) : (
          <div className="space-y-0">
            {accounts.map((account) => {
              const isBN =
                account.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
              const isUSD = account.currency === "USD";
              return (
                <div
                  key={account.id}
                  className="flex items-center justify-between border-b border-border/60 py-3.5"
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
                        <p className="text-sm text-foreground">{account.name}</p>
                        {isBN && (
                          <span className="text-[11px] text-amber-600">
                            detracciones
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {[account.bank_name, account.account_number, account.currency]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </div>
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
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="mt-10">
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          Acciones rápidas
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/contactos"
            className="group flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:border-primary/30 hover:bg-accent"
          >
            <UserPlus className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Nuevo contacto
              </p>
              <p className="text-xs text-muted-foreground">
                Buscar por RUC o DNI en SUNAT
              </p>
            </div>
          </Link>
          <Link
            href="/proyectos/nuevo"
            className="group flex items-center gap-3 rounded-lg border border-border p-4 transition-colors hover:border-primary/30 hover:bg-accent"
          >
            <FolderPlus className="h-5 w-5 shrink-0 text-muted-foreground group-hover:text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Nuevo proyecto
              </p>
              <p className="text-xs text-muted-foreground">
                Registrar una obra y configurar socios
              </p>
            </div>
          </Link>
        </div>
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
