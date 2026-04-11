import {
  ACCOUNT_TYPE,
  DETRACTION_HANDLED_BY_INCOMING,
  DETRACTION_HANDLED_BY_OUTGOING,
  DETRACTION_STATUS,
  INCOMING_INVOICE_FACTURA_STATUS,
  INCOMING_QUOTE_STATUS,
  OUTGOING_INVOICE_STATUS,
  OUTGOING_QUOTE_STATUS,
  PAYMENT_DIRECTION,
  PAYMENT_LINE_TYPE,
  PROJECT_STATUS,
  SUBMISSION_STATUS,
  TIPO_PERSONA,
  USER_ROLE,
} from "@/lib/types";

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

const PROJECT_STATUS_LABELS: Record<number, string> = {
  [PROJECT_STATUS.prospect]: "Prospecto",
  [PROJECT_STATUS.active]: "Activo",
  [PROJECT_STATUS.completed]: "Completado",
  [PROJECT_STATUS.archived]: "Archivado",
  [PROJECT_STATUS.rejected]: "Rechazado",
};

const PROJECT_STATUS_VARIANTS: Record<number, BadgeVariant> = {
  [PROJECT_STATUS.prospect]: "secondary",
  [PROJECT_STATUS.active]: "info",
  [PROJECT_STATUS.completed]: "success",
  [PROJECT_STATUS.archived]: "outline",
  [PROJECT_STATUS.rejected]: "destructive",
};

export function projectStatusLabel(status: number): string {
  return PROJECT_STATUS_LABELS[status] ?? "Desconocido";
}

export function projectStatusVariant(status: number): BadgeVariant {
  return PROJECT_STATUS_VARIANTS[status] ?? "outline";
}

const OUTGOING_QUOTE_STATUS_LABELS: Record<number, string> = {
  [OUTGOING_QUOTE_STATUS.draft]: "Borrador",
  [OUTGOING_QUOTE_STATUS.sent]: "Enviada",
  [OUTGOING_QUOTE_STATUS.approved]: "Aprobada",
  [OUTGOING_QUOTE_STATUS.rejected]: "Rechazada",
  [OUTGOING_QUOTE_STATUS.expired]: "Expirada",
};

const OUTGOING_QUOTE_STATUS_VARIANTS: Record<number, BadgeVariant> = {
  [OUTGOING_QUOTE_STATUS.draft]: "secondary",
  [OUTGOING_QUOTE_STATUS.sent]: "info",
  [OUTGOING_QUOTE_STATUS.approved]: "success",
  [OUTGOING_QUOTE_STATUS.rejected]: "destructive",
  [OUTGOING_QUOTE_STATUS.expired]: "outline",
};

export function outgoingQuoteStatusLabel(status: number): string {
  return OUTGOING_QUOTE_STATUS_LABELS[status] ?? "Desconocido";
}

export function outgoingQuoteStatusVariant(status: number): BadgeVariant {
  return OUTGOING_QUOTE_STATUS_VARIANTS[status] ?? "outline";
}

const OUTGOING_INVOICE_STATUS_LABELS: Record<number, string> = {
  [OUTGOING_INVOICE_STATUS.draft]: "Borrador",
  [OUTGOING_INVOICE_STATUS.sent]: "Emitida",
  [OUTGOING_INVOICE_STATUS.void]: "Anulada",
};

const OUTGOING_INVOICE_STATUS_VARIANTS: Record<number, BadgeVariant> = {
  [OUTGOING_INVOICE_STATUS.draft]: "secondary",
  [OUTGOING_INVOICE_STATUS.sent]: "info",
  [OUTGOING_INVOICE_STATUS.void]: "destructive",
};

export function outgoingInvoiceStatusLabel(status: number): string {
  return OUTGOING_INVOICE_STATUS_LABELS[status] ?? "Desconocido";
}

export function outgoingInvoiceStatusVariant(status: number): BadgeVariant {
  return OUTGOING_INVOICE_STATUS_VARIANTS[status] ?? "outline";
}

const INCOMING_QUOTE_STATUS_LABELS: Record<number, string> = {
  [INCOMING_QUOTE_STATUS.draft]: "Borrador",
  [INCOMING_QUOTE_STATUS.approved]: "Aprobada",
  [INCOMING_QUOTE_STATUS.cancelled]: "Cancelada",
};

const INCOMING_QUOTE_STATUS_VARIANTS: Record<number, BadgeVariant> = {
  [INCOMING_QUOTE_STATUS.draft]: "secondary",
  [INCOMING_QUOTE_STATUS.approved]: "success",
  [INCOMING_QUOTE_STATUS.cancelled]: "outline",
};

export function incomingQuoteStatusLabel(status: number): string {
  return INCOMING_QUOTE_STATUS_LABELS[status] ?? "Desconocido";
}

