import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ignoreCorpusDir } from "./corpus-dir";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-ignore-"));
  dirs.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("git already ignoring .corpus/ leaves .gitignore untouched (#649)", () => {
  const excluded = repo();
  writeFileSync(path.join(excluded, ".git", "info", "exclude"), ".corpus/\n");
  expect(ignoreCorpusDir(excluded)).toBeUndefined();
  expect(existsSync(path.join(excluded, ".gitignore"))).toBe(false);

  const parent = repo();
  writeFileSync(path.join(parent, ".gitignore"), "node_modules/\n.corpus\n");
  const app = path.join(parent, "apps", "web");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, ".gitignore"), "dist/\n");
  expect(ignoreCorpusDir(app)).toBeUndefined();
  expect(readFileSync(path.join(app, ".gitignore"), "utf8")).toBe("dist/\n");
});

test("a repository that does not ignore it gets the line, as outside git", () => {
  const plain = repo();
  writeFileSync(path.join(plain, ".gitignore"), "dist/\n");
  expect(ignoreCorpusDir(plain)).toBe("added .corpus/ to .gitignore");
  expect(readFileSync(path.join(plain, ".gitignore"), "utf8")).toBe(
    "dist/\n.corpus/\n",
  );

  const outside = mkdtempSync(path.join(os.tmpdir(), "corpus-nogit-"));
  dirs.push(outside);
  expect(ignoreCorpusDir(outside)).toBe("created .gitignore with .corpus/");
});
