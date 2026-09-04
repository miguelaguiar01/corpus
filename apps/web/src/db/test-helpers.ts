import { fileURLToPath } from "node:url";
import { openDb, type Db } from "./index";

// Tests run from the repo root, so openDb's cwd-based migrations default
// doesn't apply; this is the one place that knows where the migrations
// live relative to the source tree.
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export function memoryDb(): Db {
  return openDb(":memory:", MIGRATIONS_DIR);
}

export function fileDb(file: string): Db {
  return openDb(file, MIGRATIONS_DIR);
}
