"use client";

import { useTransition, useState, useCallback } from "react";
import type {
  FieldValues,
  Path,
  UseFormReturn,
} from "react-hook-form";
import type { ValidationResult, ValidationError } from "@/lib/types";

/**
 * Apply a server-side ValidationResult error to a react-hook-form instance.
 * Maps each entry in `error.fields` to a field error via `form.setError`,
 * and falls back to a root error when no field map is provided.
 *
 * Backend validators already produce field-scoped errors in Spanish, so the
 * UI should only display them — never re-implement validation client-side.
 */
export function applyServerErrors<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  result: ValidationResult<unknown>,
): ValidationError | null {
  if (result.success) return null;

  const { error } = result;
  const fields = error.fields ?? {};
  const fieldEntries = Object.entries(fields);

  if (fieldEntries.length === 0) {
    form.setError("root.serverError" as Path<TFieldValues>, {
      type: "server",
      message: error.message,
    });
    return error;
  }

  for (const [field, message] of fieldEntries) {
    form.setError(field as Path<TFieldValues>, {
      type: "server",
      message,
    });
  }

  if (error.message) {
    form.setError("root.serverError" as Path<TFieldValues>, {
      type: "server",
      message: error.message,
    });
  }

  return error;
}

type ServerActionFn<TArgs extends unknown[], TData> = (
  ...args: TArgs
) => Promise<ValidationResult<TData>>;

export type UseServerActionResult<TArgs extends unknown[], TData> = {
  run: (...args: TArgs) => Promise<ValidationResult<TData>>;
  pending: boolean;
  lastResult: ValidationResult<TData> | null;
};

/**
 * Wrap a server action in a useTransition to track pending state and
 * remember the last result. Always returns the ValidationResult so the
 * caller can branch on success/failure and apply server errors to a form.
 */
export function useServerAction<TArgs extends unknown[], TData>(
  fn: ServerActionFn<TArgs, TData>,
): UseServerActionResult<TArgs, TData> {
  const [isPending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<ValidationResult<TData> | null>(
    null,
  );

  const run = useCallback(
    (...args: TArgs) =>
      new Promise<ValidationResult<TData>>((resolve) => {
        startTransition(async () => {
          const result = await fn(...args);
          setLastResult(result);
          resolve(result);
        });
      }),
    [fn],
  );

  return { run, pending: isPending, lastResult };
}
