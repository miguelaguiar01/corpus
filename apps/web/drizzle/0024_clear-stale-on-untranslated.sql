-- A row a push left untranslated kept its stale mark before #934; an
-- untranslated row has nothing to be stale (#620).
UPDATE `string_translations` SET `stale` = 0 WHERE `state` = 'untranslated' AND `stale` = 1;
