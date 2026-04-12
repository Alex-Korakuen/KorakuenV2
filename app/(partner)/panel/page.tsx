import { Construction } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/app-shell/page-header";

export default function PartnerPanel() {
  return (
    <div>
      <PageHeader
        title="Panel de socio"
        description="Bienvenido al sistema Korakuen."
      />
      <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <Construction className="h-6 w-6" />
        </div>
        <h3 className="text-base font-semibold text-slate-900">
          En construcción
        </h3>
        <p className="max-w-md text-sm text-slate-500">
          Pronto podrás ver tus proyectos asignados, costos y liquidaciones desde
          esta pantalla.
        </p>
      </Card>
    </div>
  );
}
