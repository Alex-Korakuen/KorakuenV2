import { success, failure } from "@/lib/types";
import type {
  ValidationResult,
  CreateProjectPartnerInput,
} from "@/lib/types";

/**
 * Validate the shape of a single project partner input row.
 * Pure field-level checks — does not touch the database.
 */
export function validateProjectPartnerInput(
  data: CreateProjectPartnerInput,
): ValidationResult<CreateProjectPartnerInput> {
  const fields: Record<string, string> = {};

  if (!data.contact_id) {
    fields.contact_id = "Required";
  }
  if (!data.company_label?.trim()) {
    fields.company_label = "Required";
  }
  if (
    data.profit_split_pct == null ||
    data.profit_split_pct <= 0 ||
    data.profit_split_pct > 100
  ) {
    fields.profit_split_pct = "Must be greater than 0 and at most 100";
  }

  if (Object.keys(fields).length > 0) {
    return failure("VALIDATION_ERROR", "Partner validation failed", fields);
  }

  return success(data);
}
