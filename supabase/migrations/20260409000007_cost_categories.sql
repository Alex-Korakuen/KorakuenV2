-- Migration: cost_categories
-- Admin-managed list of cost categories for tagging incoming invoices and payment lines.
-- Categories are never deleted — set is_active = false to retire.

CREATE TABLE cost_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed data
INSERT INTO cost_categories (name, sort_order) VALUES
  ('Materiales', 1),
  ('Mano de Obra', 2),
  ('Alquiler de Equipos', 3),
  ('Viaticos', 4);
