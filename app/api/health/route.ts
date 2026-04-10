import { createServiceClient } from "@/lib/db";
import { checkExchangeRateHealth } from "@/lib/exchange-rate";

export const dynamic = "force-dynamic";

export async function GET() {
  // Database check
  const supabase = createServiceClient();
  const { error: dbError } = await supabase
    .from("exchange_rates")
    .select("id")
    .limit(1);
  const dbOk = !dbError;

  // Exchange rate check
  const exchangeRate = await checkExchangeRateHealth();

  // Overall status
  let status: "ok" | "degraded" | "down";
  if (!dbOk) {
    status = "down";
  } else if (!exchangeRate.ok) {
    status = "degraded";
  } else {
    status = "ok";
  }

  return Response.json(
    {
      status,
      checks: {
        database: { ok: dbOk },
        exchange_rate: exchangeRate,
      },
    },
    { status: status === "down" ? 503 : 200 },
  );
}
