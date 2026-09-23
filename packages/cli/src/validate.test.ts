import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

test("a sentence key with an empty value validates its translations against the key (#589)", async () => {
  const { mkdirSync } = await import("node:fs");
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "ui", path: "keyed/{lang}.json" }],',
    ),
  );
  mkdirSync(path.join(repo, "keyed"), { recursive: true });
  write("keyed/en.json", { "{amount} off": "", "Sign in": "" });
  write("keyed/pt.json", {
    "{amount} off": "{amount} de desconto",
    "Sign in": "Entrar {x}",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain(
    "keyed/pt.json:Sign in: unexpected {x}",
  );
  expect(c.stderr.join("\n")).not.toContain("{amount} off");
});

test("a clean repository is valid, exec sources are named as not validated, missing keys are not findings", async () => {
  write("i18n/pt.json", { greeting: "Olá {name}" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stdout.join("\n")).toMatch(/every translation is valid/);
  expect(c.stderr.join("\n")).toMatch(
    /exec "node scripts\/export.mjs" is not validated: its exporter emits no translations/,
  );
});

test("an exec source's translations are validated from its exporter, the command standing for the file (#560)", async () => {
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [
        { id: "exec.bye", type: "computed", source: "Bye {who}" },
        { id: "exec.marks", type: "computed", source: "{n, plural, one {# mark} other {# marks}}" },
      ],
      translations: {
        pt: { "exec.bye": "Adeus", "exec.marks": "{n, plural, one {# marca} other {# marcas}}", "exec.gone": "x" },
        fr: { "exec.bye": "Au revoir" },
      },
    }))`,
  );
  write("i18n/pt.json", { greeting: "Olá {name}" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  // An exec line names the language after the key: the command stands
  // for every language where a file's path names one (#592).
  expect(err).toContain(
    "exec:node scripts/export.mjs [exec.bye] pt: missing {who}",
  );
  expect(err).toContain(
    "exec:node scripts/export.mjs [exec.marks] pt: plural on {n} lacks the many branch its language uses",
  );
  expect(err).not.toContain("[exec.bye] fr");
  expect(err).not.toMatch(/is not validated/);
  expect(err).toContain(
    "exec:node scripts/export.mjs:exec.gone: the exporter's strings no longer have this id; 1 target file(s) carry it",
  );
  expect(err).toMatch(
    /1 invalid translation\(s\), 1 orphan key\(s\) in 1 file\(s\), 1 incomplete plural\(s\)/,
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(1);
  expect(JSON.parse(j.stdout.join("\n"))).toContainEqual({
    file: "exec:node scripts/export.mjs",
    key: "exec.bye",
    language: "pt",
    code: "missing-placeholder",
    severity: "invalid",
    message: "missing {who}",
  });
});

test("an exporter's source string that does not parse is one finding, not one per language", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      'languages: ["en", "pt"]',
      'languages: ["en", "pt", "fr"]',
    ),
  );
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [{ id: "exec.broken", type: "computed", source: "Hi {who" }],
      translations: { pt: { "exec.broken": "Olá" }, fr: { "exec.broken": "Salut" } },
    }))`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const broken = c.stderr
    .join("\n")
    .split("\n")
    .filter((l) => l.includes("exec.broken"));
  expect(broken).toHaveLength(1);
  // The source's own finding carries the source language.
  expect(broken[0]).toMatch(
    /^exec:node scripts\/export\.mjs \[exec\.broken\] en: /,
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(1);
  const findings = JSON.parse(j.stdout.join("\n")) as { language: string }[];
  expect(findings.map((f) => f.language)).toEqual(["en"]);
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
  expect(
    describe({
      code: "unexpected-format",
      name: "n",
      expected: "number",
      actual: null,
    }),
  ).toBe("{n} is a number in the source; write it {n, number}");
  expect(
    describe({
      code: "unexpected-format",
      name: "d",
      expected: "date",
      actual: "time",
    }),
  ).toBe("{d} is a date in the source, not a time");
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

test("a plural missing a category its language uses is incomplete: printed apart, exit 0 on its own, 1 beside an invalid one (#556)", async () => {
  write("i18n/en.json", {
    marks: "{n, plural, one {# mark} other {# marks}}",
    greeting: "Hello {name}",
  });
  // Portuguese has `many` since CLDR 42, for large round numbers; every
  // catalogue written before it lacks the branch.
  write("i18n/pt.json", {
    marks: "{n, plural, one {# marca} other {# marcas}}",
    greeting: "Olá {name}",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    "i18n/pt.json:marks: plural on {n} lacks the many branch its language uses",
  );
  expect(err).toMatch(
    /corpus: 1 incomplete plural\(s\), a category the language uses/,
  );
  expect(err).not.toMatch(/invalid translation/);
  expect(c.stdout.join("\n")).toBe(
    "validate: no invalid translation; 1 incomplete plural(s) listed above",
  );

  write("i18n/pt.json", {
    marks: "{n, plural, one {# marca} other {# marcas}}",
    greeting: "Olá",
  });
  const d = ctx();
  expect(await run(["validate"], d)).toBe(1);
  expect(d.stderr.join("\n")).toMatch(
    /corpus: 1 invalid translation\(s\), 1 incomplete plural\(s\)/,
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(1);
  const findings = JSON.parse(j.stdout.join("\n")) as { severity: string }[];
  expect(findings.map((f) => f.severity).sort()).toEqual([
    "incomplete",
    "invalid",
  ]);
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
    sourceFile: string;
  }[];
  expect(findings).toHaveLength(4);
  expect(findings.every((f) => f.sourceFile === "i18n/en.json")).toBe(true);
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

test("the same orphan key under two sources is two lines, one per source", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    readFileSync(path.join(repo, "corpus.config.ts"), "utf8").replace(
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },',
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }, { adapter: "messages", type: "extra", path: "extra/{lang}.json" },',
    ),
  );
  mkdirSync(path.join(repo, "extra"));
  write("i18n/en.json", { greeting: "Hello {name}" });
  write("i18n/pt.json", { greeting: "Olá {name}", gone: "Adeus" });
  write("extra/en.json", { more: "More" });
  write("extra/pt.json", { more: "Mais", gone: "Adeus" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.filter((l) => l.includes("no longer has"))).toEqual([
    "i18n/en.json:gone: the source no longer has this key; 1 target file(s) carry it",
    "extra/en.json:gone: the source no longer has this key; 1 target file(s) carry it",
  ]);
  expect(c.stderr.join("\n")).toMatch(
    /corpus: 2 orphan key\(s\) in 2 file\(s\)$/m,
  );
});

test("an i18next source is validated as i18next under either name", async () => {
  const config = (field: string) =>
    writeFileSync(
      path.join(repo, "corpus.config.mjs"),
      `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en", "pt"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json"${field} }] };\n`,
    );
  rmSync(path.join(repo, "corpus.config.ts"), { force: true });
  write("i18n/en.json", { greet: "Hello {{ name }}" });
  write("i18n/pt.json", { greet: "Olá {{ name }}" });

  config(`, library: "i18next"`);
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).not.toMatch(/invalid/);
  expect(c.stderr.join("\n")).not.toMatch(/syntax is the old name/);
});

test("the old name validates the same way, and says it is the old name", async () => {
  rmSync(path.join(repo, "corpus.config.ts"), { force: true });
  writeFileSync(
    path.join(repo, "corpus.config.mjs"),
    `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en", "pt"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json", syntax: "i18next" }] };\n`,
  );
  write("i18n/en.json", { greet: "Hello {{ name }}" });
  write("i18n/pt.json", { greet: "Olá {{ name }}" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toMatch(/syntax is the old name for library/);
});
