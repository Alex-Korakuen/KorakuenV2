-- Drop the `archived` project status (value 4).
--
-- The status was introduced as a "hide old completed projects" flag but was
-- never used in practice. The lifecycle is now:
--   prospect → active → completed (terminal)
--                     ↘ rejected  (terminal)
--   prospect ↘ rejected (terminal)
--
-- Value 4 is left as a gap rather than renumbered: renumbering would require
-- rewriting existing rows, and no current rows hold status = 4 anyway.

ALTER TABLE projects
  ADD CONSTRAINT projects_status_valid
  CHECK (status IN (1, 2, 3, 5));

COMMENT ON COLUMN projects.status IS
  '1=prospect, 2=active, 3=completed, 5=rejected';
