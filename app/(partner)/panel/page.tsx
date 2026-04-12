import { Construction } from "lucide-react";
import { TopBar } from "@/components/app-shell/top-bar";

export default function PartnerPanel() {
  return (
    <div>
      <TopBar variant="partner" />
      <div className="px-8 py-8">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground">
            Panel de socio
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bienvenido al sistema Korakuen.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Construction className="h-8 w-8 text-muted-foreground/40" />
          <h3 className="text-sm font-medium text-foreground">
            En construcción
          </h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Pronto podrás ver tus proyectos asignados, costos y liquidaciones
            desde esta pantalla.
          </p>
        </div>
      </div>
    </div>
  );
}
