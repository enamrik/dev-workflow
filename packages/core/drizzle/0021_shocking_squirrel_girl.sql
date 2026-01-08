ALTER TABLE `dispatch_queue` ADD `status` text DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE `dispatch_queue` ADD `released_at` text;