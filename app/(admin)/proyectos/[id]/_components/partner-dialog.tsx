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
import { ContactPicker } from "@/components/widgets/contact-picker";
import {
  upsertProjectPartner,
  removeProjectPartner,
} from "@/app/actions/project-partners";
import type { ProjectPartnerRow } from "@/lib/types";
import { toast } from "sonner";

type Props = {
  children: ReactNode;
  projectId: string;
  partner?: ProjectPartnerRow;
};

export function PartnerDialog({ children, projectId, partner }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!partner;

  const [contactId, setContactId] = useState<string | null>(
    partner?.contact_id ?? null,
  );
  const [companyLabel, setCompanyLabel] = useState(partner?.company_label ?? "");
  const [profitPct, setProfitPct] = useState(
    partner ? String(partner.profit_split_pct) : "",
  );

  function reset() {
    setContactId(partner?.contact_id ?? null);
    setCompanyLabel(partner?.company_label ?? "");
    setProfitPct(partner ? String(partner.profit_split_pct) : "");
  }

  async function handleSave() {
    if (!contactId) {
      toast.error("Selecciona un socio");
      return;
    }
    if (!companyLabel.trim()) {
      toast.error("Etiqueta requerida");
      return;
    }
    const pct = parseFloat(profitPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error("Porcentaje debe estar entre 0 y 100");
      return;
    }

    setSaving(true);
    const result = await upsertProjectPartner(projectId, {
      contact_id: contactId,
      company_label: companyLabel.trim(),
      profit_split_pct: pct,
    });
    setSaving(false);

    if (result.success) {
      toast.success(isEdit ? "Socio actualizado" : "Socio agregado");
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  }

  async function handleRemove() {
    if (!partner) return;
    setSaving(true);
    const result = await removeProjectPartner(projectId, partner.id);
    setSaving(false);
    if (result.success) {
      toast.success("Socio eliminado");
      setOpen(false);
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
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-sm font-semibold">
            {isEdit ? "Editar socio" : "Agregar socio"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="text-[11px] text-muted-foreground">Contacto</label>
            <ContactPicker
              value={contactId}
              onChange={setContactId}
              filter="partner"
              placeholder="Buscar socio…"
              className="mt-0.5"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Solo contactos marcados como Socio
            </p>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              Etiqueta corta
            </label>
            <Input
              value={companyLabel}
              onChange={(e) => setCompanyLabel(e.target.value)}
              placeholder="Korakuen, Andina…"
              className="mt-0.5"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Nombre corto para mostrar en las tarjetas
            </p>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              Porcentaje de utilidades
            </label>
            <div className="mt-0.5 relative">
              <Input
                value={profitPct}
                onChange={(e) =>
                  setProfitPct(e.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="50"
                className="pr-8 font-mono text-right"
                inputMode="decimal"
              />
              <span className="absolute right-3 top-2 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {isEdit ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={saving}
              className="text-destructive hover:text-destructive"
            >
              Eliminar
            </Button>
          ) : (
            <span />
          )}
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
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Guardando…" : isEdit ? "Guardar" : "Agregar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
