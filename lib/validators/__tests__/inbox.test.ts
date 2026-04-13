import { describe, it, expect } from "vitest";
import {
  parseCsvPaymentRows,
  groupRowsByGroupId,
  buildSubmissionFromGroup,
  validatePaymentSubmissionData,
  validateApproveSubmission,
  validateRejectSubmission,
  normalizeDirection,
  normalizeCurrency,
  normalizeLineType,
  normalizeDate,
  parseNumberOrNull,
  parseBoolean,
  CSV_HEADER_COLUMNS,
} from "../inbox";
import {
  SUBMISSION_STATUS,
  SUBMISSION_SOURCE_TYPE,
} from "../../types";
import type {
  PaymentSubmissionExtractedData,
  SubmissionRow,
} from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CSV_HEADER = CSV_HEADER_COLUMNS.join(",");

function makeCsv(rows: string[]): string {
  return [CSV_HEADER, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// parseCsvPaymentRows
// ---------------------------------------------------------------------------

describe("parseCsvPaymentRows", () => {
  it("parses a minimal one-row CSV", () => {
    const csv = makeCsv([
      "P001,2026-04-02,inbound,BCP-PEN-001,PEN,,OP-445511,false,20512345678,,11800.00,invoice,PRJ-2026-01,F001-00045,,",
    ]);
    const r = parseCsvPaymentRows(csv);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0].group_id).toBe("P001");
    expect(r.data[0].row_number).toBe(2);
  });

  it("trims whitespace on values", () => {
    const csv = makeCsv([
      "  P001  ,2026-04-02, inbound , BCP-PEN-001 ,PEN,,OP-445511,false,20512345678,,11800.00,invoice,PRJ-2026-01,F001-00045,,",
    ]);
    const r = parseCsvPaymentRows(csv);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data[0].group_id).toBe("P001");
    expect(r.data[0].direction).toBe("inbound");
    expect(r.data[0].bank_account).toBe("BCP-PEN-001");
  });

  it("fails on empty input", () => {
    const r = parseCsvPaymentRows("");
    expect(r.success).toBe(false);
  });

  it("fails when required columns are missing", () => {
    const r = parseCsvPaymentRows(
      "group_id,payment_date\nP001,2026-04-02",
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.message).toMatch(/Faltan columnas/);
  });

  it("discards fully empty lines", () => {
    const csv = [
      CSV_HEADER,
      "P001,2026-04-02,inbound,BCP-PEN-001,PEN,,OP-445511,false,20512345678,,11800.00,invoice,PRJ-2026-01,F001-00045,,",
      "",
      "",
    ].join("\n");
    const r = parseCsvPaymentRows(csv);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(1);
  });

  it("assigns row_number starting at 2 (accounting for header)", () => {
    const csv = makeCsv([
      "P001,2026-04-02,inbound,BCP-PEN-001,PEN,,OP-1,false,20512345678,,11800.00,invoice,PRJ-2026-01,,,",
      "P002,2026-04-03,outbound,BCP-PEN-001,PEN,,OP-2,false,20498765432,,5900.00,invoice,PRJ-2026-01,,,",
    ]);
    const r = parseCsvPaymentRows(csv);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data[0].row_number).toBe(2);
    expect(r.data[1].row_number).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// groupRowsByGroupId
// ---------------------------------------------------------------------------

describe("groupRowsByGroupId", () => {
  it("groups rows sharing a group_id", () => {
    const csv = makeCsv([
      "P001,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-1,false,20498765432,,5900.00,invoice,PRJ-2026-01,F001-00089,,",
      "P001,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-1,false,20498765432,,12.50,bank_fee,,,,comision",
      "P002,2026-04-03,inbound,BCP-PEN-001,PEN,,OP-2,false,20512345678,,11800.00,invoice,PRJ-2026-01,F001-00090,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const groups = groupRowsByGroupId(parsed.data);
    expect(groups.size).toBe(2);
    expect(groups.get("P001")).toHaveLength(2);
    expect(groups.get("P002")).toHaveLength(1);
  });

  it("preserves first-occurrence order", () => {
    const csv = makeCsv([
      "B,2026-04-02,inbound,BCP-PEN-001,PEN,,X,false,20512345678,,100,invoice,,F001,,",
      "A,2026-04-02,inbound,BCP-PEN-001,PEN,,Y,false,20512345678,,100,invoice,,F002,,",
      "B,2026-04-02,inbound,BCP-PEN-001,PEN,,X,false,20512345678,,200,invoice,,F003,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    expect(Array.from(groups.keys())).toEqual(["B", "A"]);
  });

  it("collects missing group_ids under __missing__", () => {
    const csv = makeCsv([
      ",2026-04-02,inbound,BCP-PEN-001,PEN,,OP-1,false,20512345678,,100,invoice,,,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    expect(groups.has("__missing__")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSubmissionFromGroup — happy paths
// ---------------------------------------------------------------------------

describe("buildSubmissionFromGroup — happy paths", () => {
  it("builds a single-line inbound payment", () => {
    const csv = makeCsv([
      "P001,2026-04-02,inbound,BCP-PEN-001,PEN,,OP-445511,false,20512345678,,11800.00,invoice,PRJ-2026-01,F001-00045,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup("P001", groups.get("P001")!);

    expect(sub.kind).toBe("payment");
    expect(sub.header.payment_date).toBe("2026-04-02");
    expect(sub.header.direction).toBe("inbound");
    expect(sub.header.currency).toBe("PEN");
    expect(sub.header.bank_reference).toBe("OP-445511");
    expect(sub.header.contact_ruc).toBe("20512345678");
    expect(sub.lines).toHaveLength(1);
    expect(sub.lines[0].amount).toBe(11800);
    expect(sub.lines[0].line_type).toBe("invoice");
    expect(sub.lines[0].invoice_number_hint).toBe("F001-00045");
    expect(sub.validation.valid).toBe(true);
  });

  it("builds a 3-line outbound payment with bank fee", () => {
    const csv = makeCsv([
      "P002,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-998877,false,20498765432,,5900.00,invoice,PRJ-2026-01,F001-00089,,",
      "P002,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-998877,false,20498765432,,12.50,bank_fee,,,,comision",
      "P002,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-998877,false,20498765432,,100.00,general,PRJ-2026-01,,materiales,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup("P002", groups.get("P002")!);

    expect(sub.lines).toHaveLength(3);
    expect(sub.lines.map((l) => l.line_type)).toEqual([
      "invoice",
      "bank_fee",
      "general",
    ]);
    expect(sub.lines[0].amount).toBe(5900);
    expect(sub.lines[1].amount).toBe(12.5);
    expect(sub.csv_row_numbers).toEqual([2, 3, 4]);
    expect(sub.validation.valid).toBe(true);
  });

  it("marks a USD payment with exchange_rate as valid", () => {
    const csv = makeCsv([
      "P003,2026-04-02,inbound,BCP-USD-001,USD,3.75,OP-5,false,20512345678,,5000.00,invoice,PRJ-2026-01,F001-00050,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup("P003", groups.get("P003")!);
    expect(sub.header.currency).toBe("USD");
    expect(sub.header.exchange_rate).toBe(3.75);
    expect(sub.validation.valid).toBe(true);
  });

  it("marks a BN detraction as valid when currency=PEN", () => {
    const csv = makeCsv([
      "P004,2026-04-03,outbound,BN-DET-001,PEN,,DET-4411,true,20498765432,,472.00,detraction,PRJ-2026-01,F001-00089,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup("P004", groups.get("P004")!);
    expect(sub.header.is_detraction).toBe(true);
    expect(sub.header.currency).toBe("PEN");
    expect(sub.validation.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildSubmissionFromGroup — structural errors
// ---------------------------------------------------------------------------

describe("buildSubmissionFromGroup — structural errors", () => {
  it("flags inconsistent header across rows of a group", () => {
    const csv = makeCsv([
      "P001,2026-04-02,outbound,BCP-PEN-001,PEN,,TRF-1,false,20498765432,,5900.00,invoice,PRJ-2026-01,F001-00089,,",
      "P001,2026-04-02,outbound,BCP-USD-001,PEN,,TRF-1,false,20498765432,,12.50,bank_fee,,,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup("P001", groups.get("P001")!);
    expect(sub.validation.valid).toBe(false);
    expect(
      sub.validation.errors.some((e) => e.path === "header.bank_account"),
    ).toBe(true);
  });

  it("flags missing group_id", () => {
    const csv = makeCsv([
      ",2026-04-02,inbound,BCP-PEN-001,PEN,,OP-1,false,20512345678,,100,invoice,,,,",
    ]);
    const parsed = parseCsvPaymentRows(csv);
    if (!parsed.success) throw new Error("parse failed");
    const groups = groupRowsByGroupId(parsed.data);
    const sub = buildSubmissionFromGroup(
      "__missing__",
      groups.get("__missing__")!,
    );
    expect(sub.validation.valid).toBe(false);
    expect(
      sub.validation.errors.some((e) => e.path === "group_id"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePaymentSubmissionData — semantic rules
// ---------------------------------------------------------------------------

function baseData(
  overrides: Partial<PaymentSubmissionExtractedData> = {},
): PaymentSubmissionExtractedData {
  return {
    kind: "payment",
    header: {
      payment_date: "2026-04-02",
      direction: "inbound",
      bank_account_label: "BCP-PEN-001",
      bank_account_id: null,
      currency: "PEN",
      exchange_rate: null,
      bank_reference: "OP-1",
      is_detraction: false,
      contact_ruc: "20512345678",
      contact_id: null,
      project_code: "PRJ-2026-01",
      project_id: null,
      notes: null,
    },
    lines: [
      {
        amount: 100,
        line_type: "invoice",
        invoice_number_hint: null,
        outgoing_invoice_id: null,
        incoming_invoice_id: null,
        cost_category_label: null,
        cost_category_id: null,
        notes: null,
      },
    ],
    validation: { valid: false, errors: [] },
    ...overrides,
  };
}

describe("validatePaymentSubmissionData", () => {
  it("passes a well-formed minimal payment", () => {
    const r = validatePaymentSubmissionData(baseData());
    expect(r.valid).toBe(true);
  });

  it("rejects missing contact RUC", () => {
    const d = baseData();
    d.header.contact_ruc = null;
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "header.contact_ruc")).toBe(true);
  });

  it("rejects RUC with wrong length", () => {
    const d = baseData();
    d.header.contact_ruc = "12345";
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "header.contact_ruc")).toBe(true);
  });

  it("requires exchange_rate when currency=USD", () => {
    const d = baseData();
    d.header.currency = "USD";
    d.header.exchange_rate = null;
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(
      r.errors.some((e) => e.path === "header.exchange_rate"),
    ).toBe(true);
  });

  it("accepts USD with exchange_rate > 0", () => {
    const d = baseData();
    d.header.currency = "USD";
    d.header.exchange_rate = 3.8;
    expect(validatePaymentSubmissionData(d).valid).toBe(true);
  });

  it("rejects is_detraction=true with USD currency", () => {
    const d = baseData();
    d.header.is_detraction = true;
    d.header.currency = "USD";
    d.header.exchange_rate = 3.8;
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "header.is_detraction")).toBe(true);
  });

  it("rejects empty lines array", () => {
    const d = baseData();
    d.lines = [];
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "lines")).toBe(true);
  });

  it("rejects a line with amount <= 0", () => {
    const d = baseData();
    d.lines[0].amount = 0;
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "lines[0].amount")).toBe(true);
  });

  it("rejects unknown line_type", () => {
    const d = baseData();
    d.lines[0].line_type = null;
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "lines[0].line_type")).toBe(true);
  });

  it("flags line_type=loan as unsupported via CSV", () => {
    const d = baseData();
    d.lines[0].line_type = "loan";
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.path === "lines[0].line_type" && /loan/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects bank_fee line with an invoice hint", () => {
    const d = baseData();
    d.lines[0].line_type = "bank_fee";
    d.lines[0].invoice_number_hint = "F001-00001";
    const r = validatePaymentSubmissionData(d);
    expect(r.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateApproveSubmission / validateRejectSubmission
// ---------------------------------------------------------------------------

function makeSubmission(
  overrides: Partial<SubmissionRow> = {},
): SubmissionRow {
  return {
    id: "sub-1",
    source_type: SUBMISSION_SOURCE_TYPE.payment,
    submitted_by: "user-1",
    submitted_at: "2026-04-13T10:00:00Z",
    image_url: null,
    pdf_url: null,
    xml_url: null,
    extracted_data: {
      ...baseData(),
      validation: { valid: true, errors: [] },
    },
    review_status: SUBMISSION_STATUS.pending,
    reviewed_by: null,
    reviewed_at: null,
    rejection_notes: null,
    resulting_record_id: null,
    resulting_record_type: null,
    import_batch_id: "batch-1",
    import_batch_label: "demo.csv",
    created_at: "2026-04-13T10:00:00Z",
    updated_at: "2026-04-13T10:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("validateApproveSubmission", () => {
  it("accepts a valid, pending, payment submission", () => {
    const r = validateApproveSubmission(makeSubmission());
    expect(r.success).toBe(true);
  });

  it("rejects a soft-deleted submission", () => {
    const r = validateApproveSubmission(
      makeSubmission({ deleted_at: "2026-04-13T11:00:00Z" }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rejects an already-approved submission", () => {
    const r = validateApproveSubmission(
      makeSubmission({ review_status: SUBMISSION_STATUS.approved }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe("CONFLICT");
  });

  it("rejects a submission whose extracted_data still has errors", () => {
    const extracted = {
      ...baseData(),
      validation: {
        valid: false,
        errors: [{ path: "header.currency", message: "Required" }],
      },
    };
    const r = validateApproveSubmission(
      makeSubmission({ extracted_data: extracted }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.message).toMatch(/errores pendientes/);
  });

  it("rejects a non-payment source_type", () => {
    const r = validateApproveSubmission(
      makeSubmission({
        source_type: SUBMISSION_SOURCE_TYPE.incoming_invoice,
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a payload that isn't kind='payment'", () => {
    const r = validateApproveSubmission(
      makeSubmission({ extracted_data: { kind: "whatever" } as never }),
    );
    expect(r.success).toBe(false);
  });
});

describe("validateRejectSubmission", () => {
  it("accepts a pending submission", () => {
    const r = validateRejectSubmission(makeSubmission());
    expect(r.success).toBe(true);
  });

  it("rejects a soft-deleted submission", () => {
    const r = validateRejectSubmission(
      makeSubmission({ deleted_at: "2026-04-13T11:00:00Z" }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe("NOT_FOUND");
  });

  it("rejects an already-approved submission", () => {
    const r = validateRejectSubmission(
      makeSubmission({ review_status: SUBMISSION_STATUS.approved }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe("CONFLICT");
  });

  it("rejects an already-rejected submission", () => {
    const r = validateRejectSubmission(
      makeSubmission({ review_status: SUBMISSION_STATUS.rejected }),
    );
    expect(r.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

describe("normalizers", () => {
  it("normalizeDirection accepts es/en aliases", () => {
    expect(normalizeDirection("inbound")).toBe("inbound");
    expect(normalizeDirection("Entrada")).toBe("inbound");
    expect(normalizeDirection("IN")).toBe("inbound");
    expect(normalizeDirection("outbound")).toBe("outbound");
    expect(normalizeDirection("salida")).toBe("outbound");
    expect(normalizeDirection("")).toBeNull();
    expect(normalizeDirection("sideways")).toBeNull();
  });

  it("normalizeCurrency accepts common aliases", () => {
    expect(normalizeCurrency("PEN")).toBe("PEN");
    expect(normalizeCurrency("soles")).toBe("PEN");
    expect(normalizeCurrency("S/")).toBe("PEN");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("$")).toBe("USD");
    expect(normalizeCurrency("eur")).toBeNull();
  });

  it("normalizeLineType accepts en + es", () => {
    expect(normalizeLineType("invoice")).toBe("invoice");
    expect(normalizeLineType("factura")).toBe("invoice");
    expect(normalizeLineType("bank-fee")).toBe("bank_fee");
    expect(normalizeLineType("comisión")).toBe("bank_fee");
    expect(normalizeLineType("detraccion")).toBe("detraction");
    expect(normalizeLineType("otro")).toBeNull();
  });

  it("normalizeDate accepts ISO and DD/MM/YYYY", () => {
    expect(normalizeDate("2026-04-02")).toBe("2026-04-02");
    expect(normalizeDate("02/04/2026")).toBe("2026-04-02");
    expect(normalizeDate("2/4/2026")).toBe("2026-04-02");
    expect(normalizeDate("02-04-2026")).toBe("2026-04-02");
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("garbage")).toBeNull();
  });

  it("parseNumberOrNull handles Spanish and English decimals", () => {
    expect(parseNumberOrNull("1234.50")).toBe(1234.5);
    expect(parseNumberOrNull("1,234.50")).toBe(1234.5);
    expect(parseNumberOrNull("1234,50")).toBe(1234.5);
    expect(parseNumberOrNull("")).toBeNull();
    expect(parseNumberOrNull("abc")).toBeNull();
  });

  it("parseBoolean accepts truthy variants", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("si")).toBe(true);
    expect(parseBoolean("sí")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("")).toBe(false);
    expect(parseBoolean("no")).toBe(false);
  });
});
