import Link from "next/link";
import { formatPEN, formatDate } from "@/lib/format";
import type { ContactHistorial, ContactHistorialItem } from "@/app/actions/contacts";

type Props = {
  historial: ContactHistorial;
};

const TYPE_CONFIG: Record<
  ContactHistorialItem["type"],
  { label: string; bg: string; color: string }
> = {
  emitida: { label: "Emitida", bg: "#f0f9ff", color: "#0369a1" },
  recibida: { label: "Recibida", bg: "#fffbeb", color: "#b45309" },
  pago_in: { label: "Pago ↑", bg: "#ecfdf5", color: "#047857" },
  pago_out: { label: "Pago ↓", bg: "#ecfdf5", color: "#047857" },
};

const STATUS_COLORS: Record<string, string> = {
  Cobrado: "#047857",
  Pagado: "#047857",
  Conciliado: "#047857",
  Parcial: "#b45309",
  Pendiente: "#b45309",
  Esperada: "#b45309",
  "Sin conciliar": "#78716c",
  Borrador: "#78716c",
};

function hrefForItem(item: ContactHistorialItem): string {
  switch (item.type) {
    case "emitida":
      return `/facturas-emitidas/${item.id}`;
    case "recibida":
      return `/facturas-recibidas/${item.id}`;
    case "pago_in":
    case "pago_out":
      return `/pagos/${item.id}`;
  }
}

export function HistorialSection({ historial }: Props) {
  const { por_cobrar, por_pagar, items } = historial;
  const hasCobrar = por_cobrar !== null;
  const hasPagar = por_pagar !== null;

  if (!hasCobrar && !hasPagar && items.length === 0) {
    return (
      <div className="mt-10">
        <h3 className="mb-3 text-xs font-medium text-muted-foreground">
          Historial
        </h3>
        <p className="py-8 text-center text-sm text-muted-foreground/40">
          Sin movimientos aún
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <div className="mb-5">
        <h3 className="text-xs font-medium text-muted-foreground mb-4">
          Historial
        </h3>

        {/* Summary row — split in two halves */}
        {(hasCobrar || hasPagar) && (
          <div
            className="flex rounded-lg bg-card"
            style={{ border: "1px solid var(--border)" }}
          >
            {hasCobrar && (
              <div
                className="flex-1 px-4 py-3"
                style={hasPagar ? { borderRight: "1px solid var(--border)" } : undefined}
              >
                <p
                  className="text-[11px] font-medium mb-2"
                  style={{ color: "#0369a1" }}
                >
                  Por cobrar
                </p>
                <div className="flex items-center gap-5">
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Facturado
                    </p>
                    <p className="text-sm font-medium tabular-nums text-foreground">
                      {formatPEN(por_cobrar!.facturado_pen)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Cobrado</p>
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: "#047857" }}
                    >
                      {formatPEN(por_cobrar!.cobrado_pen)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Pendiente
                    </p>
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: "#b45309" }}
                    >
                      {formatPEN(por_cobrar!.pendiente_pen)}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {hasPagar && (
              <div className="flex-1 px-4 py-3">
                <p
                  className="text-[11px] font-medium mb-2"
                  style={{ color: "#b45309" }}
                >
                  Por pagar
                </p>
                <div className="flex items-center gap-5">
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Facturado
                    </p>
                    <p className="text-sm font-medium tabular-nums text-foreground">
                      {formatPEN(por_pagar!.facturado_pen)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Pagado</p>
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: "#047857" }}
                    >
                      {formatPEN(por_pagar!.pagado_pen)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">
                      Pendiente
                    </p>
                    <p
                      className="text-sm font-medium tabular-nums"
                      style={{ color: "#b45309" }}
                    >
                      {formatPEN(por_pagar!.pendiente_pen)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div>
        {items.map((item) => {
          const config = TYPE_CONFIG[item.type];
          return (
            <Link
              key={`${item.type}-${item.id}`}
              href={hrefForItem(item)}
              className="flex items-center justify-between rounded-lg px-3 py-3.5 transition-colors hover:bg-accent/50"
            >
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-5 w-16 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                  style={{ background: config.bg, color: config.color }}
                >
                  {config.label}
                </span>
                <div>
                  <p className="text-sm text-foreground">
                    {item.description}
                    {item.detail && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {item.detail}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(item.date)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums text-foreground">
                  {formatPEN(item.amount_pen)}
                </p>
                <span
                  className="text-[11px] font-medium"
                  style={{
                    color: STATUS_COLORS[item.status_label] ?? "#78716c",
                  }}
                >
                  {item.status_label}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
