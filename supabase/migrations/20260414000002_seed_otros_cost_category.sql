-- Seed an "Otros" top-level cost category.
--
-- Context: payment_lines.cost_category_id classifies uninvoiced lines
-- (general expenses, bank fees, miscellaneous outflows). The four seed
-- categories from 20260409000007 cover the main construction buckets
-- (Materiales, Mano de Obra, Alquiler de Equipos, Viáticos), but there
-- was no catch-all for anything that doesn't fit — which is exactly the
-- case the CSV importer hits most often for small miscellaneous outflows.
--
-- Idempotent: ON CONFLICT targets the UNIQUE NULLS NOT DISTINCT constraint
-- installed by 20260410000001, so re-running the migration is a no-op.

INSERT INTO cost_categories (name, parent_id, sort_order, is_active)
VALUES ('Otros', NULL, 99, true)
ON CONFLICT ON CONSTRAINT cost_categories_parent_name_key DO NOTHING;
