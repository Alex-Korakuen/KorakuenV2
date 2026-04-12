"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupContact, createContact } from "@/app/actions/contacts";
import { useServerAction } from "@/lib/form";
import { toast } from "sonner";

type LookupData = {
  tipo_persona: number;
  ruc: string | null;
  dni: string | null;
  razon_social: string;
  address: string | null;
  sunat_estado: string | null;
  sunat_condicion: string | null;
  existing_contact_id?: string;
};

export function ContactLookupDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ruc" | "dni">("ruc");
  const [input, setInput] = useState("");
  const [lookupData, setLookupData] = useState<LookupData | null>(null);
  const [roles, setRoles] = useState({
    is_client: false,
    is_vendor: false,
    is_partner: false,
  });

  const lookup = useServerAction(lookupContact);
  const create = useServerAction(createContact);

  function resetState() {
    setInput("");
    setLookupData(null);
    setRoles({ is_client: false, is_vendor: false, is_partner: false });
    setTab("ruc");
  }

  async function handleSearch() {
    if (!input.trim()) return;
    const params =
      tab === "ruc" ? { ruc: input.trim() } : { dni: input.trim() };
    const result = await lookup.run(params);
    if (result.success) {
      setLookupData(result.data);
    } else {
      toast.error(result.error.message);
      setLookupData(null);
    }
  }

  async function handleCreate() {
    if (!lookupData) return;

    if (lookupData.existing_contact_id) {
      toast.info("Este contacto ya existe.");
      setOpen(false);
      router.push(`/contactos/${lookupData.existing_contact_id}`);
      return;
    }

    const result = await create.run({
      tipo_persona: lookupData.tipo_persona,
      ruc: lookupData.ruc,
      dni: lookupData.dni,
      razon_social: lookupData.razon_social,
      address: lookupData.address,
      sunat_estado: lookupData.sunat_estado,
      sunat_condicion: lookupData.sunat_condicion,
      ...roles,
    });

    if (result.success) {
      toast.success("Contacto creado");
      setOpen(false);
      resetState();
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetState();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-sm font-semibold">
            Nuevo contacto
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-5 border-b border-border px-5 mt-3">
          {(["ruc", "dni"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setInput("");
                setLookupData(null);
              }}
              className={`-mb-px border-b-2 pb-2.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Search */}
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder={tab === "ruc" ? "11 dígitos" : "8 dígitos"}
              className="flex-1 font-mono"
              autoFocus
            />
            <Button
              size="sm"
              onClick={handleSearch}
              disabled={lookup.pending || !input.trim()}
              className="px-3"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {/* Result */}
          {lookupData && (
            <div className="flex items-center gap-3 rounded-lg bg-accent p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {lookupData.razon_social}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lookupData.ruc
                    ? `RUC ${lookupData.ruc}`
                    : `DNI ${lookupData.dni}`}
                </p>
              </div>
            </div>
          )}

          {/* Existing contact warning */}
          {lookupData?.existing_contact_id && (
            <p className="text-xs text-primary">
              Este contacto ya existe.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setOpen(false);
                  router.push(
                    `/contactos/${lookupData.existing_contact_id}`,
                  );
                }}
              >
                Ver detalle
              </button>
            </p>
          )}

          {/* Roles */}
          {lookupData && !lookupData.existing_contact_id && (
            <div className="flex items-center gap-4">
              {(
                [
                  ["is_client", "Cliente"],
                  ["is_vendor", "Proveedor"],
                  ["is_partner", "Socio"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={roles[key]}
                    onChange={(e) =>
                      setRoles((r) => ({ ...r, [key]: e.target.checked }))
                    }
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {lookupData && !lookupData.existing_contact_id && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                resetState();
              }}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={create.pending}
            >
              Crear
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
