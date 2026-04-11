import { ExchangeRateChip } from "./exchange-rate-chip";
import { TopBarTitle } from "./top-bar-title";

type Props = {
  variant: "admin" | "partner";
};

export function TopBar({ variant }: Props) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <TopBarTitle variant={variant} />
      </div>
      <div className="flex items-center gap-2">
        <ExchangeRateChip />
      </div>
    </header>
  );
}
