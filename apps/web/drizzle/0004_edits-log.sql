CREATE TABLE `edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`string_id` integer NOT NULL,
	`language` text NOT NULL,
	`user_id` integer NOT NULL,
	`at` integer NOT NULL,
	`old_text` text,
	`new_text` text,
	`old_state` text NOT NULL,
	`new_state` text NOT NULL,
	FOREIGN KEY (`string_id`) REFERENCES `strings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `edits_string_language` ON `edits` (`string_id`,`language`);