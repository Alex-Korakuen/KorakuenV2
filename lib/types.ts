/**
 * Central type definitions mirroring the database schema.
 *
 * Status constants, row types, input types, and validation utilities
 * used by all validators and the db client.
 *
 * TODO: Replace row types with `supabase gen types typescript` after
 * schema is deployed to Supabase.
 */

// ---------------------------------------------------------------------------
// Financial comparison tolerance
// ---------------------------------------------------------------------------

export const TOLERANCE = 0.01;

// ---------------------------------------------------------------------------
// Smallint enum constants (match schema-reference.md exactly)
// ---------------------------------------------------------------------------

export const PROJECT_STATUS = {
  prospect: 1,
  active: 2,
  completed: 3,
  archived: 4,
  rejected: 5,
} as const;

export const OUTGOING_QUOTE_STATUS = {
  draft: 1,
  sent: 2,
  approved: 3,
  rejected: 4,
  expired: 5,
} as const;

export const OUTGOING_INVOICE_STATUS = {
  draft: 1,
  sent: 2,
  partially_paid: 3,
  paid: 4,
  void: 5,
} as const;

export const INCOMING_QUOTE_STATUS = {
  draft: 1,
  approved: 2,
  cancelled: 3,
} as const;

export const INCOMING_INVOICE_FACTURA_STATUS = {
  expected: 1,
  received: 2,
} as const;

export const SUBMISSION_STATUS = {
  pending: 1,
  approved: 2,
  rejected: 3,
} as const;

export const PAYMENT_DIRECTION = {
  inbound: 1,
  outbound: 2,
} as const;

export const PAYMENT_LINE_TYPE = {
  invoice: 1,
  bank_fee: 2,
  detraction: 3,
  loan: 4,
  general: 5,
} as const;

export const ACCOUNT_TYPE = {
  regular: 1,
  banco_de_la_nacion: 2,
} as const;

export const TIPO_PERSONA = {
  natural: 1,
  juridica: 2,
} as const;

export const DETRACTION_STATUS = {
  not_applicable: 1,
  pending: 2,
  received: 3,
  autodetracted: 4,
} as const;

export const DETRACTION_HANDLED_BY_OUTGOING = {
  client_deposited: 1,
  not_applicable: 2,
} as const;

export const DETRACTION_HANDLED_BY_INCOMING = {
  self: 1,
  vendor_handled: 2,
  not_applicable: 3,
} as const;

export const SOURCE = {
  manual: 1,
  scan_app: 2,
} as const;

export const USER_ROLE = {
  admin: 1,
  partner: 2,
} as const;

export const ACTIVITY_LOG_ACTION = {
  created: 1,
  updated: 2,
  approved: 3,
  voided: 4,
  deleted: 5,
  restored: 6,
  matched: 7,
} as const;

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

export type ValidationError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function success<T>(data: T): ValidationResult<T> {
  return { success: true, data };
}

export function failure(
  code: string,
  message: string,
  fields?: Record<string, string>,
): ValidationResult<never> {
  return { success: false, error: { code, message, fields } };
}

export function withinTolerance(
  a: number,
  b: number,
  tolerance: number = TOLERANCE,
): boolean {
  return Math.abs(a - b) < tolerance;
}

// ---------------------------------------------------------------------------
// Row types (mirror database schema)
// ---------------------------------------------------------------------------

