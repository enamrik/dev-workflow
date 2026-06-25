CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`git_root_hash` text NOT NULL,
	`name` text NOT NULL,
	`git_root` text NOT NULL,
	`github_sync` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_git_root_hash_unique` ON `projects` (`git_root_hash`);