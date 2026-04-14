import { CSV_HEADER_COLUMNS } from "@/lib/validators/inbox";

/**
 * Serve the Inbox CSV template as a download. The header row is built
 * from the same constant the parser validates against, so renaming or
 * reordering CSV columns updates the template automatically.
 *
 * The example rows below are fictional — they exist to teach the format,
 * not to resolve against real data. Anyone uploading this file unmodified
 * will get validation errors on every row, which is the intended behavior.
 */
export async function GET() {
  const header = CSV_HEADER_COLUMNS.join(",");
  // Column order (must stay in sync with CSV_HEADER_COLUMNS):
  // group_id, payment_date, direction, bank_account, currency, exchange_rate,
  // bank_reference, is_detraction, contact_ruc, partner_ruc, title,
  // line_amount, line_type, project_code, invoice_number, cost_category,
  // line_description
  //
  // The `title` column is the payment-level memo — typically the bank
  // statement's own description of the transaction. The `line_description`
  // column is only interesting on multi-line payments where each slice
  // (invoice, bank fee, general expense) needs its own label.
  //
  // Optional fields:
  //   - contact_ruc: blank = unknown counterparty (informal vendor, cash
  //     purchase, ambiguous deposit). The payment still records in cash flow,
  //     project cost, and settlement — it just doesn't aggregate under a
  //     named client/vendor in the by-counterparty reports.
  //   - partner_ruc: blank = Korakuen. Fill in only when one of the other
  //     consortium partners actually moved the money — feeds settlement.
  //   - bank_account: blank ONLY when partner_ruc is a non-Korakuen partner.
  //     Interpretation: "off-book" — the partner paid from their own funds,
  //     so no Korakuen bank account is involved. The payment still appears
  //     in cash flow, project cost, and settlement; it just doesn't affect
  //     any Korakuen bank balance and doesn't show up in the reconciliation
  //     queue. When partner_ruc is blank (Korakuen is the payer), a bank
  //     account is mandatory.
  //   - exchange_rate: blank = auto-resolve from BCRP rate for payment_date
  //     (USD only; ignored for PEN).
  const examples = [
    // P001 — single-line inbound, Korakuen collects from a known client
    `P001,2026-04-02,inbound,BCP Soles,PEN,,OP-445511,false,20512345678,,Cobro cliente,11800.00,invoice,PRJ-2026-01,F001-00045,,`,
    // P002 — three-line outbound, Korakuen pays a known vendor with fee + general cost
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,,Pago proveedor,5900.00,invoice,PRJ-2026-01,F001-00089,,`,
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,,Pago proveedor,12.50,bank_fee,,,,comisión de transferencia`,
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,,Pago proveedor,100.00,general,PRJ-2026-01,,Materiales,materiales varios`,
    // P003 — off-book outbound paid out of pocket by Partner B: bank_account
    // is BLANK because no Korakuen account moved; partner_ruc identifies who
    // covered the payment from their own funds.
    `P003,2026-04-04,outbound,,PEN,,TRF-112233,false,20499988877,20111222333,Pago materiales (Partner B),2500.00,general,PRJ-2026-01,,Materiales,pagó Partner B`,
    // P004 — outbound cash purchase from an informal vendor (contact_ruc BLANK)
    `P004,2026-04-05,outbound,BCP Soles,PEN,,RET-445566,false,,,Compra materiales informal,450.00,general,PRJ-2026-01,,Materiales,Don Pedro ferretería`,
  ];
  const body = [header, ...examples].join("\n") + "\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-pagos.csv"',
      "Cache-Control": "no-store",
    },
  });
}
