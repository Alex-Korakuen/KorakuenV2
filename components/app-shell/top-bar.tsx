import type { ReactNode } from "react";
import { ExchangeRateChip } from "./exchange-rate-chip";
import { TopBarTitle } from "./top-bar-title";

type Props = {
  variant?: "admin" | "partner";
  left?: ReactNode;
  right?: ReactNode;
};

export function TopBar({ variant, left, right }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border px-6">
      <div className="flex items-center gap-3">
        {left ?? (variant ? <TopBarTitle variant={variant} /> : null)}
      </div>
      <div className="flex items-center gap-4">
        {right ?? <ExchangeRateChip />}
      </div>
    </header>
  );
}
