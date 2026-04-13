/**
 * Editor configuration map: which editor archetype handles which field.
 *
 * Every editable field in `PaymentSubmissionHeader` and
 * `PaymentSubmissionLine` has an entry here. Drift is caught by the unit
 * test in `lib/validators/__tests__/inbox.test.ts` ("editor field config
 * completeness") which asserts the HEADER_EDITABLE_FIELDS and
 * LINE_EDITABLE_FIELDS constants in `lib/validators/inbox.ts` match what
 * the domain types expose.
 *
 * Three archetypes:
 *   - input: text/number/date HTML input with explicit save/cancel
 *   - enum:  radio toggle over a fixed list
 *   - combobox: popover with searchable options (reuses existing widgets)
 */

export type InputEditorConfig = {
  kind: "input";
  inputType: "text" | "number" | "date";
  placeholder?: string;
};

export type EnumEditorConfig = {
  kind: "enum";
  options: ReadonlyArray<readonly [value: string, label: string]>;
};

export type ComboboxEditorConfig = {
  kind: "combobox";
  source:
    | "bankAccounts"
    | "projects"
    | "contacts"
    | "costCategories"
    | "invoices";
};

export type EditorConfig =
  | InputEditorConfig
  | EnumEditorConfig
  | ComboboxEditorConfig;

export const HEADER_FIELD_EDITORS = {
  payment_date: { kind: "input", inputType: "date" },
  bank_account_label: { kind: "combobox", source: "bankAccounts" },
  currency: {
    kind: "enum",
    options: [
      ["PEN", "PEN"],
      ["USD", "USD"],
    ],
  },
  exchange_rate: { kind: "input", inputType: "number", placeholder: "3.80" },
  bank_reference: { kind: "input", inputType: "text" },
  contact_ruc: { kind: "input", inputType: "text", placeholder: "20XXXXXXXXX" },
  project_code: { kind: "combobox", source: "projects" },
  notes: { kind: "input", inputType: "text" },
} as const satisfies Record<string, EditorConfig>;

export const LINE_FIELD_EDITORS = {
  amount: { kind: "input", inputType: "number", placeholder: "0.00" },
  line_type: {
    kind: "enum",
    options: [
      ["invoice", "factura"],
      ["bank_fee", "bank_fee"],
      ["detraction", "detracción"],
      ["general", "general"],
    ],
  },
  invoice_number_hint: { kind: "combobox", source: "invoices" },
  cost_category_label: { kind: "combobox", source: "costCategories" },
  notes: { kind: "input", inputType: "text" },
} as const satisfies Record<string, EditorConfig>;

// Note: `direction` is intentionally NOT in HEADER_FIELD_EDITORS — it's
// locked after staging. `is_detraction` is also not editable directly;
// it derives from the bank account's account_type at approval time.
