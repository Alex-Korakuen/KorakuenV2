/**
 * Coerce raw Next.js searchParams into typed list-page filters.
 * Used by every Server Component that renders a paginated list.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type ParsedListParams = {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  raw: RawSearchParams;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function pickFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function toPositiveInt(raw: string, fallback: number, max?: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

export function parseSearchParams(raw: RawSearchParams): ParsedListParams {
  return {
    page: toPositiveInt(pickFirst(raw.page), DEFAULT_PAGE),
    pageSize: toPositiveInt(
      pickFirst(raw.page_size),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    ),
    search: pickFirst(raw.search).trim(),
    status: pickFirst(raw.status).trim(),
    raw,
  };
}

/**
 * Build a query string for pagination links by merging the current params
 * with overrides. Returns "?key=value&..." (or "" if empty).
 */
export function buildSearchParamsString(
  current: RawSearchParams,
  overrides: Record<string, string | number | null | undefined>,
): string {
  const merged = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    const v = pickFirst(value);
    if (v) merged.set(key, v);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined || value === "") {
      merged.delete(key);
    } else {
      merged.set(key, String(value));
    }
  }
  const str = merged.toString();
  return str ? `?${str}` : "";
}

export function paginationOffset(page: number, pageSize: number): number {
  return Math.max(0, (page - 1) * pageSize);
}
