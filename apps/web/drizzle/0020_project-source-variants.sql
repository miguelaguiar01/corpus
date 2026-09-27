ALTER TABLE `projects` ADD `source_variants` text;--> statement-breakpoint
-- The next push resends every seed, so marks and variants an earlier CLI sent apply (#658).
UPDATE `projects` SET `seed_digests` = NULL;