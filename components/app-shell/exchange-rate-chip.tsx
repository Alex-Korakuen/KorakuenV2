import { checkExchangeRateHealth } from "@/lib/exchange-rate";
import { cn } from "@/lib/utils";

export async function ExchangeRateChip() {
  const health = await checkExchangeRateHealth();
  const ok = health.ok && health.last_rate_promedio !== null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-stone-400">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-emerald-400" : "bg-rose-400",
        )}
      />
      <span>
        {ok && health.last_rate_promedio
          ? `USD/PEN S/ ${health.last_rate_promedio.toFixed(4)}`
          : "USD/PEN no disponible"}
      </span>
    </div>
  );
}
