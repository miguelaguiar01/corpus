ALTER TABLE `string_translations` ADD `invalid` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `translations_invalid` ON `string_translations` (`language`,`string_id`) WHERE "string_translations"."invalid" = 1;--> statement-breakpoint
-- The next push resends every seed, so the rows it already holds are checked (#646).
UPDATE `projects` SET `seed_digests` = NULL;