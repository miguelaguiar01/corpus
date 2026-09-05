import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolvePaths } from "./locate";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

// The database file and the migrations folder, from env overrides or
// the app root (see locate.ts). Evaluated per call so the env read stays
// lazy and tests can point elsewhere.
export function resolvedPaths(): { migrationsDir: string; dbPath: string } {
  return resolvePaths({
    moduleDir: path.dirname(fileURLToPath(import.meta.url)),
    cwd: process.cwd(),
    env: process.env,
  });
}

// The SQLite file lives on a volume in the Docker deployment (§2) and
// under the app root locally; either way the same code path.
export function openDb(
  file: string = resolvedPaths().dbPath,
  migrationsFolder: string = resolvedPaths().migrationsDir,
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
