CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`priority` text NOT NULL,
	`status` text NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`template_used` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`github_issue_number` integer,
	`github_url` text,
	`github_node_id` text,
	`github_sync_status` text,
	`github_last_synced_at` text,
	`github_last_sync_error` text,
	`github_project_item_id` text,
	`milestone_id` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_project_number_idx` ON `issues` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_number_idx` ON `milestones` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`summary` text NOT NULL,
	`approach` text NOT NULL,
	`estimated_complexity` text NOT NULL,
	`generated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`issue_number` integer NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`snapshot_type` text NOT NULL,
	`issue_state` text NOT NULL,
	`plan_state` text,
	`tasks_state` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_project_issue_version_idx` ON `snapshots` (`project_id`,`issue_number`,`version`);--> statement-breakpoint
CREATE TABLE `task_execution_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message` text NOT NULL,
	`files_modified` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`number` integer NOT NULL,
	`order` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`source` text DEFAULT 'generated' NOT NULL,
	`acceptance_criteria` text DEFAULT '[]' NOT NULL,
	`estimated_minutes` integer,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`matched_from_task_id` text,
	`match_confidence` real,
	`session_id` text,
	`session_started_at` text,
	`last_session_activity_at` text,
	`labels` text DEFAULT '[]',
	`context_instructions` text,
	`depends_on` text DEFAULT '[]',
	`started_at` text,
	`completed_at` text,
	`abandoned_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
