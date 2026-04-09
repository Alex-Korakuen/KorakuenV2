-- Migration: bank account balance derivation functions
-- Balance is never stored — always derived from payments at query time.

-- Batch: returns balance_pen for multiple accounts in one call.
CREATE OR REPLACE FUNCTION get_bank_account_balances(account_ids uuid[])
RETURNS TABLE(bank_account_id uuid, balance_pen numeric) AS $$
  SELECT
    aid.id AS bank_account_id,
    COALESCE(SUM(
      CASE WHEN p.direction = 1 THEN p.total_amount_pen ELSE -p.total_amount_pen END
    ), 0) AS balance_pen
  FROM unnest(account_ids) AS aid(id)
  LEFT JOIN payments p
    ON p.bank_account_id = aid.id
   AND p.deleted_at IS NULL
  GROUP BY aid.id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Single: returns balance_pen for one account.
CREATE OR REPLACE FUNCTION get_bank_account_balance(p_account_id uuid)
RETURNS numeric AS $$
  SELECT COALESCE(SUM(
    CASE WHEN direction = 1 THEN total_amount_pen ELSE -total_amount_pen END
  ), 0)
  FROM payments
  WHERE bank_account_id = p_account_id
    AND deleted_at IS NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