export function incomingQuoteStatusVariant(status: number): BadgeVariant {
  return INCOMING_QUOTE_STATUS_VARIANTS[status] ?? "outline";
}

const FACTURA_STATUS_LABELS: Record<number, string> = {
  [INCOMING_INVOICE_FACTURA_STATUS.expected]: "Esperada",
  [INCOMING_INVOICE_FACTURA_STATUS.received]: "Recibida",
};

const FACTURA_STATUS_VARIANTS: Record<number, BadgeVariant> = {
  [INCOMING_INVOICE_FACTURA_STATUS.expected]: "warning",
  [INCOMING_INVOICE_FACTURA_STATUS.received]: "success",
};

export function incomingInvoiceFacturaStatusLabel(status: number): string {
  return FACTURA_STATUS_LABELS[status] ?? "Desconocido";
}

export function incomingInvoiceFacturaStatusVariant(
  status: number,
): BadgeVariant {
  return FACTURA_STATUS_VARIANTS[status] ?? "outline";
}

const SUBMISSION_STATUS_LABELS: Record<number, string> = {
  [SUBMISSION_STATUS.pending]: "Pendiente",
  [SUBMISSION_STATUS.approved]: "Aprobado",
  [SUBMISSION_STATUS.rejected]: "Rechazado",
};

export function submissionStatusLabel(status: number): string {
  return SUBMISSION_STATUS_LABELS[status] ?? "Desconocido";
}

const PAYMENT_DIRECTION_LABELS: Record<number, string> = {
  [PAYMENT_DIRECTION.inbound]: "Entrada",
  [PAYMENT_DIRECTION.outbound]: "Salida",
};

export function paymentDirectionLabel(direction: number): string {
  return PAYMENT_DIRECTION_LABELS[direction] ?? "Desconocido";
}

const PAYMENT_LINE_TYPE_LABELS: Record<number, string> = {
  [PAYMENT_LINE_TYPE.invoice]: "Factura",
  [PAYMENT_LINE_TYPE.bank_fee]: "Comisión bancaria",
  [PAYMENT_LINE_TYPE.detraction]: "Detracción",
  [PAYMENT_LINE_TYPE.loan]: "Préstamo",
  [PAYMENT_LINE_TYPE.general]: "General",
};

export function paymentLineTypeLabel(type: number): string {
  return PAYMENT_LINE_TYPE_LABELS[type] ?? "Desconocido";
}

const ACCOUNT_TYPE_LABELS: Record<number, string> = {
  [ACCOUNT_TYPE.regular]: "Regular",
  [ACCOUNT_TYPE.banco_de_la_nacion]: "Banco de la Nación",
};

export function accountTypeLabel(type: number): string {
  return ACCOUNT_TYPE_LABELS[type] ?? "Desconocido";
}

const TIPO_PERSONA_LABELS: Record<number, string> = {
  [TIPO_PERSONA.natural]: "Persona natural",
  [TIPO_PERSONA.juridica]: "Persona jurídica",
};

export function tipoPersonaLabel(tipo: number): string {
  return TIPO_PERSONA_LABELS[tipo] ?? "Desconocido";
}

const DETRACTION_STATUS_LABELS: Record<number, string> = {
  [DETRACTION_STATUS.not_applicable]: "No aplica",
  [DETRACTION_STATUS.pending]: "Pendiente",
  [DETRACTION_STATUS.received]: "Recibida",
  [DETRACTION_STATUS.autodetracted]: "Autodetraída",
};

export function detractionStatusLabel(status: number): string {
  return DETRACTION_STATUS_LABELS[status] ?? "Desconocido";
}

const DETRACTION_HANDLED_BY_OUTGOING_LABELS: Record<number, string> = {
  [DETRACTION_HANDLED_BY_OUTGOING.client_deposited]: "Cliente depositó",
  [DETRACTION_HANDLED_BY_OUTGOING.not_applicable]: "No aplica",
};

export function detractionHandledByOutgoingLabel(value: number): string {
  return DETRACTION_HANDLED_BY_OUTGOING_LABELS[value] ?? "Desconocido";
}

const DETRACTION_HANDLED_BY_INCOMING_LABELS: Record<number, string> = {
  [DETRACTION_HANDLED_BY_INCOMING.self]: "Propia",
  [DETRACTION_HANDLED_BY_INCOMING.vendor_handled]: "Por proveedor",
  [DETRACTION_HANDLED_BY_INCOMING.not_applicable]: "No aplica",
};

export function detractionHandledByIncomingLabel(value: number): string {
  return DETRACTION_HANDLED_BY_INCOMING_LABELS[value] ?? "Desconocido";
}

const USER_ROLE_LABELS: Record<number, string> = {
  [USER_ROLE.admin]: "Administrador",
  [USER_ROLE.partner]: "Socio",
};

export function userRoleLabel(role: number): string {
  return USER_ROLE_LABELS[role] ?? "Desconocido";
}
