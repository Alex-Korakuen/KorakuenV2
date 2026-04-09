import { createServiceClient } from "@/lib/db";
import { failure, success } from "@/lib/types";
import type { ValidationResult } from "@/lib/types";

type ExchangeRateResult = {
  rate: number;
  rate_date: string;
};

/**
 * Look up the exchange rate for a given date.
 *
 * Uses the fallback rule from schema-reference.md: if no rate exists for the
 * exact date, returns the most recent rate on or before that date.
 * This handles weekends naturally (Friday's rate covers Saturday and Sunday).
 *
 * Returns null if no rate exists at all.
 */
export async function getExchangeRate(
  date: Date,
  rateType: string = "promedio",
): Promise<ExchangeRateResult | null> {
  const supabase = createServiceClient();
  const dateStr = date.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("exchange_rates")
    .select("rate, rate_date")
    .eq("base_currency", "USD")
    .eq("target_currency", "PEN")
    .eq("rate_type", rateType)
    .lte("rate_date", dateStr)
    .order("rate_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return { rate, rate_date: data.rate_date };
}

/**
 * Same as getExchangeRate but returns a validation error if no rate is found.
 * Use in validators and server actions that cannot proceed without a rate.
 */
export async function requireExchangeRate(
  date: Date,
  rateType: string = "promedio",
): Promise<ValidationResult<ExchangeRateResult>> {
  const result = await getExchangeRate(date, rateType);

  if (!result) {
    const dateStr = date.toISOString().split("T")[0];
    return failure(
      "VALIDATION_ERROR",
      `No hay tipo de cambio disponible para ${dateStr}. Registre el tipo de cambio manualmente.`,
      { exchange_rate: `No exchange rate found for ${dateStr} or earlier` },
    );
  }

  return success(result);
}

/**
 * Convert an amount to PEN using a given exchange rate.
 * Pure function — no database call.
 */
export function convertToSoles(amount: number, exchangeRate: number): number {
  return Math.round(amount * exchangeRate * 100) / 100;
}
