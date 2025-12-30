CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`template_used` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`snapshot_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_number_unique` ON `issues` (`number`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`summary` text NOT NULL,
	`approach` text NOT NULL,
	`estimated_complexity` text NOT NULL,
	`generated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_number` integer NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`snapshot_type` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `task_status_history` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`changed_by` text,
	`changed_at` text NOT NULL,
	`notes` text,
	`session_id` text,
	`hook_results` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`estimated_minutes` integer,
	`matched_from_task_id` text,
	`match_confidence` real,
	`session_id` text,
	`session_started_at` text,
	`last_session_activity_at` text,
	`hook_config_labels` text DEFAULT '[]',
	`started_at` text,
	`completed_at` text,
	`abandoned_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
