-- Migration: outgoing invoice batch-replace line items RPC
--
-- Atomic replace of all line items on a draft outgoing invoice. Runs as a
-- single transaction so a mid-operation failure never leaves an invoice
-- with a partially-rewritten line set. Header totals (subtotal, igv_amount,
-- total, total_pen) are recomputed from the new line items before the
-- function returns. total_pen uses the invoice's stored exchange_rate when
-- currency is USD.
--
-- Called from app/actions/outgoing-invoices.ts → setOutgoingInvoiceLineItems.
-- Symmetric to replace_outgoing_quote_line_items from migration
-- 20260410000003, with the additional total_pen recompute.

CREATE OR REPLACE FUNCTION replace_outgoing_invoice_line_items(
  p_invoice_id uuid,
  p_items      jsonb
) RETURNS SETOF outgoing_invoice_line_items
LANGUAGE plpgsql
AS $$
DECLARE
  v_status        smallint;
  v_deleted_at    timestamptz;
  v_currency      text;
  v_exchange_rate numeric;
BEGIN
  -- Lock the parent row and verify it's a live draft
  SELECT status, deleted_at, currency, exchange_rate
    INTO v_status, v_deleted_at, v_currency, v_exchange_rate
    FROM outgoing_invoices
    WHERE id = p_invoice_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outgoing_invoice % not found', p_invoice_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'outgoing_invoice % is soft-deleted', p_invoice_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 1 THEN  -- 1 = draft
    RAISE EXCEPTION 'outgoing_invoice % is not in draft status (current status: %)', p_invoice_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Replace line items
  DELETE FROM outgoing_invoice_line_items
    WHERE outgoing_invoice_id = p_invoice_id;

  INSERT INTO outgoing_invoice_line_items (
    outgoing_invoice_id, sort_order, description, unit, quantity,
    unit_price, subtotal, igv_applies, igv_amount, total, notes
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
    item->>'notes'
  FROM jsonb_array_elements(p_items) AS item;

  -- Recompute header totals from the new line items.
  -- total_pen: equal to total for PEN, total * exchange_rate for USD.
  UPDATE outgoing_invoices
  SET
    subtotal   = COALESCE((SELECT SUM(subtotal)   FROM outgoing_invoice_line_items WHERE outgoing_invoice_id = p_invoice_id), 0),
    igv_amount = COALESCE((SELECT SUM(igv_amount) FROM outgoing_invoice_line_items WHERE outgoing_invoice_id = p_invoice_id), 0),
    total      = COALESCE((SELECT SUM(total)      FROM outgoing_invoice_line_items WHERE outgoing_invoice_id = p_invoice_id), 0),
    total_pen  = CASE
                   WHEN v_currency = 'PEN' THEN
                     COALESCE((SELECT SUM(total) FROM outgoing_invoice_line_items WHERE outgoing_invoice_id = p_invoice_id), 0)
                   ELSE
                     ROUND(
                       COALESCE((SELECT SUM(total) FROM outgoing_invoice_line_items WHERE outgoing_invoice_id = p_invoice_id), 0)
                       * COALESCE(v_exchange_rate, 0),
                       2
                     )
                 END,
    updated_at = now()
  WHERE id = p_invoice_id;

  RETURN QUERY
  SELECT *
    FROM outgoing_invoice_line_items
    WHERE outgoing_invoice_id = p_invoice_id
    ORDER BY sort_order;
END;
$$;
