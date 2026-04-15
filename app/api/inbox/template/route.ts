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
  // group_id, payment_date, direction, bank_account, currency, bank_reference,
  // partner_ruc, title, line_amount, project_code, invoice_number,
  // cost_category, line_description, drive_file_id
  //
  // The `title` column is the payment-level memo — typically the bank
  // statement's own description of the transaction. The `line_description`
  // column is only interesting on multi-line payments where each slice
  // (invoice, bank fee, general expense) needs its own label.
  //
  // Optional / defaulted fields:
  //   - partner_ruc: blank = Korakuen. Fill in only when one of the other
  //     consortium partners actually moved the money — feeds settlement.
  //   - bank_account: blank ONLY when partner_ruc is a non-Korakuen partner.
  //     Interpretation: "off-book" — the partner paid from their own funds,
  //     so no Korakuen bank account is involved. When partner_ruc is blank
  //     (Korakuen is the payer), a bank account is mandatory.
  //   - project_code: header-level by domain rule (one payment = one project).
  //     Write it once on the first row of a group; continuation rows can be
  //     blank (they inherit) or repeat the same value. Conflicting values
  //     across rows of the same group_id are rejected.
  //   - drive_file_id: filename of the supporting document (e.g.
  //     "PRY001-PY-002.jpeg"). Despite the name, it stores a plain filename,
  //     not a Google Drive id. Header-level and inheritable (same rule as
  //     project_code: write once on the first row, continuation rows can
  //     be blank).
  //
  // Fields that USED to live on the CSV and no longer do:
  //   - exchange_rate: always auto-resolved from the BCRP rate for the
  //     payment_date (USD only; ignored for PEN). Manual overrides happen
  //     via the inbox UI, not the CSV.
  //   - is_detraction: derived from bank_account.account_type (the
  //     banco_de_la_nacion flag) at approval time. The user picks the right
  //     account; the flag follows.
  //   - contact_ruc: counterparty is not an intake-time field. When a line
  //     is linked to an invoice, the contact comes from the invoice chain;
  //     unlinked lines are treated as informal / unknown. Can be filled
  //     post-approval if needed.
  const examples = [
    // P001 — single-line inbound, Korakuen collects from a client,
    // supporting file name written on row 1.
    `P001,2026-04-02,inbound,BCP PEN,PEN,OP-445511,,Cobro cliente,11800.00,PROY001,F001-00045,,,PROY001-PY-001.jpeg`,
    // P002 — three-line outbound, Korakuen pays a vendor with fee + general cost.
    // project_code and drive_file_id filled on the first row only;
    // continuation rows inherit.
    `P002,2026-04-03,outbound,BCP PEN,PEN,TRF-998877,,Pago proveedor,5900.00,PROY001,F001-00089,,,PROY001-PY-002.jpeg`,
    `P002,2026-04-03,outbound,BCP PEN,PEN,TRF-998877,,Pago proveedor,12.50,,,Comisiones bancarias,comisión de transferencia,`,
    `P002,2026-04-03,outbound,BCP PEN,PEN,TRF-998877,,Pago proveedor,100.00,,,Materiales,materiales varios,`,
    // P003 — off-book outbound paid out of pocket by Partner B: bank_account
    // is BLANK because no Korakuen account moved; partner_ruc identifies who
    // covered the payment from their own funds.
    `P003,2026-04-04,outbound,,PEN,TRF-112233,20111222333,Pago materiales (Partner B),2500.00,PROY001,,Materiales,pagó Partner B,PROY001-PY-003.jpeg`,
    // P004 — outbound cash purchase from an informal vendor, no supporting file.
    `P004,2026-04-05,outbound,BCP PEN,PEN,RET-445566,,Compra materiales informal,450.00,PROY001,,Materiales,Don Pedro ferretería,`,
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
