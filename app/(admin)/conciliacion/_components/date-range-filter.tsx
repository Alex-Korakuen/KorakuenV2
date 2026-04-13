"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

type Props = {
  accountId: string;
  from: string | null;
  to: string | null;
};

export function DateRangeFilter({ accountId, from, to }: Props) {
  const router = useRouter();

  function updateQuery(nextFrom: string, nextTo: string) {
    const params = new URLSearchParams();
    params.set("account", accountId);
    params.set("view", "conciliados");
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    router.push(`/conciliacion?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-muted-foreground">Periodo</span>
      <Input
        type="date"
        value={from ?? ""}
        onChange={(e) => updateQuery(e.target.value, to ?? "")}
        className="h-8 w-auto text-xs"
      />
      <span className="text-muted-foreground">—</span>
      <Input
        type="date"
        value={to ?? ""}
        onChange={(e) => updateQuery(from ?? "", e.target.value)}
        className="h-8 w-auto text-xs"
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => updateQuery("", "")}
          className="text-muted-foreground hover:text-foreground"
        >
          Limpiar
        </button>
      )}
    </div>
  );
}
