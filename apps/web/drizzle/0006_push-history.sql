CREATE TABLE `pushes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`at` integer NOT NULL,
	`string_count` integer NOT NULL,
	`added` integer NOT NULL,
	`changed` integer NOT NULL,
	`stale` integer NOT NULL,
	`archived` integer NOT NULL,
	`unarchived` integer NOT NULL,
	`seeded` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pushes_project_at` ON `pushes` (`project_id`,`at`);