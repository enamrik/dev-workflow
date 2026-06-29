DROP INDEX `milestones_project_number_idx`;--> statement-breakpoint
ALTER TABLE `milestones` DROP COLUMN `project_id`;--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_number_idx` ON `milestones` (`number`);
