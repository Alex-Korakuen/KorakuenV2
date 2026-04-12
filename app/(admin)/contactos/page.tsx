import Link from "next/link";
import { Plus } from "lucide-react";
import { getContacts } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { Button } from "@/components/ui/button";
import { ContactLookupDialog } from "./_components/contact-lookup-dialog";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function pickFirst(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function ContactosPage({ searchParams }: Props) {
  const params = await searchParams;
  const search = pickFirst(params.search).trim();
  const role = pickFirst(params.role).trim();

  const filters: Record<string, unknown> = {};
  if (search) filters.search = search;
  if (role === "clientes") filters.is_client = true;
  if (role === "proveedores") filters.is_vendor = true;
  if (role === "socios") filters.is_partner = true;

  const result = await getContacts(filters);
  const contacts = result.success ? result.data.data : [];
  const total = result.success ? result.data.total : 0;

  const activeRole = role || "todos";

  return (
    <div>
      <TopBar
        left={<span className="text-sm font-medium text-muted-foreground">Contactos</span>}
        right={
          <div className="flex items-center gap-4">
            <ContactLookupDialog>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Nuevo contacto
              </Button>
            </ContactLookupDialog>
            <ExchangeRateChip />
          </div>
        }
      />

      <div className="max-w-3xl px-8 py-8">
        {/* Search + filters on one line */}
        <div className="mb-6 flex items-center gap-4">
          <form className="relative flex-1" action="/contactos" method="get">
            <input type="hidden" name="role" value={role} />
            <svg
              className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground/40"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="Buscar por nombre, RUC o DNI…"
              className="w-full rounded-lg border border-input bg-card py-2.5 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50 focus:outline-none"
            />
          </form>
          <div className="flex items-center gap-4 shrink-0 text-sm">
            {(
              [
                ["todos", "Todos"],
                ["clientes", "Clientes"],
                ["proveedores", "Proveedores"],
                ["socios", "Socios"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/contactos${key === "todos" ? "" : `?role=${key}`}${search ? `${key === "todos" ? "?" : "&"}search=${encodeURIComponent(search)}` : ""}`}
                className={
                  activeRole === key
                    ? "font-medium text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Contact list */}
        {contacts.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {search
                ? "No se encontraron contactos."
                : "Aún no hay contactos. Crea el primero."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contactos/${contact.id}`}
                className="flex items-center gap-4 rounded-lg px-3 py-4 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">
                      {contact.razon_social}
                    </p>
                    {contact.is_self && (
                      <span className="text-[11px] font-medium text-primary">
                        nuestra empresa
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {contact.ruc
                      ? `RUC ${contact.ruc}`
                      : contact.dni
                        ? `DNI ${contact.dni}`
                        : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {contact.is_client && (
                    <span className="inline-flex h-5 items-center rounded-full bg-sky-50 px-2 text-[11px] font-medium text-sky-700">
                      Cliente
                    </span>
                  )}
                  {contact.is_vendor && (
                    <span className="inline-flex h-5 items-center rounded-full bg-amber-50 px-2 text-[11px] font-medium text-amber-700">
                      Proveedor
                    </span>
                  )}
                  {contact.is_partner && (
                    <span className="inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700">
                      Socio
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Count */}
        {total > 0 && (
          <div className="mt-8 text-xs text-muted-foreground/60">
            {total} {total === 1 ? "contacto" : "contactos"}
          </div>
        )}
      </div>
    </div>
  );
}
