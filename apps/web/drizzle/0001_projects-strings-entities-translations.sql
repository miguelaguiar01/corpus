CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`entity_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`attributes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entities_project_entity_id` ON `entities` (`project_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`source_language` text NOT NULL,
	`languages` text NOT NULL,
	`token_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `string_translations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`string_id` integer NOT NULL,
	`language` text NOT NULL,
	`text` text,
	`state` text DEFAULT 'untranslated' NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`string_id`) REFERENCES `strings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translations_string_language` ON `string_translations` (`string_id`,`language`);--> statement-breakpoint
CREATE INDEX `translations_state` ON `string_translations` (`state`);--> statement-breakpoint
CREATE TABLE `strings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`string_id` text NOT NULL,
	`type` text NOT NULL,
	`source` text NOT NULL,
	`metadata` text,
	`examples` text,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strings_project_string_id` ON `strings` (`project_id`,`string_id`);