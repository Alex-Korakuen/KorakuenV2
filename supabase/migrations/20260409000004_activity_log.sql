-- Migration: activity_log
-- Immutable audit trail. Append-only. Never updated or deleted.

CREATE TABLE activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type   text NOT NULL,                            -- e.g. 'outgoing_invoice'
  resource_id     uuid NOT NULL,
  action          smallint NOT NULL,                        -- 1=created, 2=updated, 3=approved, 4=voided, 5=deleted, 6=restored, 7=matched
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  before_state    jsonb,
  after_state     jsonb,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
