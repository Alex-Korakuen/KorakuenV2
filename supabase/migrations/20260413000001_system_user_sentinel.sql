-- Migration: system user sentinel
-- Creates a sentinel row in `users` with the all-zeros UUID, matching the
-- COALESCE fallback in the log_financial_mutation trigger (migration 15).
--
-- Why: service-role connections (maintenance scripts, CLI, direct psql) have
-- no Supabase Auth session, so `auth.uid()` returns NULL inside the trigger.
-- The trigger falls back to '00000000-0000-0000-0000-000000000000' as the
-- actor, but activity_log.actor_user_id is FK'd to users(id) NOT NULL. Without
-- this row any service-role write to a logged table fails on FK violation.

INSERT INTO users (id, email, display_name, role)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@korakuen.internal',
  'System',
  1
)
ON CONFLICT (id) DO NOTHING;
