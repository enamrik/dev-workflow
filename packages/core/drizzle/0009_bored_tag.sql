ALTER TABLE `projects` ADD `slug` text;--> statement-breakpoint
UPDATE `projects` SET `slug` = LOWER(REPLACE(REPLACE(REPLACE(`name`, ' ', '-'), '_', '-'), '.', '-')) || '-' || SUBSTR(`git_root_hash`, 1, 6) WHERE `slug` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);
