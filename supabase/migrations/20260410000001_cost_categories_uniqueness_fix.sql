-- Migration: cost_categories uniqueness fix
--
-- Discovered via psql constraint smoke test on 2026-04-10. The
-- UNIQUE (parent_id, name) constraint added in Step 6.5a does not
-- prevent duplicate top-level category names because PostgreSQL's
-- default unique constraint semantics treat NULL values as distinct.
-- Two rows with (NULL, 'Materiales') are considered distinct from
-- each other, so the constraint only enforces uniqueness for
-- sub-categories (where parent_id IS NOT NULL).
--
-- The pre-6.5a constraint was a strict UNIQUE (name) that correctly
-- prevented duplicates at every level. Step 6.5a replaced it with a
-- scoped version to allow sub-categories to share names across
-- branches, but did so using default NULL semantics — a silent
-- regression for top-level uniqueness.
--
-- Fix: replace with UNIQUE NULLS NOT DISTINCT (Postgres 15+, runtime
-- is 17.6) which treats NULL values as equal for constraint purposes.
-- One constraint expresses both the top-level-unique and
-- scoped-sub-category-unique intents cleanly.

ALTER TABLE cost_categories
  DROP CONSTRAINT cost_categories_parent_name_key;

ALTER TABLE cost_categories
  ADD CONSTRAINT cost_categories_parent_name_key
  UNIQUE NULLS NOT DISTINCT (parent_id, name);
