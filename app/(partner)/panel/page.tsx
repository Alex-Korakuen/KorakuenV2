import { Construction } from "lucide-react";

export default function PartnerPanel() {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-stone-900">Panel de socio</h2>
        <p className="mt-1 text-sm text-stone-400">
          Bienvenido al sistema Korakuen.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Construction className="h-8 w-8 text-stone-300" />
        <h3 className="text-sm font-medium text-stone-900">En construcción</h3>
        <p className="max-w-md text-sm text-stone-400">
          Pronto podrás ver tus proyectos asignados, costos y liquidaciones
          desde esta pantalla.
        </p>
      </div>
    </div>
  );
}
