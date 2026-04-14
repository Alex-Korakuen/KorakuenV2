import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getOutgoingInvoice } from "@/app/actions/outgoing-invoices";
import { getProject } from "@/app/actions/projects";
import { TopBar } from "@/components/app-shell/top-bar";
import { OutgoingInvoiceForm } from "../_components/outgoing-invoice-form";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function FacturaEmitidaDetailPage({ params }: Props) {
  const { id } = await params;
  const result = await getOutgoingInvoice(id);
  if (!result.success) notFound();

  const invoice = result.data;
  const projectResult = await getProject(invoice.project_id);
  const initialProject = projectResult.success ? projectResult.data : undefined;

  return (
    <div>
      <TopBar
        left={
          <Link
            href="/facturas-emitidas"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Facturas emitidas
          </Link>
        }
      />
      <OutgoingInvoiceForm
        invoice={invoice}
        existingLineItems={invoice.line_items}
        initialProject={initialProject}
      />
    </div>
  );
}
