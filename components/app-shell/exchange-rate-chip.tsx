"use client";

import { cn } from "@/lib/utils";

type Props = {
  ok: boolean;
  rate: number | null;
};

export function ExchangeRateChip({ ok, rate }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-stone-400">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-emerald-400" : "bg-rose-400",
        )}
      />
      <span>
        {ok && rate ? `USD/PEN S/ ${rate.toFixed(4)}` : "USD/PEN no disponible"}
      </span>
    </div>
  );
}
