import { checkExchangeRateHealth } from "@/lib/exchange-rate";

type Props = {
  variant: "admin" | "partner";
};

export async function ExchangeRateBanner({ variant }: Props) {
  const health = await checkExchangeRateHealth();

  if (health.ok) return null;

  if (variant === "admin") {
    return (
      <div className="flex items-center justify-between bg-red-600 px-6 py-3 text-sm text-white">
        <span>
          Tipo de cambio no disponible para hoy. Los montos en USD no pueden
          convertirse.
        </span>
        {/* TODO: link to /dashboard/settings/exchange-rates once Step 13 builds the settings UI */}
        <span className="whitespace-nowrap font-medium">
          Registrar manualmente &rarr;
        </span>
      </div>
    );
  }

  return (
    <div className="border-b border-yellow-300 bg-yellow-100 px-6 py-3 text-sm text-yellow-800">
      Tipo de cambio no disponible para hoy. Los montos en USD podr&iacute;an no
      estar actualizados.
    </div>
  );
}
