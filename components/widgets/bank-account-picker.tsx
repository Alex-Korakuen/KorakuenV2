"use client";

import { useState, useEffect, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getBankAccounts } from "@/app/actions/bank-accounts";
import { ACCOUNT_TYPE } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { BankAccountRow } from "@/lib/types";

type Props = {
  value: string | null;
  onChange: (account: BankAccountRow | null) => void;
  placeholder?: string;
  className?: string;
};

export function BankAccountPicker({
  value,
  onChange,
  placeholder = "Seleccionar cuenta…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<BankAccountRow[]>([]);
  const [selected, setSelected] = useState<BankAccountRow | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await getBankAccounts({ is_active: true });
      if (result.success) {
        setAccounts(result.data.data);
        if (value && !selected) {
          const found = result.data.data.find((a) => a.id === value);
          if (found) setSelected(found);
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleSelect(account: BankAccountRow) {
    setSelected(account);
    onChange(account);
    setOpen(false);
  }

  function displayLabel(a: BankAccountRow): string {
    const suffix = a.account_number ? ` · ···· ${a.account_number.slice(-4)}` : "";
    return `${a.name}${suffix}`;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/30 focus:outline-none focus:border-primary/50",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? displayLabel(selected) : placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandList>
            <CommandEmpty>Sin cuentas.</CommandEmpty>
            {accounts.map((account) => {
              const isBN = account.account_type === ACCOUNT_TYPE.banco_de_la_nacion;
              return (
                <CommandItem
                  key={account.id}
                  value={account.id}
                  onSelect={() => handleSelect(account)}
                >
                  <Check
                    className={cn(
                      "h-4 w-4",
                      value === account.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm truncate">
                      {displayLabel(account)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {account.bank_name} · {account.currency}
                      {isBN && " · detracciones"}
                    </span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
