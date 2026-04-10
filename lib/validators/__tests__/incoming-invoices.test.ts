import { describe, it, expect } from "vitest";
import { validateFacturaStatusTransition } from "../incoming-invoices";
import { INCOMING_INVOICE_FACTURA_STATUS } from "../../types";
import type { IncomingInvoiceRow } from "../../types";

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
