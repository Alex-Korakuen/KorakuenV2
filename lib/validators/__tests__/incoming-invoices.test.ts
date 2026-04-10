import { describe, it, expect } from "vitest";
import { validateFacturaStatusTransition } from "../incoming-invoices";
import {
  validateIncomingInvoiceHeaderUpdate,
  assertIncomingInvoiceDeletable,
} from "../invoices";
import { INCOMING_INVOICE_FACTURA_STATUS } from "../../types";
import type {
  IncomingInvoiceRow,
  UpdateIncomingInvoiceInput,
} from "../../types";

// ---------------------------------------------------------------------------
// Helpers — minimal SUNAT state objects for testing
// ---------------------------------------------------------------------------

type SunatState = Pick<
  IncomingInvoiceRow,
  | "serie_numero"
  | "fecha_emision"
  | "tipo_documento_code"
  | "ruc_emisor"
  | "ruc_receptor"
>;

function makeCompleteSunatState(overrides?: Partial<SunatState>): SunatState {
  return {
    serie_numero: "F001-00000142",
    fecha_emision: "2026-04-09",
    tipo_documento_code: "01",
    ruc_emisor: "20123456789",
    ruc_receptor: "20987654321",
    ...overrides,
  };
}

function makeEmptySunatState(): SunatState {
  return {
    serie_numero: null,
    fecha_emision: null,
    tipo_documento_code: null,
    ruc_emisor: null,
    ruc_receptor: null,
  };
}

const { expected, received } = INCOMING_INVOICE_FACTURA_STATUS;

// ---------------------------------------------------------------------------
// validateFacturaStatusTransition
// ---------------------------------------------------------------------------

describe("validateFacturaStatusTransition", () => {
  it("accepts expected → received when all SUNAT fields are present", () => {
    const result = validateFacturaStatusTransition(
      expected,
      received,
      makeCompleteSunatState(),
    );
    expect(result.success).toBe(true);
  });

  it("rejects expected → received with missing serie_numero", () => {
    const result = validateFacturaStatusTransition(
      expected,
      received,
      makeCompleteSunatState({ serie_numero: null }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.fields?.serie_numero).toBeDefined();
    }
  });

  it("reports all missing SUNAT fields at once", () => {
    const result = validateFacturaStatusTransition(
      expected,
      received,
      makeEmptySunatState(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.fields?.serie_numero).toBeDefined();
      expect(result.error.fields?.fecha_emision).toBeDefined();
      expect(result.error.fields?.tipo_documento_code).toBeDefined();
      expect(result.error.fields?.ruc_emisor).toBeDefined();
      expect(result.error.fields?.ruc_receptor).toBeDefined();
    }
  });

  it("rejects empty string SUNAT fields as missing", () => {
    const result = validateFacturaStatusTransition(
      expected,
      received,
      makeCompleteSunatState({ ruc_emisor: "" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.ruc_emisor).toBeDefined();
    }
  });

  it("rejects received → received (terminal state) with CONFLICT", () => {
    const result = validateFacturaStatusTransition(
      received,
      received,
      makeCompleteSunatState(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("rejects received → expected (one-way rule) with CONFLICT", () => {
    const result = validateFacturaStatusTransition(
      received,
      expected,
      makeCompleteSunatState(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("rejects expected → expected (not a declared transition) with CONFLICT", () => {
    const result = validateFacturaStatusTransition(
      expected,
      expected,
      makeEmptySunatState(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("does not run the SUNAT field check when the transition rule fails", () => {
    // received → expected is invalid; error code must be CONFLICT, not
    // VALIDATION_ERROR, even though the SUNAT-required check would also
    // fail if it ran (this confirms early-exit ordering).
    const result = validateFacturaStatusTransition(
      received,
      expected,
      makeEmptySunatState(),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.serie_numero).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// validateIncomingInvoiceHeaderUpdate
// ---------------------------------------------------------------------------

type InvoiceRowStub = Pick<IncomingInvoiceRow, "factura_status" | "deleted_at">;

function makeInvoiceStub(
  overrides?: Partial<InvoiceRowStub>,
): InvoiceRowStub {
  return {
    factura_status: expected,
    deleted_at: null,
    ...overrides,
  };
}

describe("validateIncomingInvoiceHeaderUpdate", () => {
  it("accepts an empty patch on an expected invoice", () => {
    const result = validateIncomingInvoiceHeaderUpdate(makeInvoiceStub(), {});
    expect(result.success).toBe(true);
  });

  it("accepts financial edits on an expected invoice", () => {
    const patch: UpdateIncomingInvoiceInput = {
      currency: "USD",
      exchange_rate: 3.75,
      subtotal: 100,
      igv_amount: 18,
      total: 118,
    };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub(),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("accepts metadata edits on a received invoice", () => {
    // hash_cdr, estado_sunat, pdf_url, xml_url, drive_file_id, and
    // notes stay mutable after the invoice is received.
    const patch: UpdateIncomingInvoiceInput = {
      hash_cdr: "abc123",
      estado_sunat: "accepted",
      pdf_url: "https://drive.google.com/file/d/xyz",
      notes: "Revisado con contador",
    };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub({ factura_status: received }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("accepts detracción proof fields on a received invoice", () => {
    const patch: UpdateIncomingInvoiceInput = {
      detraction_handled_by: 1,
      detraction_constancia_code: "ABC123",
      detraction_constancia_fecha: "2026-04-10",
    };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub({ factura_status: received }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("rejects financial-core edits on a received invoice", () => {
    const patch: UpdateIncomingInvoiceInput = { total: 999 };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub({ factura_status: received }),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("IMMUTABLE_FIELD");
      expect(result.error.fields?.total).toBeDefined();
    }
  });

  it("rejects SUNAT identifier edits on a received invoice", () => {
    const patch: UpdateIncomingInvoiceInput = {
      serie_numero: "F002-00000001",
      ruc_emisor: "20999999999",
    };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub({ factura_status: received }),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("IMMUTABLE_FIELD");
      expect(result.error.fields?.serie_numero).toBeDefined();
      expect(result.error.fields?.ruc_emisor).toBeDefined();
    }
  });

  it("rejects a patch on a soft-deleted invoice with NOT_FOUND", () => {
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub({ deleted_at: "2026-04-10T00:00:00Z" }),
      { notes: "test" },
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("rejects malformed ruc_emisor in a patch", () => {
    const patch: UpdateIncomingInvoiceInput = {
      ruc_emisor: "12345",
    };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub(),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.ruc_emisor).toBeDefined();
    }
  });

  it("rejects USD without exchange_rate in a patch", () => {
    const patch: UpdateIncomingInvoiceInput = { currency: "USD" };
    const result = validateIncomingInvoiceHeaderUpdate(
      makeInvoiceStub(),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.exchange_rate).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// assertIncomingInvoiceDeletable
// ---------------------------------------------------------------------------

describe("assertIncomingInvoiceDeletable", () => {
  it("accepts an expected, non-deleted invoice", () => {
    const result = assertIncomingInvoiceDeletable(makeInvoiceStub());
    expect(result.success).toBe(true);
  });

  it("rejects a received invoice with CONFLICT", () => {
    const result = assertIncomingInvoiceDeletable(
      makeInvoiceStub({ factura_status: received }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.fields?.factura_status).toBeDefined();
    }
  });

  it("rejects an already-deleted invoice with NOT_FOUND", () => {
    const result = assertIncomingInvoiceDeletable(
      makeInvoiceStub({ deleted_at: "2026-04-10T00:00:00Z" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});
