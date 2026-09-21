import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";
import { describe } from "./validate";

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/pull-repo", import.meta.url),
);
const TMP = fileURLToPath(new URL("../test/.tmp", import.meta.url));

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

test("a source that does not parse is the source file's finding, once, not one per target", async () => {
  write("i18n/en.json", { greeting: "Hello {name" });
  write("i18n/pt.json", { greeting: "Olá {name" });
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    readFileSync(path.join(repo, "corpus.config.ts"), "utf8").replace(
      '["en", "pt"]',
      '["en", "pt", "fr"]',
    ),
  );
  write("i18n/fr.json", { greeting: "Salut {name" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const lines = c.stderr.filter((l) => l.startsWith("i18n/"));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(
    /^i18n\/en\.json:greeting: invalid ICU in the source/,
  );
});

test("a missing source file is an error naming it", async () => {
  rmSync(path.join(repo, "i18n/en.json"));
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(
    /source file i18n\/en\.json does not exist/,
  );
});

test("a table source with {lang} reads its targets by the id field", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [
    { adapter: "table", type: "step", path: "steps/{lang}.json", map: { id: "id", text: "text" } },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "steps"));
  write("steps/en.json", [{ id: "s1", text: "Open the {door}" }]);
  write("steps/pt.json", [{ id: "s1", text: "Abre a porta" }]);
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain("steps/pt.json:s1: missing {door}");
});

test("describe words every error code", () => {
  expect(
    describe({
      code: "invalid-icu",
      where: "target",
      message: "unclosed brace",
      position: 4,
    }),
  ).toBe("invalid ICU in the target at 4: unclosed brace");
  expect(describe({ code: "missing-placeholder", name: "n" })).toBe(
    "missing {n}",
  );
  expect(describe({ code: "unexpected-placeholder", name: "n" })).toBe(
    "unexpected {n}",
  );
  expect(describe({ code: "unknown-select", arg: "g" })).toBe(
    "select on {g}, which the source does not select on",
  );
  expect(describe({ code: "missing-branch", arg: "g", key: "other" })).toBe(
    "select on {g} lacks the branch other",
  );
  expect(describe({ code: "unexpected-branch", arg: "g", key: "x" })).toBe(
    "select on {g} has the branch x, which the source does not",
  );
  expect(describe({ code: "missing-tag", name: "link" })).toBe(
    "missing the <link> tag",
  );
  expect(describe({ code: "unexpected-tag", name: "b" })).toBe(
    "unexpected <b> tag, which the source does not have",
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
  expect(err).toContain(
    "i18n/en.json:gone: the source no longer has this key; 1 target file(s) carry it",
  );
  expect(err).toMatch(
    /3 invalid translation\(s\), 1 orphan key\(s\) in 1 file\(s\)/,
  );
});

test("an orphan key is summarised once across the target files; --json keeps one finding per file", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    readFileSync(path.join(repo, "corpus.config.ts"), "utf8").replace(
      '["en", "pt"]',
      '["en", "pt", "de", "fr"]',
    ),
  );
  write("i18n/en.json", { greeting: "Hello {name}" });
  write("i18n/pt.json", {
    greeting: "Olá {name}",
    gone: "Adeus",
    old: "Velho",
  });
  write("i18n/de.json", { greeting: "Hallo {name}", gone: "Tschüss" });
  write("i18n/fr.json", { greeting: "Bonjour {name}", old: "Vieux" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const lines = c.stderr.filter((l) => l.includes("no longer has"));
  expect(lines).toEqual([
    "i18n/en.json:gone: the source no longer has this key; 2 target file(s) carry it",
    "i18n/en.json:old: the source no longer has this key; 2 target file(s) carry it",
  ]);
  expect(c.stderr.join("\n")).toMatch(
    /corpus: 2 orphan key\(s\) in 3 file\(s\)$/m,
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(1);
  const findings = JSON.parse(j.stdout.join("\n")) as {
    file: string;
    key: string;
  }[];
  expect(findings).toHaveLength(4);
  expect(findings.map((f) => f.file).sort()).toEqual([
    "i18n/de.json",
    "i18n/fr.json",
    "i18n/pt.json",
    "i18n/pt.json",
  ]);
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

test("an empty or blank target value is a key the target lacks, not a dropped placeholder", async () => {
  write("i18n/en.json", {
    "app.title": "Corpus",
    greeting: "Hello {name}",
    farewell: "Bye {name}",
  });
  write("i18n/pt.json", {
    "app.title": "Corpus",
    greeting: "",
    farewell: "Adeus",
    gone: "  ",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  expect(err).not.toContain("greeting");
  expect(err).not.toContain("gone");
  expect(err).toContain("i18n/pt.json:farewell: missing {name}");
  expect(err).toMatch(/1 invalid translation\(s\)/);
});
