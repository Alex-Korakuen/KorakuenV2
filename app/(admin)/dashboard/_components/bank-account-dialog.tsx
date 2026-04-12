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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createBankAccount,
  updateBankAccount,
} from "@/app/actions/bank-accounts";
import { ACCOUNT_TYPE } from "@/lib/types";
import type { BankAccountRow } from "@/lib/types";
import { toast } from "sonner";

type Props = {
  children: ReactNode;
  mode: "create" | "edit";
  account?: BankAccountRow;
};

export function BankAccountDialog({ children, mode, account }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(account?.name ?? "");
  const [bankName, setBankName] = useState(account?.bank_name ?? "");
  const [accountNumber, setAccountNumber] = useState(
    account?.account_number ?? "",
  );
  const [currency, setCurrency] = useState<"PEN" | "USD">(
    (account?.currency as "PEN" | "USD") ?? "PEN",
  );
  const [accountType, setAccountType] = useState<number>(
    account?.account_type ?? ACCOUNT_TYPE.regular,
  );

  function resetForm() {
    setName(account?.name ?? "");
    setBankName(account?.bank_name ?? "");
    setAccountNumber(account?.account_number ?? "");
    setCurrency((account?.currency as "PEN" | "USD") ?? "PEN");
    setAccountType(account?.account_type ?? ACCOUNT_TYPE.regular);
  }

  async function handleSave() {
    if (!name.trim() || !bankName.trim()) {
      toast.error("Nombre y banco son requeridos");
      return;
    }
    if (accountNumber && !/^\d{4}$/.test(accountNumber)) {
      toast.error("Los últimos 4 dígitos deben ser exactamente 4 números");
      return;
    }

    setSaving(true);

    if (mode === "create") {
      const result = await createBankAccount({
        name: name.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim() || null,
        currency,
        account_type: accountType,
      });
      setSaving(false);
      if (result.success) {
        toast.success("Cuenta creada");
        setOpen(false);
        resetForm();
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    } else if (account) {
      const result = await updateBankAccount(account.id, {
        name: name.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim() || null,
      });
      setSaving(false);
      if (result.success) {
        toast.success("Cuenta actualizada");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    }
  }

  const isEdit = mode === "edit";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-sm font-semibold">
            {isEdit ? "Editar cuenta bancaria" : "Nueva cuenta bancaria"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Korakuen BCP Soles"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Banco</label>
            <Input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="BCP"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Últimos 4 dígitos
            </label>
            <Input
              value={accountNumber}
              onChange={(e) =>
                setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="0012"
              maxLength={4}
              inputMode="numeric"
              className="mt-1 w-24 font-mono tracking-widest"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Solo guardamos los últimos 4 dígitos por seguridad
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Moneda</label>
              <Select
                value={currency}
                onValueChange={(v) => setCurrency(v as "PEN" | "USD")}
                disabled={isEdit}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PEN">PEN (S/)</SelectItem>
                  <SelectItem value="USD">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tipo</label>
              <Select
                value={String(accountType)}
                onValueChange={(v) => setAccountType(Number(v))}
                disabled={isEdit}
              >
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={String(ACCOUNT_TYPE.regular)}>
                    Regular
                  </SelectItem>
                  <SelectItem value={String(ACCOUNT_TYPE.banco_de_la_nacion)}>
                    Banco de la Nación
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isEdit && (
            <p className="text-[11px] text-muted-foreground/60">
              Moneda y tipo no se pueden cambiar después de crear la cuenta.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
          >
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : isEdit ? "Guardar" : "Crear"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
