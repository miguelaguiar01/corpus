// Where the app's files are, independent of the working directory (§2:
// the app runs the same as a local process and in the container). The
// app root is the directory holding the drizzle migrations journal,
// found from cwd first (the common case) and otherwise by walking up
// from the running module — which lands on apps/web both from the
// source tree and from the standalone server's bundled chunks.
import { existsSync } from "node:fs";
import path from "node:path";

const MARKER = path.join("drizzle", "meta", "_journal.json");

export function locateAppRoot({
  moduleDir,
  cwd,
}: {
  moduleDir: string;
  cwd: string;
}): string {
  if (existsSync(path.join(cwd, MARKER))) return cwd;
  let dir = moduleDir;
  for (;;) {
    if (existsSync(path.join(dir, MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return cwd;
    dir = parent;
  }
}

// Env overrides are resolved against cwd, as a shell user expects;
// defaults live under the app root.
export function resolvePaths({
  moduleDir,
  cwd,
  env,
}: {
  moduleDir: string;
  cwd: string;
  env: Record<string, string | undefined>;
}): { migrationsDir: string; dbPath: string } {
  const root = locateAppRoot({ moduleDir, cwd });
  return {
    migrationsDir: env.CORPUS_MIGRATIONS_DIR
      ? path.resolve(cwd, env.CORPUS_MIGRATIONS_DIR)
      : path.join(root, "drizzle"),
    dbPath: env.CORPUS_DB_PATH
      ? path.resolve(cwd, env.CORPUS_DB_PATH)
      : path.join(root, "data", "corpus.db"),
  };
}
