DROP INDEX `translations_state`;--> statement-breakpoint
CREATE INDEX `translations_language_state` ON `string_translations` (`language`,`state`,`stale`,`string_id`);