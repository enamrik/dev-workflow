ALTER TABLE `dispatch_queue` ADD `claude_done` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `dispatch_queue` RENAME COLUMN `released_at` TO `claude_done_at`;
