import type { ReactNode } from "react";
import { checkExchangeRateHealth } from "@/lib/exchange-rate";
import { ExchangeRateChip } from "./exchange-rate-chip";
import { TopBarTitle } from "./top-bar-title";

type Props = {
  variant?: "admin" | "partner";
  left?: ReactNode;
  right?: ReactNode;
};

export async function TopBar({ variant, left, right }: Props) {
  const health = await checkExchangeRateHealth();
  const ok = health.ok && health.last_rate_promedio !== null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div className="flex items-center gap-3">
        {left ?? (variant ? <TopBarTitle variant={variant} /> : null)}
      </div>
      <div className="flex items-center gap-4">
        {right}
        <ExchangeRateChip ok={ok} rate={health.last_rate_promedio} />
      </div>
    </header>
  );
}
