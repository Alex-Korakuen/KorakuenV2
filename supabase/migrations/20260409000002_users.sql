-- Migration: users
-- Supabase Auth mirror. One row per authenticated user.

CREATE TABLE users (
  id              uuid PRIMARY KEY,                        -- mirrors auth.users.id
  email           text NOT NULL,
  display_name    text,
  role            smallint NOT NULL DEFAULT 2,              -- 1=admin, 2=partner
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
