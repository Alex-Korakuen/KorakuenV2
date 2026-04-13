-- Migration: inbox staging delta
-- Adds columns and indexes for the CSV bulk-import / Inbox staging workflow.
--
-- Three changes:
--
-- 1. `submissions` gains `import_batch_id` (uuid) and `import_batch_label` (text)
--    so one CSV upload = one batch id shared across all its rows, with the
--    filename denormalized on each row for banner display without a JOIN.
--
-- 2. `contacts` gains `created_via_inbox` (boolean) so auto-created contacts
--    from unknown RUCs in a CSV import can be flagged for later review.
--    Regular contacts created via the New Contact dialog stay false.
--
-- 3. `payments.source` comment is extended to document the new `3=csv_import`
--    value. The column itself is an unconstrained smallint so no CHECK to edit.

-- ============================================================
-- submissions — batch grouping
-- ============================================================

ALTER TABLE submissions
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN import_batch_label text;

COMMENT ON COLUMN submissions.import_batch_id IS
  'Shared across all rows from a single CSV upload. Null for scan-app submissions.';

COMMENT ON COLUMN submissions.import_batch_label IS
  'Denormalized batch label (usually the uploaded filename). Repeated per row.';

-- Fast lookup of all rows in a given batch (Inbox banner, bulk approve).
CREATE INDEX idx_submissions_import_batch
  ON submissions(import_batch_id)
  WHERE deleted_at IS NULL AND import_batch_id IS NOT NULL;

-- Composite index for the main Inbox list query:
-- filter by source type + review status, optionally narrowed by batch.
CREATE INDEX idx_submissions_source_status_batch
  ON submissions(source_type, review_status, import_batch_id)
  WHERE deleted_at IS NULL;

-- ============================================================
-- contacts — auto-created flag
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN created_via_inbox boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.created_via_inbox IS
  'True when this contact was auto-created by the Inbox CSV import flow (unknown RUC resolved via SUNAT lookup). Lets the contacts list flag entries that were never human-reviewed.';

-- ============================================================
-- payments — document new source value
-- ============================================================

COMMENT ON COLUMN payments.source IS
  '1=manual, 2=scan_app, 3=csv_import';
