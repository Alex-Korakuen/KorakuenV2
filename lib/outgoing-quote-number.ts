/**
 * Outgoing quote number generator — COT-YYYY-NNNN format.
 *
 * Year is derived from Lima local time. Sequence is zero-padded to 4
 * digits and resets each calendar year. The next number is computed by
 * scanning the max existing number for the current year's prefix.
 *
 * A UNIQUE constraint on outgoing_quotes.quote_number (migration
 * 20260410000002) catches concurrent-generation collisions. The server
 * action retries once on collision; if the second attempt also loses,
 * it surfaces a CONFLICT error.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const PREFIX = "COT";
const SEQUENCE_PAD = 4;

/**
 * Return the current year in Lima local time. Separate from
 * JavaScript's local time so the year rollover lands at midnight Lima
 * regardless of where the server happens to run.
 */
function currentLimaYear(): number {
  const limaIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });
  return parseInt(limaIso.slice(0, 4), 10);
}

/**
 * Compute the next outgoing quote number for the current year.
 * Reads the max existing COT-{year}-* number and increments.
 *
 * Returns a string like "COT-2026-0015".
 */
export async function generateNextOutgoingQuoteNumber(
  supabase: SupabaseClient,
): Promise<string> {
  const year = currentLimaYear();
  const prefix = `${PREFIX}-${year}-`;

  const { data, error } = await supabase
    .from("outgoing_quotes")
    .select("quote_number")
    .like("quote_number", `${prefix}%`)
    .order("quote_number", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(
      `Failed to query outgoing_quotes for next number: ${error.message}`,
    );
  }

  let nextN = 1;
  if (data && data.length > 0 && data[0].quote_number) {
    const match = /^COT-\d{4}-(\d+)$/.exec(data[0].quote_number);
    if (match) {
      nextN = parseInt(match[1], 10) + 1;
    }
  }

  return `${prefix}${String(nextN).padStart(SEQUENCE_PAD, "0")}`;
}

/**
 * Parse an outgoing quote number into its component year and sequence.
 * Returns null if the string doesn't match the canonical format.
 */
export function parseOutgoingQuoteNumber(
  quoteNumber: string,
): { year: number; sequence: number } | null {
  const match = /^COT-(\d{4})-(\d+)$/.exec(quoteNumber);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    sequence: parseInt(match[2], 10),
  };
}
