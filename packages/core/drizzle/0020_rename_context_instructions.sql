-- Rename context_instructions column to implementation_plan in tasks table
-- This is a backward-compatible change - existing data is preserved
ALTER TABLE tasks RENAME COLUMN context_instructions TO implementation_plan;
