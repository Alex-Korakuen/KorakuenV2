-- Migration: incoming quote batch-replace line items RPC
--
-- Atomic replace of all line items on a draft incoming quote. Runs as a
-- single transaction so a mid-operation failure never leaves a quote with
-- a partially-rewritten line set. Header totals (subtotal, igv_amount,
-- total, total_pen) are recomputed from the new line items before the
-- function returns. total_pen uses the quote's stored exchange_rate when
-- currency is USD.
--
-- Called from app/actions/incoming-quotes.ts → setIncomingQuoteLineItems.
-- Symmetric to replace_outgoing_quote_line_items from migration
-- 20260410000003, with the additional total_pen recompute that incoming
-- quotes need (outgoing quotes don't store an exchange_rate at all).

CREATE OR REPLACE FUNCTION replace_incoming_quote_line_items(
  p_quote_id uuid,
  p_items    jsonb
) RETURNS SETOF incoming_quote_line_items
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
    FROM incoming_quotes
    WHERE id = p_quote_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incoming_quote % not found', p_quote_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'incoming_quote % is soft-deleted', p_quote_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 1 THEN  -- 1 = draft
    RAISE EXCEPTION 'incoming_quote % is not in draft status (current status: %)', p_quote_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Replace line items
  DELETE FROM incoming_quote_line_items
    WHERE incoming_quote_id = p_quote_id;

  INSERT INTO incoming_quote_line_items (
    incoming_quote_id, sort_order, description, unit, quantity,
    unit_price, subtotal, igv_applies, igv_amount, total, notes
  )
  SELECT
    p_quote_id,
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
  UPDATE incoming_quotes
  SET
    subtotal   = COALESCE((SELECT SUM(subtotal)   FROM incoming_quote_line_items WHERE incoming_quote_id = p_quote_id), 0),
    igv_amount = COALESCE((SELECT SUM(igv_amount) FROM incoming_quote_line_items WHERE incoming_quote_id = p_quote_id), 0),
    total      = COALESCE((SELECT SUM(total)      FROM incoming_quote_line_items WHERE incoming_quote_id = p_quote_id), 0),
    total_pen  = CASE
                   WHEN v_currency = 'PEN' THEN
                     COALESCE((SELECT SUM(total) FROM incoming_quote_line_items WHERE incoming_quote_id = p_quote_id), 0)
                   ELSE
                     ROUND(
                       COALESCE((SELECT SUM(total) FROM incoming_quote_line_items WHERE incoming_quote_id = p_quote_id), 0)
                       * COALESCE(v_exchange_rate, 0),
                       2
                     )
                 END,
    updated_at = now()
  WHERE id = p_quote_id;

  RETURN QUERY
  SELECT *
    FROM incoming_quote_line_items
    WHERE incoming_quote_id = p_quote_id
    ORDER BY sort_order;
END;
$$;
