-- The next push resends every seed, so a restructured English copy an
-- earlier push stored as translated is the source's text (#1009).
UPDATE `projects` SET `seed_digests` = NULL;
