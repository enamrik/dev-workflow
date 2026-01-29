ALTER TABLE `issues` RENAME COLUMN `github_issue_number` TO `external_id`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_url` TO `external_url`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_node_id` TO `external_node_id`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_sync_status` TO `sync_status`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_last_synced_at` TO `last_synced_at`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_last_sync_error` TO `last_sync_error`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `github_project_item_id` TO `remote_project_id`;--> statement-breakpoint
ALTER TABLE `issues` RENAME COLUMN `source_github_issue_number` TO `source_external_id`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_issue_number` TO `external_id`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_url` TO `external_url`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_node_id` TO `external_node_id`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_sync_status` TO `sync_status`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_last_synced_at` TO `last_synced_at`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_last_sync_error` TO `last_sync_error`;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `github_project_item_id` TO `remote_project_id`;--> statement-breakpoint
ALTER TABLE `projects` RENAME COLUMN `github_sync` TO `sync_config`;
