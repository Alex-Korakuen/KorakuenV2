import { ExchangeRateChip } from "./exchange-rate-chip";
import { TopBarTitle } from "./top-bar-title";

type Props = {
  variant: "admin" | "partner";
};

export function TopBar({ variant }: Props) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-stone-100 px-6">
      <TopBarTitle variant={variant} />
      <ExchangeRateChip />
    </header>
  );
}
