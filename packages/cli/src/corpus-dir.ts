import path from "node:path";

// The repository's gitignored Corpus directory (§2, §10): the local
// instance's database and secret, and the project token push and pull
// read after CORPUS_TOKEN.
export const CORPUS_DIR = ".corpus";
export const SECRET_FILE = "secret";
export const DB_FILE = "corpus.db";
export const TOKEN_FILE = "token";

export function secretPath(cwd: string): string {
  return path.join(cwd, CORPUS_DIR, SECRET_FILE);
}

export function tokenPath(cwd: string): string {
  return path.join(cwd, CORPUS_DIR, TOKEN_FILE);
}
