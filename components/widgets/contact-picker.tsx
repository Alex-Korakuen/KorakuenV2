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
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { getContacts } from "@/app/actions/contacts";
import { cn } from "@/lib/utils";
import type { ContactRow } from "@/lib/types";

type Props = {
  value: string | null;
  onChange: (id: string | null) => void;
  filter?: "client" | "vendor" | "partner" | "all";
  placeholder?: string;
  className?: string;
};

export function ContactPicker({
  value,
  onChange,
  filter = "all",
  placeholder = "Buscar contacto…",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const filters: Record<string, unknown> = {};
      if (search.trim()) filters.search = search.trim();
      if (filter === "client") filters.is_client = true;
      if (filter === "vendor") filters.is_vendor = true;
      if (filter === "partner") filters.is_partner = true;

      const result = await getContacts(filters);
      if (result.success) {
        setContacts(result.data.data);
        if (value && !selectedLabel) {
          const found = result.data.data.find((c) => c.id === value);
          if (found) setSelectedLabel(found.razon_social);
        }
      }
    });
  }, [search, filter, value, selectedLabel]);

  function handleSelect(contact: ContactRow) {
    onChange(contact.id);
    setSelectedLabel(contact.razon_social);
    setOpen(false);
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
            {selectedLabel || placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            {contacts.map((contact) => (
              <CommandItem
                key={contact.id}
                value={contact.id}
                onSelect={() => handleSelect(contact)}
              >
                <Check
                  className={cn(
                    "h-4 w-4",
                    value === contact.id ? "opacity-100" : "opacity-0",
                  )}
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm truncate">{contact.razon_social}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {contact.ruc ? `RUC ${contact.ruc}` : `DNI ${contact.dni}`}
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
