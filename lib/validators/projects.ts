import {
  withinTolerance,
  success,
  failure,
} from "@/lib/types";
import type {
  ValidationResult,
  ProjectRow,
  ProjectPartnerRow,
  CreateProjectInput,
} from "@/lib/types";
import { assertTransition } from "@/lib/lifecycle";
import { validateCurrencyExchangeRate } from "./shared";

// ---------------------------------------------------------------------------
// Profit split validation
// ---------------------------------------------------------------------------

/**
 * Validate that profit splits across all partners sum to 100% (within tolerance).
 */
export function validateProfitSplits(
  partners: ProjectPartnerRow[],
): ValidationResult<void> {
  if (partners.length === 0) {
    return failure("VALIDATION_ERROR", "Project must have at least one partner", {
      partners: "No partners assigned to this project",
    });
  }

  const sum = partners.reduce((acc, p) => acc + p.profit_split_pct, 0);

  if (!withinTolerance(sum, 100)) {
    return failure("VALIDATION_ERROR", "Profit splits must sum to 100%", {
      profit_split_pct: `Splits sum to ${sum.toFixed(2)}%, must equal 100%`,
    });
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Project activation validation
// ---------------------------------------------------------------------------

/**
 * Validate all preconditions for transitioning a project from prospect to active.
 * Checks: contract fields populated, partners assigned, splits sum to 100.
 */
export function validateProjectActivation(
  project: ProjectRow,
  partners: ProjectPartnerRow[],
): ValidationResult<void> {
  const fields: Record<string, string> = {};

  // Status transition must be valid
  const transitionResult = assertTransition("project", project.status, 2);
  if (!transitionResult.success) {
    return transitionResult;
  }

  // Contract fields must be populated
  if (project.contract_value == null) {
    fields.contract_value = "Required before activation";
  }

  if (!project.contract_currency) {
    fields.contract_currency = "Required before activation";
  }

  if (
    project.contract_currency === "USD" &&
    project.contract_exchange_rate == null
  ) {
    fields.contract_exchange_rate =
      "Required when contract currency is USD";
  }

  if (!project.signed_date) {
    fields.signed_date = "Required before activation";
  }

  // Partners must exist and splits must sum to 100
  const splitsResult = validateProfitSplits(partners);
  if (!splitsResult.success) {
    Object.assign(fields, splitsResult.error.fields);
  }

  if (Object.keys(fields).length > 0) {
    return failure(
      "VALIDATION_ERROR",
      "Project cannot be activated — missing required fields",
      fields,
    );
  }

  return success(undefined);
}

// ---------------------------------------------------------------------------
// Project create validation
// ---------------------------------------------------------------------------

/**
 * Validate data for creating a new project.
 */
export function validateCreateProject(
  data: CreateProjectInput,
): ValidationResult<CreateProjectInput> {
  const fields: Record<string, string> = {};

  if (!data.name?.trim()) {
    fields.name = "Required";
  }

  if (!data.client_id) {
    fields.client_id = "Required";
  }

  // Currency — reuse shared helper with field name mapping
  const currencyErrors = validateCurrencyExchangeRate(
    data.contract_currency,
    data.contract_value != null ? data.contract_exchange_rate : 1,
  );
  if (currencyErrors.currency) fields.contract_currency = currencyErrors.currency;
  if (currencyErrors.exchange_rate) {
    fields.contract_exchange_rate =
      "Required when contract currency is USD and contract value is set";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Project validation failed", fields);
  }

  return success(data);
}

/**
 * Validate data for updating an existing project.
 */
export function validateUpdateProject(
  data: Partial<CreateProjectInput>,
): ValidationResult<Partial<CreateProjectInput>> {
  const fields: Record<string, string> = {};

  if ("name" in data && !data.name?.trim()) {
    fields.name = "Cannot be empty";
  }

  if ("contract_currency" in data) {
    const currency = data.contract_currency ?? "PEN";
    if (currency !== "PEN" && currency !== "USD") {
      fields.contract_currency = "Must be PEN or USD";
    }
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Project update validation failed", fields);
  }

  return success(data);
}
