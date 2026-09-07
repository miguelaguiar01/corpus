CREATE TABLE `source_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`string_row_id` integer,
	`key` text NOT NULL,
	`type` text NOT NULL,
	`file` text NOT NULL,
	`text` text,
	`author_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`string_row_id`) REFERENCES `strings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `source_changes_project_status` ON `source_changes` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `source_changes_string` ON `source_changes` (`string_row_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `sources` text;--> statement-breakpoint
ALTER TABLE `strings` ADD `file` text;