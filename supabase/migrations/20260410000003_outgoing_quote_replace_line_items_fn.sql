-- Migration: outgoing quote batch-replace line items RPC
--
-- Atomic replace of all line items on a draft outgoing quote. Runs as a
-- single transaction so a mid-operation failure never leaves a quote with
-- a partially-rewritten line set. Header totals (subtotal, igv_amount,
-- total) are recomputed from the new line items before the function
-- returns.
--
-- Called from app/actions/outgoing-quotes.ts → setOutgoingQuoteLineItems.
-- The server action has already called requireAdmin(); RLS enforces
-- admin-only mutations at the table level.

CREATE OR REPLACE FUNCTION replace_outgoing_quote_line_items(
  p_quote_id uuid,
  p_items    jsonb
) RETURNS SETOF outgoing_quote_line_items
LANGUAGE plpgsql
AS $$
DECLARE
  v_status     smallint;
  v_deleted_at timestamptz;
BEGIN
  -- Lock the parent row and verify it's a live draft
  SELECT status, deleted_at
    INTO v_status, v_deleted_at
    FROM outgoing_quotes
    WHERE id = p_quote_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outgoing_quote % not found', p_quote_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'outgoing_quote % is soft-deleted', p_quote_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 1 THEN  -- 1 = draft
    RAISE EXCEPTION 'outgoing_quote % is not in draft status (current status: %)', p_quote_id, v_status
      USING ERRCODE = 'P0001';
  END IF;

  -- Replace line items
  DELETE FROM outgoing_quote_line_items
    WHERE outgoing_quote_id = p_quote_id;

  INSERT INTO outgoing_quote_line_items (
    outgoing_quote_id, sort_order, description, unit, quantity,
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

  -- Recompute header totals from the new line items
  UPDATE outgoing_quotes
  SET
    subtotal   = COALESCE((SELECT SUM(subtotal)   FROM outgoing_quote_line_items WHERE outgoing_quote_id = p_quote_id), 0),
    igv_amount = COALESCE((SELECT SUM(igv_amount) FROM outgoing_quote_line_items WHERE outgoing_quote_id = p_quote_id), 0),
    total      = COALESCE((SELECT SUM(total)      FROM outgoing_quote_line_items WHERE outgoing_quote_id = p_quote_id), 0),
    updated_at = now()
  WHERE id = p_quote_id;

  RETURN QUERY
  SELECT *
    FROM outgoing_quote_line_items
    WHERE outgoing_quote_id = p_quote_id
    ORDER BY sort_order;
END;
$$;
