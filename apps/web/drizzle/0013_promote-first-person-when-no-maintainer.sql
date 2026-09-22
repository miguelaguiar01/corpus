-- An instance that started as a workbench between 0.8.0 and 0.16.0 has
-- no maintainer and no way to get one (#525): joining decided the first
-- account was a maintainer by asking whether `users` was empty, and the
-- project's agent actor was already in it. Nothing can promote anybody
-- afterwards, because that needs a maintainer.
--
-- Promote the earliest person, and only when there is no maintainer at
-- all: an instance whose maintainer stepped down deliberately cannot
-- reach zero, since that action refuses the last one.
UPDATE users
SET maintainer = true
WHERE agent = false
  AND id = (SELECT MIN(id) FROM users WHERE agent = false)
  AND NOT EXISTS (SELECT 1 FROM users WHERE maintainer = true);
