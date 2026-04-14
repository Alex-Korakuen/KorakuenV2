import { AlertTriangle, Check, X } from "lucide-react";
import { SUBMISSION_STATUS } from "@/lib/types";

type Props = {
  reviewStatus: number;
  errorCount: number;
};

/**
 * Status pill rendered in the Estado column of the inbox table.
 * Handles all four states correctly:
 *
 *   - Pending + no errors → green "Válido"
 *   - Pending + errors    → amber "N errores"
 *   - Approved            → blue  "Aprobada"
 *   - Rejected            → grey  "Rechazada"
 *
 * Centralized so the table doesn't grow nested ternaries every time we
 * add a state.
 */
export function SubmissionStatusPill({ reviewStatus, errorCount }: Props) {
  if (reviewStatus === SUBMISSION_STATUS.approved) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
        <Check className="h-3 w-3" />
        Aprobada
      </span>
    );
  }

  if (reviewStatus === SUBMISSION_STATUS.rejected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">
        <X className="h-3 w-3" />
        Rechazada
      </span>
    );
  }

  // Pending — branch on validation
  if (errorCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        <AlertTriangle className="h-3 w-3" />
        {errorCount} {errorCount === 1 ? "error" : "errores"}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <Check className="h-3 w-3" />
      Válido
    </span>
  );
}
