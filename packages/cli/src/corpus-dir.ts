import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

// .gitignore told about .corpus/ (§10), by `init` and `workbench` alike:
// a team on a shared instance writes the token by hand after `project
// create` and never starts the workbench, and a repository with no
// .gitignore is one `git add .` from committing it, so the file is created
// rather than the note left to chance. Returns what was done, or nothing
// when the line was already there.
export function ignoreCorpusDir(cwd: string): string | undefined {
  const gitignore = path.join(cwd, ".gitignore");
  const line = `${CORPUS_DIR}/`;
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, `${line}\n`);
    return `created .gitignore with ${line}`;
  }
  const text = readFileSync(gitignore, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.trim() === line || l.trim() === CORPUS_DIR)) return;
  appendFileSync(
    gitignore,
    `${text.endsWith("\n") || text === "" ? "" : "\n"}${line}\n`,
  );
  return `added ${line} to .gitignore`;
}
