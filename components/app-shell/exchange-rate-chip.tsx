import { CircleDot } from "lucide-react";
import { checkExchangeRateHealth } from "@/lib/exchange-rate";
import { cn } from "@/lib/utils";

export async function ExchangeRateChip() {
  const health = await checkExchangeRateHealth();
  const ok = health.ok && health.last_rate_promedio !== null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
        ok
          ? "border-slate-200 bg-slate-50"
          : "border-rose-200 bg-rose-50",
      )}
      title={
        ok
          ? `Tipo de cambio del ${health.last_rate_date}`
          : "Tipo de cambio no disponible"
      }
    >
      <CircleDot
        className={cn(
          "h-3 w-3",
          ok ? "text-emerald-500" : "text-rose-500",
        )}
      />
      <span className="font-medium text-slate-700">USD/PEN</span>
      <span className="text-slate-500">
        {ok && health.last_rate_promedio
          ? `S/ ${health.last_rate_promedio.toFixed(4)}`
          : "no disponible"}
      </span>
    </div>
  );
}
