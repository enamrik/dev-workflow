CREATE TABLE `types` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`color` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `types_name_unique` ON `types` (`name`);