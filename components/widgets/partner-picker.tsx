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
import { getContacts } from "@/app/actions/contacts";
import { cn } from "@/lib/utils";
import type { ContactRow } from "@/lib/types";

type Props = {
  value: string | null;
  onChange: (partner: ContactRow | null) => void;
  placeholder?: string;
  className?: string;
  /**
   * When true (default) the picker auto-selects the is_self contact on first
   * render if no value is provided. Used by flows where a partner MUST be
   * chosen (e.g. new-payment dialog). Set to false for flows where blank
   * means "Korakuen's own, the 99% default" (e.g. invoice override).
   */
  autoDefault?: boolean;
};

export function PartnerPicker({
  value,
  onChange,
  placeholder = "Seleccionar partner…",
  className,
  autoDefault = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [partners, setPartners] = useState<ContactRow[]>([]);
  const [selected, setSelected] = useState<ContactRow | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await getContacts({ is_partner: true });
      if (result.success) {
        setPartners(result.data.data);
        if (value && !selected) {
          const found = result.data.data.find((c) => c.id === value);
          if (found) setSelected(found);
        }
        // When no value is set yet, optionally default to the is_self row.
        if (!value && !selected && autoDefault) {
          const self = result.data.data.find((c) => c.is_self);
          if (self) {
            setSelected(self);
            onChange(self);
          }
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleSelect(partner: ContactRow) {
    setSelected(partner);
    onChange(partner);
    setOpen(false);
  }

  function handleClear() {
    setSelected(null);
    onChange(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent/30 focus:outline-none focus:border-primary/50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected ? selected.razon_social : placeholder}
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
            <CommandEmpty>Sin partners.</CommandEmpty>
            {!autoDefault && (
              <CommandItem value="__clear__" onSelect={handleClear}>
                <Check
                  className={cn(
                    "h-4 w-4",
                    selected == null ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate italic text-muted-foreground">
                    Korakuen (por defecto)
                  </span>
                </div>
              </CommandItem>
            )}
            {partners.map((partner) => (
              <CommandItem
                key={partner.id}
                value={partner.id}
                onSelect={() => handleSelect(partner)}
              >
                <Check
                  className={cn(
                    "h-4 w-4",
                    value === partner.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate">
                    {partner.razon_social}
                    {partner.is_self && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        (nosotros)
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {partner.ruc ?? partner.dni ?? ""}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
