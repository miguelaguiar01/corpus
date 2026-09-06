import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CORPUS_DIR, prepare } from "./workbench";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repo(withPackage = true): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-workbench-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "package.json"), '{ "name": "client" }\n');
  if (withPackage) {
    const pkg = path.join(dir, "node_modules/@corpus-tool/workbench");
    mkdirSync(path.join(pkg, "bin"), { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "@corpus-tool/workbench",
        version: "9.9.9",
        bin: { "corpus-workbench": "bin/corpus-workbench.cjs" },
      }),
    );
    writeFileSync(path.join(pkg, "bin/corpus-workbench.cjs"), "");
  }
  return dir;
}

test("without the package installed, the message says the install line", () => {
  expect(() => prepare(repo(false))).toThrow(
    /@corpus-tool\/workbench is not installed in this repository; add it with: npm install --save-dev @corpus-tool\/workbench/,
  );
});

test("the bin, the database and a generated secret, kept out of git", () => {
  const dir = repo();
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  const first = prepare(dir);
  expect(first.bin).toBe(
    path.join(
      dir,
      "node_modules/@corpus-tool/workbench/bin/corpus-workbench.cjs",
    ),
  );
  expect(first.version).toBe("9.9.9");
  expect(first.dbPath).toBe(path.join(dir, CORPUS_DIR, "corpus.db"));
  expect(first.secret).toMatch(/^[0-9a-f]{48}$/);
  expect(statSync(path.join(dir, CORPUS_DIR, "secret")).mode & 0o777).toBe(
    0o600,
  );
  expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(
    "node_modules\n.corpus/\n",
  );
  expect(first.notes).toEqual([
    "wrote a new instance secret to .corpus/secret",
    "added .corpus/ to .gitignore",
  ]);
  // The second start reuses the secret and says nothing.
  const second = prepare(dir);
  expect(second.secret).toBe(first.secret);
  expect(second.notes).toEqual([]);
});

test("--db picks the database path; no .gitignore is a reminder", () => {
  const dir = repo();
  const prepared = prepare(dir, { db: "data/local.db" });
  expect(prepared.dbPath).toBe(path.join(dir, "data/local.db"));
  expect(prepared.notes).toContain(
    "keep .corpus/ out of version control (no .gitignore found)",
  );
});
