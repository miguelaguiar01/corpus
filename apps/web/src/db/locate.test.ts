import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { locateAppRoot, resolvePaths } from "./locate";

let tmp: string;
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function appRoot(): string {
  tmp = mkdtempSync(path.join(os.tmpdir(), "corpus-locate-"));
  const root = path.join(tmp, "apps", "web");
  mkdirSync(path.join(root, "drizzle", "meta"), { recursive: true });
  writeFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "{}");
  mkdirSync(path.join(root, ".next", "server", "chunks"), { recursive: true });
  return root;
}

test("the app root is found by walking up from the running module, not from cwd", () => {
  const root = appRoot();
  const moduleDir = path.join(root, ".next", "server", "chunks");
  expect(locateAppRoot({ moduleDir, cwd: os.tmpdir() })).toBe(root);
});

test("cwd is preferred when it is itself the app root", () => {
  const root = appRoot();
  expect(locateAppRoot({ moduleDir: os.tmpdir(), cwd: root })).toBe(root);
});

test("defaults resolve against the app root; env overrides win", () => {
  const root = appRoot();
  const paths = resolvePaths({ moduleDir: root, cwd: os.tmpdir(), env: {} });
  expect(paths.migrationsDir).toBe(path.join(root, "drizzle"));
  expect(paths.dbPath).toBe(path.join(root, "data", "corpus.db"));
  const custom = resolvePaths({
    moduleDir: root,
    cwd: os.tmpdir(),
    env: { CORPUS_DB_PATH: "/data/corpus.db", CORPUS_MIGRATIONS_DIR: "/opt/m" },
  });
  expect(custom).toEqual({
    migrationsDir: "/opt/m",
    dbPath: "/data/corpus.db",
  });
});

test("a relative CORPUS_DB_PATH is resolved against cwd, as a shell user expects", () => {
  const root = appRoot();
  const paths = resolvePaths({
    moduleDir: root,
    cwd: "/srv",
    env: { CORPUS_DB_PATH: "x/corpus.db" },
  });
  expect(paths.dbPath).toBe(path.join("/srv", "x", "corpus.db"));
});

test("with no app root anywhere, it falls back to cwd", () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "corpus-locate-"));
  expect(locateAppRoot({ moduleDir: tmp, cwd: tmp })).toBe(tmp);
});
