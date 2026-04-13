"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE } from "@/lib/types";
import type { BankAccountRow } from "@/lib/types";

type Props = {
  accounts: BankAccountRow[];
  value: string | null;
};

function displayLabel(a: BankAccountRow): string {
  const suffix = a.account_number ? ` · ···· ${a.account_number.slice(-4)}` : "";
  return `${a.name}${suffix}`;
}

export function BankAccountSelect({ accounts, value }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => accounts.find((a) => a.id === value) ?? null,
    [accounts, value],
  );

  function handleSelect(account: BankAccountRow) {
    setOpen(false);
    router.push(`/conciliacion?account=${account.id}`);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-between rounded-md bg-card px-3 py-1.5 pr-9 text-sm font-medium text-foreground focus:outline-none relative"
          style={{ border: "1px solid var(--border)", minWidth: 260 }}
        >
          <span className="truncate">
            {selected ? displayLabel(selected) : "Seleccionar cuenta…"}
          </span>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0" sideOffset={4}>
        {accounts.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            Sin cuentas activas.
          </p>
        ) : (
          <ul className="py-1">
            {accounts.map((account) => {
              const isBN =
                account.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
              const isSelected = account.id === value;
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(account)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/40"
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected ? "opacity-100 text-primary" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {displayLabel(account)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {account.bank_name} · {account.currency}
                        {isBN && " · detracciones"}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
