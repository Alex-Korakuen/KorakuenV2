"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { updateContact, deleteContact } from "@/app/actions/contacts";
import { InlineField } from "./inline-field";
import { toast } from "sonner";
import type { ContactRow } from "@/lib/types";

type Props = {
  contact: ContactRow;
};

export function MetadataCard({ contact }: Props) {
  const router = useRouter();
  const [roles, setRoles] = useState({
    is_client: contact.is_client,
    is_vendor: contact.is_vendor,
    is_partner: contact.is_partner,
  });
  const [deleting, setDeleting] = useState(false);

  async function toggleRole(key: "is_client" | "is_vendor" | "is_partner") {
    const newValue = !roles[key];
    setRoles((r) => ({ ...r, [key]: newValue }));
    const result = await updateContact(contact.id, { [key]: newValue });
    if (!result.success) {
      setRoles((r) => ({ ...r, [key]: !newValue }));
      toast.error(result.error.message);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteContact(contact.id);
    setDeleting(false);
    if (result.success) {
      toast.success("Contacto eliminado");
      router.push("/contactos");
      router.refresh();
    } else {
      toast.error(result.error.message);
    }
  }

  return (
    <div
      className="rounded-lg bg-card p-5"
      style={{ border: "1px solid var(--border)" }}
    >
      {/* Row 1: Name + badges + roles + delete */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">
          {contact.razon_social}
        </h2>
        {contact.is_self && (
          <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[11px] font-medium text-primary">
            Nuestra empresa
          </span>
        )}
        {roles.is_client && (
          <span className="inline-flex h-5 items-center rounded-full bg-sky-50 px-2 text-[11px] font-medium text-sky-700">
            Cliente
          </span>
        )}
        {roles.is_vendor && (
          <span className="inline-flex h-5 items-center rounded-full bg-amber-50 px-2 text-[11px] font-medium text-amber-700">
            Proveedor
          </span>
        )}
        {roles.is_partner && (
          <span className="inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">
            Socio
          </span>
        )}

        <span className="mx-0.5 text-border">|</span>

        {(
          [
            ["is_client", "Cliente"],
            ["is_vendor", "Proveedor"],
            ["is_partner", "Socio"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={roles[key]}
              onChange={() => void toggleRole(key)}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
            <span className="text-xs text-foreground/70">{label}</span>
          </label>
        ))}

        {!contact.is_self && (
          <div className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground/30 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Eliminar contacto</AlertDialogTitle>
                  <AlertDialogDescription>
                    ¿Estás seguro de que deseas eliminar a{" "}
                    {contact.razon_social}? Esta acción es reversible pero no
                    se puede ejecutar si el contacto tiene facturas, proyectos o
                    pagos activos.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting ? "Eliminando…" : "Eliminar"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Row 2: RUC/DNI */}
      <p className="mt-1 font-mono text-xs text-muted-foreground">
        {contact.ruc ? `RUC ${contact.ruc}` : contact.dni ? `DNI ${contact.dni}` : "—"}
      </p>

      {/* Row 3: Contact fields — horizontal, inline editable */}
      <div
        className="mt-4 grid grid-cols-3 gap-0"
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: "12px",
        }}
      >
        <div style={{ borderRight: "1px solid var(--border)" }}>
          <InlineField
            label="Email"
            value={contact.email}
            fieldName="email"
            contactId={contact.id}
            type="email"
          />
        </div>
        <div style={{ borderRight: "1px solid var(--border)" }}>
          <InlineField
            label="Teléfono"
            value={contact.phone}
            fieldName="phone"
            contactId={contact.id}
            type="tel"
          />
        </div>
        <div>
          <InlineField
            label="Dirección"
            value={contact.address}
            fieldName="address"
            contactId={contact.id}
          />
        </div>
      </div>
    </div>
  );
}