export type ContactRow = {
  id: string;
  tipo_persona: number;
  ruc: string | null;
  dni: string | null;
  razon_social: string;
  nombre_comercial: string | null;
  is_client: boolean;
  is_vendor: boolean;
  is_partner: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  sunat_estado: string | null;
  sunat_condicion: string | null;
  sunat_verified: boolean;
  sunat_verified_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type BankAccountRow = {
  id: string;
  name: string;
  bank_name: string;
  account_number: string | null;
  currency: string;
  account_type: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CreateBankAccountInput = {
  name: string;
  bank_name: string;
  account_number?: string | null;
  currency: string;
  account_type?: number;
  notes?: string | null;
};

export type UpdateBankAccountInput = {
  name?: string;
  bank_name?: string;
  account_number?: string | null;
  is_active?: boolean;
  notes?: string | null;
};

export type ProjectRow = {
  id: string;
  name: string;
  code: string | null;
  status: number;
  client_id: string;
  description: string | null;
  location: string | null;
  contract_value: number | null;
  contract_currency: string;
  contract_exchange_rate: number | null;
  igv_included: boolean;
  billing_frequency: number | null;
  signed_date: string | null;
  contract_pdf_url: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  actual_end_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ProjectPartnerRow = {
  id: string;
  project_id: string;
  contact_id: string;
  company_label: string;
  profit_split_pct: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type OutgoingQuoteRow = {
  id: string;
  project_id: string;
  contact_id: string;
  status: number;
  quote_number: string | null;
  issue_date: string;
  valid_until: string | null;
  is_winning_quote: boolean;
  currency: string;
  subtotal: number;
  igv_amount: number;
  total: number;
  pdf_url: string | null;
  drive_file_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type OutgoingInvoiceRow = {
  id: string;
  project_id: string;
  status: number;
  period_start: string;
  period_end: string;
  issue_date: string;
  currency: string;
  exchange_rate: number | null;
  subtotal: number;
  igv_amount: number;
  total: number;
  total_pen: number;
  detraction_rate: number | null;
  detraction_amount: number | null;
  detraction_status: number;
  detraction_handled_by: number | null;
  detraction_constancia_code: string | null;
  detraction_constancia_fecha: string | null;
  detraction_constancia_url: string | null;
  serie_numero: string | null;
  fecha_emision: string | null;
  tipo_documento_code: string | null;
  ruc_emisor: string | null;
  ruc_receptor: string | null;
  hash_cdr: string | null;
  estado_sunat: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  drive_file_id: string | null;
  source: number;
  submission_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type IncomingQuoteRow = {
  id: string;
  project_id: string | null;
  contact_id: string;
  status: number;
  description: string;
  reference: string | null;
  currency: string;
  exchange_rate: number | null;
  subtotal: number;
  igv_amount: number;
  total: number;
  total_pen: number;
  detraction_rate: number | null;
  detraction_amount: number | null;
  pdf_url: string | null;
  drive_file_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type IncomingInvoiceRow = {
  id: string;
  project_id: string | null;
  contact_id: string;
  incoming_quote_id: string | null;
  cost_category_id: string | null;
  factura_status: number;
  factura_number: string | null;
  currency: string;
  exchange_rate: number | null;
  subtotal: number;
  igv_amount: number;
  total: number;
  total_pen: number;
  detraction_rate: number | null;
  detraction_amount: number | null;
  detraction_handled_by: number | null;
  detraction_constancia_code: string | null;
  detraction_constancia_fecha: string | null;
  detraction_constancia_url: string | null;
  detraction_constancia_xml_url: string | null;
  serie_numero: string | null;
  fecha_emision: string | null;
  tipo_documento_code: string | null;
  ruc_emisor: string | null;
  ruc_receptor: string | null;
  hash_cdr: string | null;
  estado_sunat: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  drive_file_id: string | null;
  source: number;
  submission_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type LineItemRow = {
  id: string;
  sort_order: number;
  description: string;
  unit: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  igv_applies: boolean;
  igv_amount: number;
  total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentRow = {
  id: string;
  direction: number;
  bank_account_id: string;
  project_id: string | null;
  contact_id: string | null;
  paid_by_partner_id: string | null;
  total_amount: number;
  currency: string;
  exchange_rate: number | null;
  total_amount_pen: number;
  is_detraction: boolean;
  reconciled: boolean;
  bank_reference: string | null;
  reconciled_at: string | null;
  reconciled_by: string | null;
  source: number;
  submission_id: string | null;
  drive_file_id: string | null;
  payment_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  role: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PaymentLineRow = {
  id: string;
  payment_id: string;
  sort_order: number;
  amount: number;
  amount_pen: number;
  outgoing_invoice_id: string | null;
  incoming_invoice_id: string | null;
  loan_id: string | null;
  cost_category_id: string | null;
  line_type: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Input types (for create/update operations)
// ---------------------------------------------------------------------------

export type CreateContactInput = {
  tipo_persona: number;
  ruc?: string | null;
  dni?: string | null;
  razon_social: string;
  nombre_comercial?: string | null;
  is_client?: boolean;
  is_vendor?: boolean;
  is_partner?: boolean;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  sunat_estado?: string | null;
  sunat_condicion?: string | null;
  sunat_verified: boolean;
  sunat_verified_at: string;
  notes?: string | null;
};

export type UpdateContactInput = {
  nombre_comercial?: string | null;
  is_client?: boolean;
  is_vendor?: boolean;
  is_partner?: boolean;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

export type CreateProjectInput = {
  name: string;
  code?: string | null;
  client_id: string;
  description?: string | null;
  location?: string | null;
  contract_value?: number | null;
  contract_currency?: string;
  contract_exchange_rate?: number | null;
  igv_included?: boolean;
  billing_frequency?: number | null;
  signed_date?: string | null;
  contract_pdf_url?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  notes?: string | null;
};

export type UpdateProjectInput = Partial<CreateProjectInput>;

export type CreateProjectPartnerInput = {
  contact_id: string;
  company_label: string;
  profit_split_pct: number;
};

export type UpdateProjectPartnerInput = {
  company_label?: string;
  profit_split_pct?: number;
};

export type LineItemInput = {
  sort_order?: number;
  description: string;
  unit?: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  igv_applies?: boolean;
  igv_amount: number;
  total: number;
  notes?: string | null;
};

export type DocumentTotals = {
  subtotal: number;
  igv_amount: number;
  total: number;
};

export type CreateOutgoingQuoteInput = {
  project_id: string;
  contact_id: string;
  quote_number?: string | null;
  issue_date: string;
  valid_until?: string | null;
  is_winning_quote?: boolean;
  currency?: string;
  notes?: string | null;
};

export type CreateOutgoingInvoiceInput = {
  project_id: string;
  period_start: string;
  period_end: string;
  issue_date: string;
  currency?: string;
  exchange_rate?: number | null;
  detraction_rate?: number | null;
  detraction_amount?: number | null;
  serie_numero?: string | null;
  fecha_emision?: string | null;
  tipo_documento_code?: string | null;
  ruc_emisor?: string | null;
  ruc_receptor?: string | null;
  notes?: string | null;
};

export type CreateIncomingQuoteInput = {
  project_id?: string | null;
  contact_id: string;
  description: string;
  reference?: string | null;
  currency?: string;
  exchange_rate?: number | null;
  detraction_rate?: number | null;
  detraction_amount?: number | null;
  notes?: string | null;
};

export type CreateIncomingInvoiceInput = {
  project_id?: string | null;
  contact_id: string;
  incoming_quote_id?: string | null;
  cost_category_id?: string | null;
  factura_number?: string | null;
  currency?: string;
  exchange_rate?: number | null;
  subtotal: number;
  igv_amount: number;
  total: number;
  total_pen: number;
  detraction_rate?: number | null;
  detraction_amount?: number | null;
  detraction_handled_by?: number | null;
  serie_numero?: string | null;
  fecha_emision?: string | null;
  tipo_documento_code?: string | null;
  ruc_emisor?: string | null;
  ruc_receptor?: string | null;
  notes?: string | null;
};

export type CreatePaymentInput = {
  direction: number;
  bank_account_id: string;
  project_id?: string | null;
  contact_id?: string | null;
  paid_by_partner_id?: string | null;
  currency?: string;
  exchange_rate?: number | null;
  is_detraction?: boolean;
  payment_date: string;
  bank_reference?: string | null;
  notes?: string | null;
};

export type CreatePaymentLineInput = {
  sort_order?: number;
  amount: number;
  amount_pen: number;
  outgoing_invoice_id?: string | null;
  incoming_invoice_id?: string | null;
  loan_id?: string | null;
  cost_category_id?: string | null;
  line_type: number;
  notes?: string | null;
};

export type SunatFieldsInput = {
  serie_numero?: string | null;
  fecha_emision?: string | null;
  tipo_documento_code?: string | null;
  ruc_emisor?: string | null;
  ruc_receptor?: string | null;
  hash_cdr?: string | null;
  estado_sunat?: string | null;
};

export type ProjectBudgetRow = {
  id: string;
  project_id: string;
  cost_category_id: string;
  budgeted_amount_pen: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CreateProjectBudgetInput = {
  project_id: string;
  cost_category_id: string;
  budgeted_amount_pen: number;
  notes?: string | null;
};

export type UpdateProjectBudgetInput = {
  budgeted_amount_pen?: number;
  notes?: string | null;
};
