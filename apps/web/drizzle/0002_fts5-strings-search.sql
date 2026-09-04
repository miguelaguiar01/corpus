CREATE VIRTUAL TABLE strings_fts USING fts5(
  source,
  content='strings',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER strings_fts_ai AFTER INSERT ON strings BEGIN
  INSERT INTO strings_fts(rowid, source) VALUES (new.id, new.source);
END;
--> statement-breakpoint
CREATE TRIGGER strings_fts_ad AFTER DELETE ON strings BEGIN
  INSERT INTO strings_fts(strings_fts, rowid, source) VALUES('delete', old.id, old.source);
END;
--> statement-breakpoint
CREATE TRIGGER strings_fts_au AFTER UPDATE ON strings BEGIN
  INSERT INTO strings_fts(strings_fts, rowid, source) VALUES('delete', old.id, old.source);
  INSERT INTO strings_fts(rowid, source) VALUES (new.id, new.source);
END;
