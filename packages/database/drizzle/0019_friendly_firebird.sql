-- Add index column for display purposes (1-based position among active tasks)
-- task.number is immutable; task.index is renumbered on plan changes
-- New tasks get index assigned at creation; existing tasks will be reindexed on next plan regeneration
ALTER TABLE `tasks` ADD `index` integer DEFAULT 1 NOT NULL;
