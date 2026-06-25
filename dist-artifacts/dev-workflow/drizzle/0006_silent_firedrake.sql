ALTER TABLE `projects` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `archived_at` text;