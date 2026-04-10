import {
  TIPO_PERSONA,
  success,
  failure,
} from "@/lib/types";
import type {
  ValidationResult,
  CreateContactInput,
  UpdateContactInput,
  ContactRow,
} from "@/lib/types";
import { validateImmutableFields } from "./shared";

/**
 * Validate RUC format: exactly 11 digits, all numeric.
 */
export function validateRuc(ruc: string): ValidationResult<string> {
  const cleaned = ruc.trim();
  if (!/^\d{11}$/.test(cleaned)) {
    return failure("VALIDATION_ERROR", "RUC must be exactly 11 digits", {
      ruc: "Must be exactly 11 numeric digits",
    });
  }
  return success(cleaned);
}

/**
 * Validate DNI format: exactly 8 digits, all numeric.
 */
export function validateDni(dni: string): ValidationResult<string> {
  const cleaned = dni.trim();
  if (!/^\d{8}$/.test(cleaned)) {
    return failure("VALIDATION_ERROR", "DNI must be exactly 8 digits", {
      dni: "Must be exactly 8 numeric digits",
    });
  }
  return success(cleaned);
}

/**
 * Validate data for creating a new contact.
 * Contacts must be SUNAT/RENIEC-verified before creation.
 */
export function validateCreateContact(
  data: CreateContactInput,
): ValidationResult<CreateContactInput> {
  const fields: Record<string, string> = {};

  // At least one identifier required (DB constraint: contact_has_identifier)
  if (!data.ruc && !data.dni) {
    fields.ruc = "Either RUC or DNI is required";
    fields.dni = "Either RUC or DNI is required";
  }

  // Validate identifier formats
  if (data.ruc) {
    const rucResult = validateRuc(data.ruc);
    if (!rucResult.success) {
      fields.ruc = rucResult.error.fields?.ruc ?? "Invalid RUC format";
    }
  }

  if (data.dni) {
    const dniResult = validateDni(data.dni);
    if (!dniResult.success) {
      fields.dni = dniResult.error.fields?.dni ?? "Invalid DNI format";
    }
  }

  // SUNAT verification is mandatory (DB constraint: contact_must_be_verified)
  if (!data.sunat_verified) {
    fields.sunat_verified =
      "Contact must be verified against SUNAT/RENIEC before creation";
  }

  if (!data.sunat_verified_at) {
    fields.sunat_verified_at = "Verification timestamp is required";
  }

  // razon_social is required
  if (!data.razon_social?.trim()) {
    fields.razon_social = "Razon social is required";
  }

  // tipo_persona must be valid
  if (
    data.tipo_persona !== TIPO_PERSONA.natural &&
    data.tipo_persona !== TIPO_PERSONA.juridica
  ) {
    fields.tipo_persona = "Must be 1 (natural) or 2 (juridica)";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Contact validation failed", fields);
  }

  return success(data);
}

/**
 * Validate data for updating an existing contact.
 * Blocks changes to immutable fields (ruc, dni, razon_social, tipo_persona, sunat_* fields).
 */
export function validateUpdateContact(
  data: Record<string, unknown>,
  existing: ContactRow,
): ValidationResult<UpdateContactInput> {
  // Immutable fields — block if present and different from existing.
  // is_self is set only by scripts/seed-self-contact.ts and never via CRUD.
  const immutableErrors = validateImmutableFields<ContactRow>(
    data,
    [
      "ruc",
      "dni",
      "razon_social",
      "tipo_persona",
      "sunat_estado",
      "sunat_condicion",
      "sunat_verified",
      "sunat_verified_at",
      "is_self",
    ],
    existing,
  );

  if (Object.keys(immutableErrors).length > 0) {
    return failure("IMMUTABLE_FIELD", "Cannot modify locked fields", immutableErrors);
  }

  // Extract only editable fields
  const update: UpdateContactInput = {};
  if ("nombre_comercial" in data)
    update.nombre_comercial = data.nombre_comercial as string | null;
  if ("is_client" in data) update.is_client = data.is_client as boolean;
  if ("is_vendor" in data) update.is_vendor = data.is_vendor as boolean;
  if ("is_partner" in data) update.is_partner = data.is_partner as boolean;
  if ("email" in data) update.email = data.email as string | null;
  if ("phone" in data) update.phone = data.phone as string | null;
  if ("address" in data) update.address = data.address as string | null;
  if ("notes" in data) update.notes = data.notes as string | null;

  return success(update);
}

// checkSunatWarnings lives in lib/sunat.ts — import from there, not here
