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
  const examples = [
    // P001 — single-line inbound payment
    `P001,2026-04-02,inbound,BCP Soles,PEN,,OP-445511,false,20512345678,Cobro cliente,11800.00,invoice,PRJ-2026-01,F001-00045,,`,
    // P002 — three-line outbound payment: invoice + bank fee + general
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,Pago proveedor,5900.00,invoice,PRJ-2026-01,F001-00089,,`,
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,Pago proveedor,12.50,bank_fee,,,,comisión de transferencia`,
    `P002,2026-04-03,outbound,BCP Soles,PEN,,TRF-998877,false,20498765432,Pago proveedor,100.00,general,PRJ-2026-01,,Materiales,materiales varios`,
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
