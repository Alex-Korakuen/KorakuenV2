-- Auto-generated project codes.
--
-- Project codes are now system-assigned in the form PROY<NNN> via a sequence.
-- User input is gone — the create-project UI no longer surfaces the field,
-- and the column is NOT NULL with a DEFAULT that fires on every insert.
--
-- Cleanup of existing data:
--   - The one `PRY001` row is renamed to `PROY001` so all four existing codes
--     share the PROY prefix.
--   - Pending inbox submissions that referenced the old/typo codes
--     (`PRY001`, `PRY003`) are rewritten to their canonical equivalents, and
--     their stale validation error lists are cleared so re-validation kicks
--     in on the next edit.

UPDATE projects SET code = 'PROY001' WHERE code = 'PRY001';

UPDATE submissions
SET extracted_data = jsonb_set(extracted_data, '{header,project_code}', '"PROY001"')
WHERE extracted_data->'header'->>'project_code' = 'PRY001'
  AND review_status = 1;

UPDATE submissions
SET extracted_data = jsonb_set(extracted_data, '{header,project_code}', '"PROY003"')
WHERE extracted_data->'header'->>'project_code' = 'PRY003'
  AND review_status = 1;

UPDATE submissions
SET extracted_data = jsonb_set(extracted_data, '{validation}', '{"valid": false, "errors": []}'::jsonb)
WHERE extracted_data->'header'->>'project_code' IN ('PROY001', 'PROY003')
  AND review_status = 1;

-- Sequence: PROY001..004 already exist, so the next value is 5.
CREATE SEQUENCE projects_code_seq START WITH 5;

ALTER TABLE projects
  ALTER COLUMN code SET DEFAULT 'PROY' || LPAD(nextval('projects_code_seq')::text, 3, '0');

ALTER TABLE projects
  ALTER COLUMN code SET NOT NULL;

COMMENT ON COLUMN projects.code IS
  'Auto-generated PROY<NNN> on insert. Never user-assigned.';
