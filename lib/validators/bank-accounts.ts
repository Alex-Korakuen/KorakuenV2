import { ACCOUNT_TYPE, success, failure } from "@/lib/types";
import type {
  ValidationResult,
  CreateBankAccountInput,
  UpdateBankAccountInput,
  BankAccountRow,
} from "@/lib/types";
import { validateImmutableFields } from "./shared";

// ---------------------------------------------------------------------------
// Create validation
// ---------------------------------------------------------------------------

export function validateCreateBankAccount(
  data: CreateBankAccountInput,
): ValidationResult<CreateBankAccountInput> {
  const fields: Record<string, string> = {};

  const name = data.name?.trim();
  if (!name) {
    fields.name = "Required";
  }

  const bankName = data.bank_name?.trim();
  if (!bankName) {
    fields.bank_name = "Required";
  }

  if (data.currency !== "PEN" && data.currency !== "USD") {
    fields.currency = "Must be PEN or USD";
  }

  const accountType = data.account_type ?? ACCOUNT_TYPE.regular;
  if (
    accountType !== ACCOUNT_TYPE.regular &&
    accountType !== ACCOUNT_TYPE.banco_de_la_nacion
  ) {
    fields.account_type = "Must be 1 (regular) or 2 (banco_de_la_nacion)";
  }

  // DB constraint: bn_always_pen
  if (
    accountType === ACCOUNT_TYPE.banco_de_la_nacion &&
    data.currency !== "PEN"
  ) {
    fields.currency =
      "Banco de la Nacion accounts must use PEN";
  }

  if (Object.keys(fields).length > 0) {
    return failure(
      "VALIDATION_ERROR",
      "Bank account validation failed",
      fields,
    );
  }

  return success({
    name: name!,
    bank_name: bankName!,
    account_number: data.account_number ?? null,
    currency: data.currency,
    account_type: accountType,
    notes: data.notes ?? null,
  });
}

// ---------------------------------------------------------------------------
// Update validation
// ---------------------------------------------------------------------------

const IMMUTABLE_BANK_ACCOUNT_FIELDS: (keyof BankAccountRow)[] = [
  "currency",
  "account_type",
];

const ALLOWED_FIELDS: (keyof UpdateBankAccountInput)[] = [
  "name",
  "bank_name",
  "account_number",
  "is_active",
  "notes",
];

export function validateUpdateBankAccount(
  data: Record<string, unknown>,
  _existing: BankAccountRow,
): ValidationResult<Partial<UpdateBankAccountInput>> {
  // Reject immutable fields
  const immutableErrors = validateImmutableFields<BankAccountRow>(
    data,
    IMMUTABLE_BANK_ACCOUNT_FIELDS,
  );
  if (Object.keys(immutableErrors).length > 0) {
    const field = Object.keys(immutableErrors)[0];
    return failure(
      "IMMUTABLE_FIELD",
      `Field '${field}' cannot be changed after creation`,
      immutableErrors,
    );
  }

  // Filter to allowed fields only
  const updates: Partial<UpdateBankAccountInput> = {};

  for (const key of ALLOWED_FIELDS) {
    if (key in data) {
      const value = data[key];

      if (key === "name" || key === "bank_name") {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) {
          return failure("VALIDATION_ERROR", `${key} cannot be empty`, {
            [key]: "Cannot be empty",
          });
        }
        (updates as Record<string, unknown>)[key] = trimmed;
      } else {
        (updates as Record<string, unknown>)[key] = value;
      }
    }
  }

  return success(updates);
}
