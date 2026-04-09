import { TIPO_PERSONA } from "@/lib/types";

// ---------------------------------------------------------------------------
// Decolecta API response types
// ---------------------------------------------------------------------------

type DecolectaRucResponse = {
  razon_social: string;
  numero_documento: string;
  estado: string;
  condicion: string;
  direccion: string;
  distrito: string;
  provincia: string;
  departamento: string;
  ubigeo: string;
};

type DecolectaDniResponse = {
  full_name: string;
  first_name: string;
  first_last_name: string;
  second_last_name: string;
  document_number: string;
};

// ---------------------------------------------------------------------------
// Lookup result type
// ---------------------------------------------------------------------------

export type LookupResult = {
  tipo_persona: number;
  ruc: string | null;
  dni: string | null;
  razon_social: string;
  address: string | null;
  sunat_estado: string | null;
  sunat_condicion: string | null;
  warning: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDecolectaToken(): string {
  const token = process.env.DECOLECTA_TOKEN;
  if (!token) {
    throw new Error("DECOLECTA_TOKEN environment variable is not set");
  }
  return token;
}

function buildAddress(data: DecolectaRucResponse): string {
  const parts = [
    data.direccion,
    data.distrito,
    data.provincia,
    data.departamento,
  ].filter(Boolean);
  return parts.join(", ");
}

function checkWarnings(
  estado: string | null,
  condicion: string | null,
): string | null {
  const warnings: string[] = [];

  if (estado && estado !== "ACTIVO") {
    warnings.push(`estado ${estado}`);
  }
  if (condicion && condicion !== "HABIDO") {
    warnings.push(`condicion ${condicion}`);
  }

  if (warnings.length === 0) return null;

  return `Este contribuyente tiene ${warnings.join(" y ")} en SUNAT. ¿Desea continuar?`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a RUC number against the SUNAT padron via the decolecta API.
 * Returns a pre-filled contact object (not yet saved).
 *
 * Throws on network errors.
 * Returns a result with warning for inactive/non-habido contacts.
 */
export async function lookupRuc(ruc: string): Promise<LookupResult> {
  const token = getDecolectaToken();

  const res = await fetch(
    `https://api.decolecta.com/v1/sunat/ruc?numero=${encodeURIComponent(ruc)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("RUC no encontrado en el padron SUNAT");
    }
    throw new Error(`Decolecta API error: ${res.status} ${res.statusText}`);
  }

  const data: DecolectaRucResponse = await res.json();

  // RUCs starting with "20" are juridica (companies), others are natural persons
  const tipo_persona = ruc.startsWith("20")
    ? TIPO_PERSONA.juridica
    : TIPO_PERSONA.natural;

  return {
    tipo_persona,
    ruc,
    dni: null,
    razon_social: data.razon_social,
    address: buildAddress(data),
    sunat_estado: data.estado,
    sunat_condicion: data.condicion,
    warning: checkWarnings(data.estado, data.condicion),
  };
}

/**
 * Look up a DNI number against the RENIEC padron via the decolecta API.
 * Returns a pre-filled contact object (not yet saved).
 *
 * Throws on network errors.
 */
export async function lookupDni(dni: string): Promise<LookupResult> {
  const token = getDecolectaToken();

  const res = await fetch(
    `https://api.decolecta.com/v1/reniec/dni?numero=${encodeURIComponent(dni)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("DNI no encontrado en el padron RENIEC");
    }
    throw new Error(`Decolecta API error: ${res.status} ${res.statusText}`);
  }

  const data: DecolectaDniResponse = await res.json();

  return {
    tipo_persona: TIPO_PERSONA.natural,
    ruc: null,
    dni,
    razon_social: data.full_name,
    address: null,
    sunat_estado: null,
    sunat_condicion: null,
    warning: null,
  };
}

/**
 * Check if SUNAT estado/condicion warrant a user warning.
 * Returns a warning string (in Spanish) or null if no warning.
 * This is NOT a validation error — it is surfaced for user confirmation.
 */
export { checkWarnings as checkSunatWarnings };
