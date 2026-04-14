import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getContact, getContactHistorial } from "@/app/actions/contacts";
import { TopBar } from "@/components/app-shell/top-bar";
import { MetadataCard } from "./_components/metadata-card";
import { NotesSection } from "./_components/notes-section";
import { HistorialSection } from "./_components/historial-section";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ContactDetailPage({ params }: Props) {
  const { id } = await params;

  const contactResult = await getContact(id);
  if (!contactResult.success) notFound();
  const contact = contactResult.data;

  const historialResult = await getContactHistorial(id);
  const historial = historialResult.success
    ? historialResult.data
    : { por_cobrar: null, por_pagar: null, items: [] };

  return (
    <div>
      <TopBar
        left={
          <Link
            href="/contactos"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Contactos
          </Link>
        }
      />

      <div className="px-8 py-8">
        <MetadataCard contact={contact} />

        <div className="mt-6">
          <NotesSection contactId={contact.id} initialNotes={contact.notes} />
        </div>

        <HistorialSection historial={historial} />
      </div>
    </div>
  );
}
