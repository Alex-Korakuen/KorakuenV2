// ---------------------------------------------------------------------------
// Shared validation helpers — import from here, never rewrite these patterns
// ---------------------------------------------------------------------------

/**
 * Validate currency is PEN or USD, and that exchange_rate is provided for USD.
 */
export function validateCurrencyExchangeRate(
  currency: string | undefined,
  exchange_rate: number | null | undefined,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const cur = currency ?? "PEN";
  if (cur !== "PEN" && cur !== "USD") {
    fields.currency = "Must be PEN or USD";
  }
  if (cur === "USD" && !exchange_rate) {
    fields.exchange_rate = "Required when currency is USD";
  }
  return fields;
}

/**
 * Validate that detraction_rate and detraction_amount are both provided or both absent.
 */
export function validateDetractionConsistency(
  rate: number | null | undefined,
  amount: number | null | undefined,
): Record<string, string> {
  const fields: Record<string, string> = {};
  const hasRate = rate != null;
  const hasAmount = amount != null;
  if (hasRate !== hasAmount) {
    fields.detraction_rate =
      "Both detraction_rate and detraction_amount must be provided, or neither";
    fields.detraction_amount =
      "Both detraction_rate and detraction_amount must be provided, or neither";
  }
  return fields;
}

/**
 * Validate that none of the listed fields have been changed from their existing values.
 * Use for fields that are immutable after creation.
 *
 * @param data - The incoming update payload
 * @param immutableFields - List of field names that cannot change
 * @param existing - The current row from the database (optional — if omitted, any presence of the field is rejected)
 */
export function validateImmutableFields<T extends Record<string, unknown>>(
  data: Record<string, unknown>,
  immutableFields: (keyof T)[],
  existing?: Partial<T>,
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of immutableFields) {
    if (field in data) {
      if (existing && data[field as string] === existing[field]) continue;
      fields[String(field)] = `Cannot modify ${String(field)} after creation`;
    }
  }
  return fields;
}
