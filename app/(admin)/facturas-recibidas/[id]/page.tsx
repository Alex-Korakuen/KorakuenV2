import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getIncomingInvoice } from "@/app/actions/incoming-invoices";
import { getProject } from "@/app/actions/projects";
import { TopBar } from "@/components/app-shell/top-bar";
import { IncomingInvoiceForm } from "../_components/incoming-invoice-form";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function FacturaRecibidaDetailPage({ params }: Props) {
  const { id } = await params;
  const result = await getIncomingInvoice(id);
  if (!result.success) notFound();

  const invoice = result.data;
  let initialProject = undefined;
  if (invoice.project_id) {
    const projectResult = await getProject(invoice.project_id);
    if (projectResult.success) initialProject = projectResult.data;
  }

  return (
    <div>
      <TopBar
        left={
          <Link
            href="/facturas-recibidas"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Facturas recibidas
          </Link>
        }
      />
      <IncomingInvoiceForm
        invoice={invoice}
        existingLineItems={invoice.line_items}
        initialProject={initialProject}
        initialVendorId={invoice.contact_id}
      />
    </div>
  );
}
