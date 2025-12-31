ALTER TABLE `issues` ADD `github_issue_number` integer;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_url` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_node_id` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_sync_status` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_last_synced_at` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_last_sync_error` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `github_project_item_id` text;