import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { getPayments } from "@/app/actions/payments";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { Button } from "@/components/ui/button";
import { formatPEN } from "@/lib/format";
import { PAYMENT_DIRECTION } from "@/lib/types";
import { NewPaymentDialog } from "./_components/new-payment-dialog";
import { PaymentRow } from "./_components/payment-row";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function PagosPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const filterKey = pickFirst(params.filter).trim() || "todos";

  const filters: Record<string, unknown> = {};
  if (filterKey === "entrada") filters.direction = PAYMENT_DIRECTION.inbound;
  if (filterKey === "salida") filters.direction = PAYMENT_DIRECTION.outbound;
  if (filterKey === "sin-vincular") filters.has_unlinked_lines = true;

  const [paymentsResult, banksResult, contactsResult] = await Promise.all([
    getPayments(filters),
    getBankAccounts({ is_active: true }),
    getContacts({ limit: 200 }),
  ]);

  const payments = paymentsResult.success ? paymentsResult.data.data : [];
  const banksById = new Map(
    (banksResult.success ? banksResult.data.data : []).map((b) => [b.id, b]),
  );
  const contactsById = new Map(
    (contactsResult.success ? contactsResult.data.data : []).map((c) => [
      c.id,
      c,
    ]),
  );

  // Totals
  let entradaTotal = 0;
  let salidaTotal = 0;
  for (const p of payments) {
    if (p.direction === PAYMENT_DIRECTION.inbound) {
      entradaTotal += Number(p.total_amount_pen);
    } else {
      salidaTotal += Number(p.total_amount_pen);
    }
  }
  const neto = Math.round((entradaTotal - salidaTotal) * 100) / 100;

  return (
    <div>
      <TopBar
        left={
          <span className="text-sm font-medium text-muted-foreground">
            Pagos
          </span>
        }
        right={
          <NewPaymentDialog>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Nuevo pago
            </Button>
          </NewPaymentDialog>
        }
      />

      <div className="max-w-6xl px-8 py-8">
        {/* Search + filter tabs + totals */}
        <div className="mb-6 flex items-center gap-6">
          <form className="relative flex-1" action="/pagos" method="get">
            <input type="hidden" name="filter" value={filterKey} />
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40" />
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Buscar por título, código o contraparte…"
              className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-4 shrink-0 text-sm">
            {(
              [
                ["todos", "Todos"],
                ["entrada", "Entrada"],
                ["salida", "Salida"],
                ["sin-vincular", "Sin vincular"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/pagos?filter=${key}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                className={
                  filterKey === key
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </Link>
            ))}
          </div>
          <div
            className="flex items-center gap-4 shrink-0 pl-4"
            style={{ borderLeft: "1px solid var(--border)" }}
          >
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Entrada</p>
              <p className="text-sm font-medium tabular-nums text-emerald-700">
                {formatPEN(entradaTotal)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Salida</p>
              <p className="text-sm font-medium tabular-nums text-amber-700">
                {formatPEN(salidaTotal)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Neto</p>
              <p className="text-sm font-medium tabular-nums text-foreground">
                {formatPEN(neto)}
              </p>
            </div>
          </div>
        </div>

        {payments.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? "No se encontraron pagos." : "Aún no hay pagos registrados."}
            </p>
          </div>
        ) : (
          <div
            className="rounded-lg bg-card overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-background">
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Socio
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Título
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Código
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Banco
                  </th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Monto
                  </th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Sin vincular
                  </th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Conc.
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    banksById={banksById}
                    contactsById={contactsById}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
