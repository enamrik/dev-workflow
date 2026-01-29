-- Migrate existing PENDING tasks to READY (plan was already started)
-- New tasks will be created as BACKLOG, and transition to READY when first task starts
UPDATE tasks SET status = 'READY' WHERE status = 'PENDING';
