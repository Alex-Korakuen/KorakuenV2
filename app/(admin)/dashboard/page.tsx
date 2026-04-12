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
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell/page-header";
import { formatMoney, formatPEN } from "@/lib/format";
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
    position?.receivables.by_client.reduce((s, c) => s + c.invoice_count, 0) ??
    0;
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
      <PageHeader
        title={`Bienvenido, ${firstName}`}
        description="Posición financiera consolidada de Constructora Korakuen E.I.R.L."
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Caja total
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatPEN(cashTotalPen)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Wallet className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            {activeAccountCount}{" "}
            {activeAccountCount === 1 ? "cuenta activa" : "cuentas activas"}
          </div>
        </Card>

        <Card className="p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Cuentas por cobrar
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatPEN(receivablesTotal)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <ArrowDownCircle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="font-medium text-emerald-600">
              {receivablesInvoiceCount}{" "}
              {receivablesInvoiceCount === 1 ? "factura" : "facturas"}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">
              {receivablesClientCount}{" "}
              {receivablesClientCount === 1 ? "cliente" : "clientes"}
            </span>
          </div>
        </Card>

        <Card className="p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Cuentas por pagar
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatPEN(payablesTotal)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <ArrowUpCircle className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="font-medium text-amber-600">
              {payablesInvoiceCount}{" "}
              {payablesInvoiceCount === 1 ? "factura" : "facturas"}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">
              {payablesVendorCount}{" "}
              {payablesVendorCount === 1 ? "proveedor" : "proveedores"}
            </span>
          </div>
        </Card>

        <Card className="p-5 transition-shadow hover:shadow-md">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                IGV neto del mes
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatPEN(igvNet)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
              <Receipt className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">Débito {formatPEN(igvOutput)}</span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-500">Crédito {formatPEN(igvInput)}</span>
          </div>
        </Card>
      </div>

      {/* Caja por cuenta */}
      <div className="mt-8">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Caja por cuenta
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Saldo actual de cada cuenta bancaria
              </p>
            </div>
            <Link
              href="/configuracion/bancos"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
            >
              Gestionar cuentas
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {accounts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-slate-500">
                Aún no hay cuentas bancarias registradas.
              </p>
              <Link
                href="/configuracion/bancos"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                Crear la primera cuenta
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {accounts.map((account) => {
                const isBN =
                  account.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
                const isUSD = account.currency === "USD";
                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                          isBN
                            ? "bg-amber-50 text-amber-600"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        <Landmark className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900">
                            {account.name}
                          </p>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                              isBN
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-slate-200 bg-slate-50 text-slate-600",
                            )}
                          >
                            {isBN ? "Detracciones" : "Regular"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {[
                            account.bank_name,
                            account.account_number,
                            account.currency,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold tabular-nums text-slate-900">
                        {formatMoney(
                          account._computed.balance_native,
                          account.currency,
                        )}
                      </p>
                      {isUSD && (
                        <p className="text-xs text-slate-500">
                          ≈ {formatPEN(account._computed.balance_pen)}
                        </p>
                      )}
                      {isBN && !isUSD && (
                        <p className="text-xs text-slate-500">Solo impuestos</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Quick actions */}
      <div className="mt-8">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Acciones rápidas
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/contactos"
            className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-600 hover:bg-blue-50"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
              <UserPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Nuevo contacto
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Buscar por RUC o DNI en SUNAT/RENIEC
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </Link>

          <Link
            href="/proyectos/nuevo"
            className="group flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-blue-600 hover:bg-blue-50"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
              <FolderPlus className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">
                Nuevo proyecto
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Registrar una obra y configurar socios
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </Link>
        </div>
      </div>
    </div>
  );
}
