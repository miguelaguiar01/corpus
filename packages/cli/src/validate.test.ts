import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/pull-repo", import.meta.url),
);
const TMP = fileURLToPath(new URL("../test/fixtures/.tmp", import.meta.url));

let repo: string;
beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  repo = mkdtempSync(path.join(TMP, "validate-"));
  cpSync(FIXTURE, repo, { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function ctx() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const c: RunContext & { stdout: string[]; stderr: string[] } = {
    cwd: repo,
    env: {},
    out: (s) => stdout.push(s),
    err: (s) => stderr.push(s),
    stdout,
    stderr,
  };
  return c;
}

const write = (rel: string, data: unknown) =>
  writeFileSync(path.join(repo, rel), `${JSON.stringify(data, null, 2)}\n`);

test("a clean repository is valid, exec sources are named as not validated, missing keys are not findings", async () => {
  write("i18n/pt.json", { greeting: "Olá {name}" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stdout.join("\n")).toMatch(/every translation is valid/);
  expect(c.stderr.join("\n")).toMatch(
    /exec "node scripts\/export.mjs" is not validated/,
  );
});

test("a dropped placeholder, a malformed select and an orphan key are findings, one line each", async () => {
  write("i18n/en.json", {
    "app.title": "Corpus",
    greeting: "Hello {name}",
    seen: "{who, select, cat {a cat} other {someone}} was seen",
  });
  write("i18n/pt.json", {
    greeting: "Olá",
    seen: "{who, select, cat {um gato} dog {um cão}} foi visto",
    gone: "Adeus",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  expect(err).toContain("i18n/pt.json:greeting: missing {name}");
  expect(err).toContain(
    "i18n/pt.json:seen: select on {who} lacks the branch other",
  );
  expect(err).toContain(
    "i18n/pt.json:seen: select on {who} has the branch dog, which the source does not",
  );
  expect(err).toContain("i18n/pt.json:gone: the source no longer has this key");
  expect(err).toMatch(/4 invalid translation\(s\)/);
});

test("--json prints the findings as data", async () => {
  write("i18n/pt.json", { greeting: "Olá {nome}" });
  const c = ctx();
  expect(await run(["validate", "--json"], c)).toBe(1);
  const findings = JSON.parse(c.stdout.join("\n")) as {
    file: string;
    key: string;
    code: string;
  }[];
  expect(findings.map((f) => f.code).sort()).toEqual([
    "missing-placeholder",
    "unexpected-placeholder",
  ]);
  expect(findings[0]).toMatchObject({ file: "i18n/pt.json", key: "greeting" });
});

test("a target file that is not JSON is an error naming it", async () => {
  writeFileSync(path.join(repo, "i18n/pt.json"), "{ nope");
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(/i18n\/pt\.json/);
});
