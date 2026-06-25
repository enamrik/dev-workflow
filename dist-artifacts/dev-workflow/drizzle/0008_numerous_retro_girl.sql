ALTER TABLE `tasks` ADD `github_issue_number` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_url` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_node_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_sync_status` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_last_synced_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_last_sync_error` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `github_project_item_id` text;--> statement-breakpoint
-- Data migration: Move existing OPEN issues to PLANNED status
UPDATE `issues` SET `status` = 'PLANNED' WHERE `status` = 'OPEN';--> statement-breakpoint
-- Data migration: Move existing BACKLOG/READY tasks to PLANNED status
UPDATE `tasks` SET `status` = 'PLANNED' WHERE `status` IN ('BACKLOG', 'READY');