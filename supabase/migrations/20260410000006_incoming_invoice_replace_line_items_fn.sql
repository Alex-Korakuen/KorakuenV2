-- Migration: incoming invoice batch-replace line items RPC
--
-- Atomic replace of all line items on an expected incoming invoice. Runs
-- as a single transaction so a mid-operation failure never leaves an
-- invoice with a partially-rewritten line set. Header totals (subtotal,
-- igv_amount, total, total_pen) are recomputed from the new line items
-- before the function returns. total_pen uses the invoice's stored
-- exchange_rate when currency is USD.
--
-- Gate: only runs while factura_status = 1 (expected). Received invoices
-- are frozen per the ii_received_requires_sunat constraint and the server
-- action layer's assertLineItemsMutable check — this function refuses
-- the operation as a second line of defence for direct DB callers.
--
-- Per-line cost_category_id is supported (Step 6.5 added the column on
-- incoming_invoice_line_items). Missing keys insert NULL.
--
-- Called from app/actions/incoming-invoices.ts → setIncomingInvoiceLineItems
-- and from trackIncomingQuoteAsExpectedInvoice when cloning line items
-- from an approved quote.

CREATE OR REPLACE FUNCTION replace_incoming_invoice_line_items(
  p_invoice_id uuid,
  p_items      jsonb
) RETURNS SETOF incoming_invoice_line_items
LANGUAGE plpgsql
AS $$
DECLARE
  v_factura_status smallint;
  v_deleted_at     timestamptz;
  v_currency       text;
  v_exchange_rate  numeric;
BEGIN
  -- Lock the parent row and verify it's a live expected invoice
  SELECT factura_status, deleted_at, currency, exchange_rate
    INTO v_factura_status, v_deleted_at, v_currency, v_exchange_rate
    FROM incoming_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incoming_invoice % not found', p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'incoming_invoice % is soft-deleted', p_invoice_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_factura_status <> 1 THEN  -- 1 = expected
    RAISE EXCEPTION 'incoming_invoice % is not in expected factura_status (current: %)', p_invoice_id, v_factura_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Replace line items
  DELETE FROM incoming_invoice_line_items
    WHERE incoming_invoice_id = p_invoice_id;

  INSERT INTO incoming_invoice_line_items (
    incoming_invoice_id, sort_order, description, unit, quantity,
    unit_price, subtotal, igv_applies, igv_amount, total,
    cost_category_id, notes
  )
  SELECT
    p_invoice_id,
    COALESCE((item->>'sort_order')::smallint, (row_number() OVER () - 1)::smallint),
    item->>'description',
    item->>'unit',
    (item->>'quantity')::numeric,
    (item->>'unit_price')::numeric,
    (item->>'subtotal')::numeric,
    COALESCE((item->>'igv_applies')::boolean, true),
    COALESCE((item->>'igv_amount')::numeric, 0),
    (item->>'total')::numeric,
    NULLIF(item->>'cost_category_id', '')::uuid,
    item->>'notes'
  FROM jsonb_array_elements(p_items) AS item;

  -- Recompute header totals from the new line items.
  -- total_pen: equal to total for PEN, total * exchange_rate for USD.
  UPDATE incoming_invoices
  SET
    subtotal   = COALESCE((SELECT SUM(subtotal)   FROM incoming_invoice_line_items WHERE incoming_invoice_id = p_invoice_id), 0),
    igv_amount = COALESCE((SELECT SUM(igv_amount) FROM incoming_invoice_line_items WHERE incoming_invoice_id = p_invoice_id), 0),
    total      = COALESCE((SELECT SUM(total)      FROM incoming_invoice_line_items WHERE incoming_invoice_id = p_invoice_id), 0),
    total_pen  = CASE
                   WHEN v_currency = 'PEN' THEN
                     COALESCE((SELECT SUM(total) FROM incoming_invoice_line_items WHERE incoming_invoice_id = p_invoice_id), 0)
                   ELSE
                     ROUND(
                       COALESCE((SELECT SUM(total) FROM incoming_invoice_line_items WHERE incoming_invoice_id = p_invoice_id), 0)
                       * COALESCE(v_exchange_rate, 0),
                       2
                     )
                 END,
    updated_at = now()
  WHERE id = p_invoice_id;

  RETURN QUERY
  SELECT *
    FROM incoming_invoice_line_items
    WHERE incoming_invoice_id = p_invoice_id
    ORDER BY sort_order;
END;
$$;
