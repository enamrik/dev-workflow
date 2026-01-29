CREATE TABLE `dispatch_queue` (
	`task_id` text PRIMARY KEY NOT NULL,
	`worker_id` text,
	`claimed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'IDLE' NOT NULL,
	`last_heartbeat` text NOT NULL,
	`created_at` text NOT NULL
);
