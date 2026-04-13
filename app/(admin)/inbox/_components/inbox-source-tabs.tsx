import { FileDown, FileUp, Wallet } from "lucide-react";

type Props = {
  /** Count for the Pagos tab — total pending payment submissions. */
  paymentCount: number;
};

/**
 * Source-type tabs on top of the Inbox table. Only "Pagos" is active
 * today. Facturas recibidas / emitidas render as disabled placeholders
 * to telegraph future pipelines without committing to UI we haven't
 * built yet. When those pipelines land, the disabled prop flips off
 * and the tabs get real `href`s.
 */
export function InboxSourceTabs({ paymentCount }: Props) {
  return (
    <div className="flex items-center gap-6 border-b border-border text-sm">
      {/* Pagos — active */}
      <div
        className="flex items-center gap-2 pb-3 font-medium text-primary"
        style={{ borderBottom: "2px solid var(--primary)", marginBottom: "-1px" }}
      >
        <Wallet className="h-4 w-4" />
        Pagos
        <CountPill value={paymentCount} variant="active" />
      </div>

      {/* Facturas recibidas — stub */}
      <div
        className="flex cursor-not-allowed items-center gap-2 pb-3 text-muted-foreground/60"
        title="Próximamente"
      >
        <FileDown className="h-4 w-4" />
        Facturas recibidas
        <CountPill value={0} variant="muted" />
      </div>

      {/* Facturas emitidas — stub */}
      <div
        className="flex cursor-not-allowed items-center gap-2 pb-3 text-muted-foreground/60"
        title="Próximamente"
      >
        <FileUp className="h-4 w-4" />
        Facturas emitidas
        <CountPill value={0} variant="muted" />
      </div>
    </div>
  );
}

function CountPill({
  value,
  variant,
}: {
  value: number;
  variant: "active" | "muted";
}) {
  return (
    <span
      className={
        variant === "active"
          ? "inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700"
          : "inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground/60"
      }
    >
      {value}
    </span>
  );
}
