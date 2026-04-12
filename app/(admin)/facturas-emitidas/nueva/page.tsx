import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TopBar } from "@/components/app-shell/top-bar";
import { ExchangeRateChip } from "@/components/app-shell/exchange-rate-chip";
import { OutgoingInvoiceForm } from "../_components/outgoing-invoice-form";

export default function NuevaFacturaEmitidaPage() {
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
        right={<ExchangeRateChip />}
      />
      <OutgoingInvoiceForm />
    </div>
  );
}
