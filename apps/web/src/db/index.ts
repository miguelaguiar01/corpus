import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// The SQLite file lives on a volume in the Docker deployment (§2); the
// path is env-configurable so the container can mount it. Default args
// evaluate per call, so the env read stays lazy.
export function openDb(
  file: string = process.env.CORPUS_DB_PATH ?? path.join("data", "corpus.db"),
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

let singleton: Db | undefined;

export function getDb(): Db {
  singleton ??= openDb();
  return singleton;
}
