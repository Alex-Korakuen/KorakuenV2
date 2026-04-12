"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactPicker } from "@/components/widgets/contact-picker";
import { createProject } from "@/app/actions/projects";
import { toast } from "sonner";

export function ProjectCreateDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [currency, setCurrency] = useState<"PEN" | "USD">("PEN");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setName("");
    setCode("");
    setClientId(null);
    setLocation("");
    setContractValue("");
    setCurrency("PEN");
    setStartDate("");
    setEndDate("");
    setNotes("");
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("El nombre es requerido");
      return;
    }
    if (!clientId) {
      toast.error("Selecciona un cliente");
      return;
    }

    setSaving(true);

    const result = await createProject({
      name: name.trim(),
      code: code.trim() || null,
      client_id: clientId,
      location: location.trim() || null,
      contract_value: contractValue
        ? parseFloat(contractValue.replace(/,/g, ""))
        : null,
      contract_currency: currency,
      contract_exchange_rate: null,
      igv_included: true,
      start_date: startDate || null,
      expected_end_date: endDate || null,
      notes: notes.trim() || null,
    });

    setSaving(false);

    if (result.success) {
      toast.success("Proyecto creado");
      setOpen(false);
      reset();
      router.refresh();
      router.push(`/proyectos/${result.data.id}`);
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-sm font-semibold">
            Nuevo proyecto
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          {/* Nombre + Código */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Nombre</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Obra Parque Industrial"
                className="mt-0.5"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Código</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="PROY001"
                className="mt-0.5 font-mono"
              />
            </div>
          </div>

          {/* Cliente */}
          <div>
            <label className="text-[11px] text-muted-foreground">Cliente</label>
            <ContactPicker
              value={clientId}
              onChange={setClientId}
              filter="client"
              placeholder="Buscar cliente…"
              className="mt-0.5"
            />
          </div>

          {/* Ubicación */}
          <div>
            <label className="text-[11px] text-muted-foreground">Ubicación</label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Villa El Salvador, Lima"
              className="mt-0.5"
            />
          </div>

          {/* Valor + Moneda */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">
                Valor del contrato
              </label>
              <Input
                value={contractValue}
                onChange={(e) => setContractValue(e.target.value)}
                placeholder="485,000.00"
                className="mt-0.5 font-mono text-right"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Moneda</label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as "PEN" | "USD")}
              >
                <SelectTrigger className="mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEN">PEN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Inicio</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-0.5"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">
                Fin estimado
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-0.5"
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-[11px] text-muted-foreground">Notas</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas…"
              rows={2}
              className="mt-0.5 resize-y"
            />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground/60">
            Se crea como{" "}
            <span className="text-muted-foreground">Prospecto</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? "Creando…" : "Crear"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
