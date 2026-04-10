import { describe, it, expect } from "vitest";
import {
  validateOutgoingInvoice,
  validateOutgoingInvoiceHeaderUpdate,
  assertOutgoingInvoiceUndoable,
  assertLineItemsMutable,
  validateLineItemMath,
  validateDocumentTotals,
} from "../invoices";
import { assertTransition, canTransition } from "../../lifecycle";
import { OUTGOING_INVOICE_STATUS } from "../../types";
import type {
  CreateOutgoingInvoiceInput,
  UpdateOutgoingInvoiceInput,
  OutgoingInvoiceRow,
} from "../../types";
import {
  deriveSunatState,
} from "../../outgoing-invoice-computed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  overrides?: Partial<CreateOutgoingInvoiceInput>,
): CreateOutgoingInvoiceInput {
  return {
    project_id: "00000000-0000-0000-0000-000000000001",
    period_start: "2026-04-01",
    period_end: "2026-04-15",
    issue_date: "2026-04-10",
    currency: "PEN",
    ...overrides,
  };
}

function makeInvoice(
  overrides?: Partial<OutgoingInvoiceRow>,
): OutgoingInvoiceRow {
  return {
    id: "00000000-0000-0000-0000-000000000099",
    project_id: "00000000-0000-0000-0000-000000000001",
    status: OUTGOING_INVOICE_STATUS.draft,
    period_start: "2026-04-01",
    period_end: "2026-04-15",
    issue_date: "2026-04-10",
    currency: "PEN",
    exchange_rate: null,
    subtotal: 0,
    igv_amount: 0,
    total: 0,
    total_pen: 0,
    detraction_rate: null,
    detraction_amount: null,
    detraction_status: 1,
    detraction_handled_by: null,
    detraction_constancia_code: null,
    detraction_constancia_fecha: null,
    detraction_constancia_url: null,
    serie_numero: null,
    fecha_emision: null,
    tipo_documento_code: null,
    ruc_emisor: null,
    ruc_receptor: null,
    hash_cdr: null,
    estado_sunat: null,
    pdf_url: null,
    xml_url: null,
    drive_file_id: null,
    source: 1,
    submission_id: null,
    notes: null,
    created_at: "2026-04-10T12:00:00Z",
    updated_at: "2026-04-10T12:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateOutgoingInvoice (baseline header validation)
// ---------------------------------------------------------------------------

describe("validateOutgoingInvoice", () => {
  it("accepts a minimal PEN input", () => {
    const result = validateOutgoingInvoice(makeInput());
    expect(result.success).toBe(true);
  });

  it("rejects period_end before period_start", () => {
    const result = validateOutgoingInvoice(
      makeInput({ period_start: "2026-04-15", period_end: "2026-04-01" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.fields?.period_end).toBeDefined();
    }
  });

  it("rejects USD without exchange_rate", () => {
    const result = validateOutgoingInvoice(
      makeInput({ currency: "USD", exchange_rate: null }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts USD with exchange_rate", () => {
    const result = validateOutgoingInvoice(
      makeInput({ currency: "USD", exchange_rate: 3.75 }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects detracción with only rate (not amount)", () => {
    const result = validateOutgoingInvoice(
      makeInput({ detraction_rate: 0.12, detraction_amount: null }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts detracción with both rate and amount", () => {
    const result = validateOutgoingInvoice(
      makeInput({ detraction_rate: 0.12, detraction_amount: 1200 }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateOutgoingInvoiceHeaderUpdate — field-level locks
// ---------------------------------------------------------------------------

describe("validateOutgoingInvoiceHeaderUpdate", () => {
  it("allows all fields on draft", () => {
    const patch: UpdateOutgoingInvoiceInput = {
      period_start: "2026-05-01",
      currency: "PEN",
      notes: "edit",
    };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.draft }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("blocks financial field updates on sent", () => {
    const patch: UpdateOutgoingInvoiceInput = { period_start: "2026-05-01" };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.sent }),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("IMMUTABLE_FIELD");
      expect(result.error.fields?.period_start).toBeDefined();
    }
  });

  it("allows SUNAT field updates on sent", () => {
    const patch: UpdateOutgoingInvoiceInput = {
      serie_numero: "F001-00000042",
      estado_sunat: "accepted",
      hash_cdr: "abc123",
    };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.sent }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("allows detracción constancia updates on sent", () => {
    const patch: UpdateOutgoingInvoiceInput = {
      detraction_constancia_code: "1234567890",
      detraction_constancia_fecha: "2026-04-12",
      detraction_status: 3,
    };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.sent }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("allows notes update on sent", () => {
    const patch: UpdateOutgoingInvoiceInput = { notes: "added after send" };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.sent }),
      patch,
    );
    expect(result.success).toBe(true);
  });

  it("blocks all updates on void", () => {
    const patch: UpdateOutgoingInvoiceInput = { notes: "try" };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.void }),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("blocks updates on soft-deleted", () => {
    const patch: UpdateOutgoingInvoiceInput = { notes: "try" };
    const result = validateOutgoingInvoiceHeaderUpdate(
      makeInvoice({ deleted_at: "2026-04-10T12:00:00Z" }),
      patch,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// assertOutgoingInvoiceUndoable
// ---------------------------------------------------------------------------

describe("assertOutgoingInvoiceUndoable", () => {
  it("allows undo from sent with no SUNAT data", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({
        status: OUTGOING_INVOICE_STATUS.sent,
        estado_sunat: null,
      }),
    );
    expect(result.success).toBe(true);
  });

  it("allows undo from sent with estado_sunat=rejected (rejected XML is not valid)", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({
        status: OUTGOING_INVOICE_STATUS.sent,
        estado_sunat: "rejected",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("blocks undo when estado_sunat=accepted", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({
        status: OUTGOING_INVOICE_STATUS.sent,
        estado_sunat: "accepted",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });

  it("blocks undo when estado_sunat=pending", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({
        status: OUTGOING_INVOICE_STATUS.sent,
        estado_sunat: "pending",
      }),
    );
    expect(result.success).toBe(false);
  });

  it("blocks undo when invoice is in draft (nothing to undo)", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.draft }),
    );
    expect(result.success).toBe(false);
  });

  it("blocks undo when invoice is void", () => {
    const result = assertOutgoingInvoiceUndoable(
      makeInvoice({ status: OUTGOING_INVOICE_STATUS.void }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertLineItemsMutable for outgoing_invoice
// ---------------------------------------------------------------------------

describe("assertLineItemsMutable for outgoing_invoice", () => {
  it("allows line-item mutations on draft", () => {
    const result = assertLineItemsMutable(
      OUTGOING_INVOICE_STATUS.draft,
      "outgoing_invoice",
    );
    expect(result.success).toBe(true);
  });

  it("blocks line-item mutations on sent", () => {
    const result = assertLineItemsMutable(
      OUTGOING_INVOICE_STATUS.sent,
      "outgoing_invoice",
    );
    expect(result.success).toBe(false);
  });

  it("blocks line-item mutations on void", () => {
    const result = assertLineItemsMutable(
      OUTGOING_INVOICE_STATUS.void,
      "outgoing_invoice",
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// outgoing_invoice lifecycle
// ---------------------------------------------------------------------------

describe("outgoing_invoice lifecycle", () => {
  it("allows draft → sent", () => {
    expect(canTransition("outgoing_invoice", 1, 2)).toBe(true);
  });

  it("allows sent → draft (undo)", () => {
    expect(canTransition("outgoing_invoice", 2, 1)).toBe(true);
  });

  it("allows sent → void", () => {
    expect(canTransition("outgoing_invoice", 2, 5)).toBe(true);
  });

  it("blocks draft → void (drafts are deleted, not voided)", () => {
    expect(canTransition("outgoing_invoice", 1, 5)).toBe(false);
  });

  it("blocks void → anywhere", () => {
    for (const to of [1, 2, 5]) {
      expect(canTransition("outgoing_invoice", 5, to)).toBe(false);
    }
  });

  it("assertTransition returns structured CONFLICT on invalid", () => {
    const result = assertTransition("outgoing_invoice", 1, 5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });
});

// ---------------------------------------------------------------------------
// deriveSunatState
// ---------------------------------------------------------------------------

describe("deriveSunatState", () => {
  it("returns not_submitted for null", () => {
    expect(deriveSunatState(null)).toBe("not_submitted");
  });

  it("maps accepted and aceptado to accepted", () => {
    expect(deriveSunatState("accepted")).toBe("accepted");
    expect(deriveSunatState("aceptado")).toBe("accepted");
    expect(deriveSunatState("ACCEPTED")).toBe("accepted");
  });

  it("maps pending and pendiente to pending", () => {
    expect(deriveSunatState("pending")).toBe("pending");
    expect(deriveSunatState("pendiente")).toBe("pending");
  });

  it("maps rejected and rechazado to rejected", () => {
    expect(deriveSunatState("rejected")).toBe("rejected");
    expect(deriveSunatState("rechazado")).toBe("rejected");
  });

  it("returns not_submitted for unknown values", () => {
    expect(deriveSunatState("whatever")).toBe("not_submitted");
  });
});

// ---------------------------------------------------------------------------
// Line item math + totals consistency (smoke tests — already covered elsewhere)
// ---------------------------------------------------------------------------

describe("outgoing invoice line item math", () => {
  it("validates consistent item math", () => {
    const result = validateLineItemMath({
      description: "test",
      quantity: 10,
      unit_price: 100,
      subtotal: 1000,
      igv_amount: 180,
      total: 1180,
    });
    expect(result.success).toBe(true);
  });

  it("rejects header totals that don't match line items", () => {
    const result = validateDocumentTotals(
      { subtotal: 1000, igv_amount: 180, total: 1180 },
      [
        {
          description: "test",
          quantity: 10,
          unit_price: 100,
          subtotal: 999, // off by one
          igv_amount: 180,
          total: 1179,
        },
      ],
    );
    expect(result.success).toBe(false);
  });
});
