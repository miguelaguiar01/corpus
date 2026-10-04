import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
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
    "Not in the source": "",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain(
    "keyed/pt.json:Sign in: unexpected {x}",
  );
  expect(c.stderr.join("\n")).not.toContain("{amount} off");
  // A target's empty value stays an untranslated row, not an orphan.
  expect(c.stderr.join("\n")).not.toContain("Not in the source");
  expect(c.stderr.join("\n")).toMatch(/corpus: 1 invalid translation\(s\)$/);
});

test("a string type read as HTML validates without comparing tags, in a file or an exporter (#622)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  const withHtml = (config: string) =>
    config.replace(
      "sources: [",
      'richText: { chrome: "html", computed: "html" },\n  sources: [',
    );
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [{ id: "exec.bye", type: "computed", source: "Bye {who}" }],
      translations: { pt: { "exec.bye": "<i>Adeus</i> {who}<br/>" } },
    }))`,
  );
  write("i18n/pt.json", { greeting: "<b>Olá</b> {name}" });
  const plain = ctx();
  expect(await run(["validate"], plain)).toBe(1);
  expect(plain.stderr.join("\n")).toContain(
    "i18n/pt.json:greeting: unexpected <b> tag",
  );
  expect(plain.stderr.join("\n")).toContain(
    "[exec.bye] pt: unexpected <i> tag",
  );
  const original = readFileSync(path.join(repo, configFile), "utf8");
  writeFileSync(path.join(repo, configFile), withHtml(original));
  const html = ctx();
  expect(await run(["validate"], html)).toBe(0);
  // A tag that never closes is text in HTML (#755); a dropped
  // placeholder is still a finding.
  write("i18n/pt.json", { greeting: "<b>Olá {name}" });
  expect(await run(["validate"], ctx())).toBe(0);
  write("i18n/pt.json", { greeting: "<b>Olá" });
  const dropped = ctx();
  expect(await run(["validate"], dropped)).toBe(1);
  expect(dropped.stderr.join("\n")).toContain("i18n/pt.json:greeting:");
});

test("a clean repository is valid, an exec source whose translations are elsewhere is named as not checked, missing keys are not findings", async () => {
  write("i18n/pt.json", { greeting: "Olá {name}" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stdout.join("\n")).toBe(
    'validate: every translation checked is valid; not checked: what exec "node scripts/export.mjs" does not hand over (`corpus validate --server` checks it)',
  );
  expect(c.stderr.join("\n")).toContain(
    'corpus: exec "node scripts/export.mjs" hands over no translations; any others, such as drafts on the instance, are not checked here: `corpus validate --server` checks them',
  );
});

test("an exporter that hands over some of its translations is named with the count (#1074)", async () => {
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [
        { id: "exec.bye", type: "computed", source: "Bye {who}" },
        { id: "exec.hi", type: "computed", source: "Hi {who}" },
        { id: "exec.broken", type: "computed", source: "Hi {who" },
      ],
      translations: { pt: { "exec.bye": "Adeus {who}" } },
    }))`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toContain(
    'corpus: exec "node scripts/export.mjs" hands over 1 of the 2 translations its strings can have; any others, such as drafts on the instance, are not checked here: `corpus validate --server` checks them',
  );
  expect(c.stdout.join("\n")).toMatch(
    /^validate: every translation checked is valid; not checked: what exec/,
  );
  // Every translation handed over: nothing left unchecked.
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [{ id: "exec.bye", type: "computed", source: "Bye {who}" }],
      translations: { pt: { "exec.bye": "Adeus {who}" } },
    }))`,
  );
  const full = ctx();
  expect(await run(["validate"], full)).toBe(0);
  expect(full.stdout.join("\n")).toBe("validate: every translation is valid");
  expect(full.stderr.join("\n")).not.toMatch(/hands over/);
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
        pt: { "exec.bye": "Adeus", "exec.marks": "{n, plural, other {# marcas}}", "exec.gone": "x" },
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
    "exec:node scripts/export.mjs [exec.marks] pt: plural on {n} lacks the one branch the runtime picks in its language",
  );
  expect(err).not.toContain("[exec.bye] fr");
  expect(err).not.toMatch(/is not validated/);
  expect(err).toContain(
    "exec:node scripts/export.mjs [exec.gone] pt: the exporter's strings no longer have this id",
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
      code: "moved-placeholder",
      name: "path",
      written: "%{path}",
      tag: 'a href="%{path}"',
    }),
  ).toBe(
    '%{path} is in the text where the source writes it inside <a href="%{path}">; is the tag written wrong?',
  );
  expect(
    describe({
      code: "changed-verb",
      name: "n",
      expected: "%(n)d",
      actual: "%(n)s",
      indexed: "%n$s",
      moved: false,
    }),
  ).toBe("%(n)s where the source has %(n)d");
  expect(
    describe({
      code: "invalid-icu",
      where: "target",
      message: "unclosed brace",
      position: 4,
    }),
  ).toBe("invalid ICU in the target at 4: unclosed brace");
  // Named after the library the text was read under (#644).
  expect(
    describe(
      { code: "invalid-icu", where: "target", message: "x", position: 0 },
      "vue",
    ),
  ).toBe("invalid vue-i18n message in the target at 0: x");
  expect(
    describe(
      { code: "invalid-icu", where: "source", message: "x", position: 0 },
      "i18next",
    ),
  ).toBe("invalid i18next message in the source at 0: x");
  expect(
    describe({
      code: "changed-verb",
      name: "1",
      expected: "%lld",
      actual: "%d",
      indexed: "%n$d or %[n]d",
      moved: false,
    }),
  ).toBe("%d at position 1 where the source has %lld");
  expect(
    describe({
      code: "changed-verb",
      name: "2",
      expected: "%d",
      actual: "%s",
      indexed: "%n$s or %[n]s",
      moved: true,
    }),
  ).toBe(
    "%s at position 2 is %d in the source; a verb that moved needs its index, %n$s or %[n]s",
  );
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
  expect(
    describe({ code: "missing-placeholder", name: "1", written: "%s" }),
  ).toBe("missing %s");
  expect(
    describe({
      code: "changed-verb",
      name: "2",
      expected: "%d",
      actual: "%s",
      indexed: "%[n]s",
      moved: true,
    }),
  ).toBe(
    "%s at position 2 is %d in the source; a verb that moved needs its index, %[n]s",
  );
  expect(
    describe({ code: "missing-placeholder", name: "quantity" }, "android"),
  ).toBe("a <string> where the source is a <plurals> on quantity");
  expect(
    describe({ code: "missing-placeholder", name: "count" }, "printf"),
  ).toBe("the source is a plural on count: write the translation as one");
  expect(
    describe({ code: "missing-placeholder", name: "count" }, "counterpart"),
  ).toBe("the source is a plural on count: write the translation as one");
  expect(
    describe(
      { code: "missing-placeholder", name: "2", written: "%2$s" },
      "android",
    ),
  ).toBe("missing %2$s");
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
    "i18n/pt.json:gone: the source no longer has this key (i18n/en.json)",
  );
  // Two translations, one of them with two problems (#1013).
  expect(err).toMatch(
    /2 invalid translation\(s\) \(3 problem\(s\)\), 1 orphan key\(s\) in 1 file\(s\)/,
  );
});

test("an id two files of one source share is one translation, as the server holds it (#1013)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "ui", path: ["a/{lang}.json", "b/{lang}.json"] }],',
    ),
  );
  for (const dir of ["a", "b"]) {
    mkdirSync(path.join(repo, dir), { recursive: true });
    write(`${dir}/en.json`, { hello: "Hello {name}" });
    write(`${dir}/pt.json`, { hello: "Olá {nome}" });
  }
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.at(-1)).toBe(
    "corpus: 1 invalid translation(s) (4 problem(s))",
  );
});

test("the summary counts translations, a source that does not parse apart, and --json files an orphan as orphan (#1013)", async () => {
  write("i18n/en.json", {
    greeting: "Hello {name}",
    broken: "Hi {who",
    plain: "Plain",
  });
  write("i18n/pt.json", {
    greeting: "Olá {nome}",
    broken: "Olá",
    plain: "Simples",
    gone: "Adeus",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.at(-1)).toBe(
    "corpus: 1 invalid translation(s) (2 problem(s)), 1 source string(s) that do not parse, which build refuses, 1 orphan key(s) in 1 file(s)",
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(1);
  const findings = JSON.parse(j.stdout.join("\n")) as {
    key: string;
    severity: string;
  }[];
  expect(findings.map((f) => [f.key, f.severity]).sort()).toEqual([
    ["broken", "invalid"],
    ["gone", "orphan"],
    ["greeting", "invalid"],
    ["greeting", "invalid"],
  ]);
  // A source that does not parse is still a failure on its own.
  write("i18n/pt.json", {
    greeting: "Olá {name}",
    broken: "Olá",
    plain: "Simples",
  });
  const s = ctx();
  expect(await run(["validate"], s)).toBe(1);
  expect(s.stderr.at(-1)).toBe(
    "corpus: 1 source string(s) that do not parse, which build refuses",
  );
});

test("a plural missing a category its language uses is incomplete: printed apart, exit 0 on its own, 1 beside an invalid one (#556)", async () => {
  write("i18n/en.json", {
    marks: "{n, plural, one {# mark} other {# marks}}",
    greeting: "Hello {name}",
  });
  // Portuguese picks `one` for 1. Its `many`, since CLDR 42, is for
  // exact millions, which a count never reaches, so it is not asked for
  // (#997), unless the source declares it in pluralRules.
  write("i18n/pt.json", {
    marks: "{n, plural, other {# marcas}}",
    greeting: "Olá {name}",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    "i18n/pt.json:marks: plural on {n} lacks the one branch the runtime picks in its language",
  );
  expect(err).toMatch(
    /corpus: 1 incomplete plural\(s\), a category the runtime picks/,
  );
  expect(err).not.toMatch(/invalid translation/);
  expect(c.stdout.join("\n")).toBe(
    'validate: no invalid translation checked; 1 incomplete plural(s) listed above; not checked: what exec "node scripts/export.mjs" does not hand over (`corpus validate --server` checks it)',
  );

  write("i18n/pt.json", {
    marks: "{n, plural, other {# marcas}}",
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

test("an orphan key is summarised once across the target files, listed but no failure (#1023); --json keeps one finding per file", async () => {
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
  // The runtime never reads a key the source no longer has (#1023).
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stdout.join("\n")).toContain(
    "validate: every translation checked is valid; 2 orphan key(s) listed above, which the runtime never reads",
  );
  const lines = c.stderr.filter((l) => l.includes("no longer has"));
  expect(lines).toEqual([
    "i18n/pt.json:gone: the source no longer has this key (i18n/en.json); 1 more target file(s) carry it",
    "i18n/pt.json:old: the source no longer has this key (i18n/en.json); 1 more target file(s) carry it",
  ]);
  expect(c.stderr.join("\n")).toMatch(
    /corpus: 2 orphan key\(s\) in 3 file\(s\)$/m,
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(0);
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
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.filter((l) => l.includes("no longer has"))).toEqual([
    "i18n/pt.json:gone: the source no longer has this key (i18n/en.json)",
    "extra/pt.json:gone: the source no longer has this key (extra/en.json)",
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

test("a catalogue no adapter reads is named by its format, not passed as valid (#647)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  const original = readFileSync(path.join(repo, configFile), "utf8");
  const using = (source: string) =>
    writeFileSync(
      path.join(repo, configFile),
      original.replace(/sources: \[[\s\S]*?\n {2}\],/, `sources: [${source}],`),
    );
  mkdirSync(path.join(repo, "po"), { recursive: true });
  writeFileSync(path.join(repo, "po", "en.po"), 'msgid "a"\nmsgstr "A"\n');
  writeFileSync(
    path.join(repo, "po", "app_en.ts"),
    '<!DOCTYPE TS>\n<TS version="2.1"></TS>\n',
  );
  using('{ adapter: "messages", type: "ui", path: "po/{lang}.po" }');
  let c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain(
    'po/en.po: a gettext catalogue: declare it { adapter: "gettext"',
  );
  using('{ adapter: "messages", type: "ui", path: "po/app_{lang}.ts" }');
  c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain(
    "po/app_en.ts: a Qt Linguist catalogue",
  );
});

test("a key with a newline prints escaped on one line; --json keeps it raw (#648)", async () => {
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
  write("keyed/en.json", { "Could not remove\n{name}": "" });
  write("keyed/pt.json", {
    "Could not remove\n{name}": "Não removido",
    "Gone\nnow": "Foi",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr).toContain(
    "keyed/pt.json:Could not remove\\n{name}: missing {name}",
  );
  expect(c.stderr.join("\n")).toContain(
    "keyed/pt.json:Gone\\nnow: the source no longer has this key (keyed/en.json)",
  );
  const j = ctx();
  await run(["validate", "--json"], j);
  expect(JSON.parse(j.stdout.join("\n"))[0].key).toBe(
    "Could not remove\n{name}",
  );
});

test("validate refuses an xliff target whose START_LINK and CLOSE_LINK are reversed (#710)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "xliff", type: "ui", path: "locale/messages.{lang}.xlf", sourcePath: "locale/messages.xlf" }],',
    ),
  );
  mkdirSync(path.join(repo, "locale"), { recursive: true });
  const file = (target: string) =>
    `<xliff version="1.2"><file source-language="en"><body><trans-unit id="signIn"><source>Sign in with <x id="START_LINK"/>Google<x id="CLOSE_LINK"/></source>${target}</trans-unit></body></file></xliff>\n`;
  writeFileSync(path.join(repo, "locale", "messages.xlf"), file(""));
  writeFileSync(
    path.join(repo, "locale", "messages.pt.xlf"),
    file(
      '<target state="translated">Entrar com <x id="CLOSE_LINK"/>Google<x id="START_LINK"/></target>',
    ),
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(
    /locale\/messages\.pt\.xlf:signIn: invalid ICU in the target/,
  );
});

test("validate reads a gettext target: a dropped %s is a finding, a fuzzy row is not read (#718)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "gettext", type: "ui", path: "po/{lang}.po", sourcePath: "po/app.pot" }],',
    ),
  );
  mkdirSync(path.join(repo, "po"), { recursive: true });
  writeFileSync(
    path.join(repo, "po", "app.pot"),
    `msgid "Delete %s?"\nmsgstr ""\n\nmsgid "Keep %s"\nmsgstr ""\n`,
  );
  writeFileSync(
    path.join(repo, "po", "pt.po"),
    `msgid "Delete %s?"\nmsgstr "Apagar?"\n\n#, fuzzy\nmsgid "Keep %s"\nmsgstr "Manter"\n`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  expect(err).toMatch(/po\/pt\.po:Delete %s\?: missing %s/);
  expect(err).not.toMatch(/Keep %s/);
});

test("validate reads a String Catalog, naming the language after the key; pull says it does not write one yet (#727)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "xcstrings", type: "ui", path: "Localizable.xcstrings" }],',
    ),
  );
  const unit = (value: string) => ({
    stringUnit: { state: "translated", value },
  });
  writeFileSync(
    path.join(repo, "Localizable.xcstrings"),
    JSON.stringify({
      sourceLanguage: "en",
      strings: {
        "%@ posts": {
          localizations: { en: unit("%@ posts"), pt: unit("publicações") },
        },
        Done: { localizations: { pt: unit("Feito") } },
      },
    }),
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  expect(err).toContain("Localizable.xcstrings [%@ posts] pt: missing %@");
  expect(err).not.toMatch(/Done/);
});

test("a source with # in a select within a plural is warned by validate and build, and neither fails (#767)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "ui", path: "nested/{lang}.json" }],',
    ),
  );
  mkdirSync(path.join(repo, "nested"), { recursive: true });
  write("nested/en.json", {
    files:
      "{n, plural, one {{g, select, f {# file of hers} other {# file}}} other {{n} files}}",
    plain: "{n, plural, one {# file} other {# files}}",
  });
  write("nested/pt.json", {
    files:
      "{n, plural, one {{g, select, f {{n} ficheiro dela} other {{n} ficheiro}}} other {{n} ficheiros}}",
  });
  const warning =
    "nested/en.json:files: # in a select within the plural on {n} is text to some runtimes; write {n}";
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.filter((line) => line === warning)).toHaveLength(1);
  expect(c.stderr.join("\n")).toContain("1 warning(s)");
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr).toContain(`corpus: ${warning}`);
  expect(b.stderr.join("\n")).not.toContain("plain");
});

test("an exporter's source with # in a select within a plural is warned by validate and build too (#767)", async () => {
  writeFileSync(
    path.join(repo, "scripts", "export.mjs"),
    `console.log(JSON.stringify({
      strings: [{ id: "exec.n", type: "computed", source: "{n, plural, one {{g, select, f {# x} other {y}}} other {z}}" }],
      translations: { pt: { "exec.n": "{n, plural, one {{g, select, f {{n} x} other {y}}} many {z} other {z}}" } },
    }))`,
  );
  const message =
    "# in a select within the plural on {n} is text to some runtimes; write {n}";
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr).toContain(
    `exec:node scripts/export.mjs [exec.n] en: ${message}`,
  );
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr).toContain(
    `corpus: exec "node scripts/export.mjs" [exec.n]: ${message}`,
  );
});

test("a Qt numerus translation no plural holds is a warning in validate and a note in build, once each (#751)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "qt-ts", type: "ui", path: "lang/app_{lang}.ts" }],',
    ),
  );
  const ts = (language: string, forms: string[], state = "") =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language ? ` language="${language}"` : ""}>\n<context>\n    <name>Main</name>\n    <message numerus="yes">\n        <source>%n file(s)</source>\n        <translation${state}>\n${forms.map((f) => `            <numerusform>${f}</numerusform>`).join("\n")}\n        </translation>\n    </message>\n</context>\n</TS>\n`;
  mkdirSync(path.join(repo, "lang"), { recursive: true });
  writeFileSync(
    path.join(repo, "lang", "app_en.ts"),
    ts("", ["", ""], ' type="unfinished"'),
  );
  writeFileSync(
    path.join(repo, "lang", "app_pt.ts"),
    ts("pt", ["%n ficheiro", "%n {x"]),
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(
    c.stderr.filter((line) =>
      line.startsWith("lang/app_pt.ts:Main | %n file(s): a numerus form"),
    ),
  ).toHaveLength(1);
  expect(c.stderr.join("\n")).toContain("1 warning(s)");
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr.join("\n")).toContain(
    "lang/app_pt.ts: 1 translation(s) not seeded: a numerus form Corpus cannot read as one plural",
  );
});

test("an i18next plural family is one string: a target's _few and _many are its forms, never orphans, and build says the families (#985)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8")
      .replace(
        /sources: \[[\s\S]*?\n {2}\],/,
        'sources: [{ adapter: "messages", type: "ui", library: "i18next", path: "loc/{lang}.json" }],',
      )
      .replace(/languages: \[[^\]]*\]/, 'languages: ["en", "pl", "ja"]'),
  );
  mkdirSync(path.join(repo, "loc"), { recursive: true });
  writeFileSync(
    path.join(repo, "loc", "en.json"),
    JSON.stringify({ n_one: "{{count}} file", n_other: "{{count}} files" }),
  );
  writeFileSync(
    path.join(repo, "loc", "pl.json"),
    JSON.stringify({
      n_one: "{{count}} plik",
      n_few: "{{count}} pliki",
      n_many: "{{count}} plików",
      n_other: "{{count}} pliku",
    }),
  );
  writeFileSync(
    path.join(repo, "loc", "ja.json"),
    JSON.stringify({ n_other: "{{count}} 件" }),
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).not.toMatch(/orphan|no longer has/);
  expect(c.stderr.join("\n")).not.toMatch(/incomplete/);
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr.join("\n")).toContain(
    "loc/en.json: 1 i18next plural family read as one string each (n_<category> → n)",
  );
  const snapshot = JSON.parse(
    readFileSync(path.join(repo, "snapshot.json"), "utf8"),
  ) as {
    strings: { id: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => s.id)).toEqual(["n"]);
  expect(snapshot.seedTranslations.ja).toEqual({
    n: "{count, plural, other {{{count}} 件}}",
  });
});

test("under i18next a source's prose tags build, and a stray </br> is named without stopping it (#986)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8")
      .replace(
        /sources: \[[\s\S]*?\n {2}\],/,
        'sources: [{ adapter: "messages", type: "ui", library: "i18next", path: "loc/{lang}.json" }],',
      )
      .replace(/languages: \[[^\]]*\]/, 'languages: ["en", "fr"]'),
  );
  mkdirSync(path.join(repo, "loc"), { recursive: true });
  const en = {
    a: "<no title>",
    b: "@username <message>",
    c: "<Redacted>",
    d: "Restart. </br> Then enable it.",
    e: "<unknown matchers>",
    f: "See <0>the docs</0>",
  };
  writeFileSync(path.join(repo, "loc", "en.json"), JSON.stringify(en));
  writeFileSync(
    path.join(repo, "loc", "fr.json"),
    JSON.stringify({ a: "<sans titre>", f: "Voir la documentation" }),
  );
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr.join("\n")).toContain(
    "loc/en.json: 1 string(s) write a </br> no <br> opens, which renders as nothing or as its letters; write <br/> (d)",
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  expect(c.stderr.join("\n")).toContain("loc/fr.json:f: missing the <0> tag");
  expect(c.stderr.join("\n")).not.toContain("loc/fr.json:a:");
});

test("a Rails _html key's translation writes its own tags, closed; a plain key's tags are compared (#988)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8")
      .replace(
        /sources: \[[\s\S]*?\n {2}\],/,
        'sources: [{ adapter: "yaml", type: "server", path: "config/locales/{lang}.yml" }],',
      )
      .replace(/languages: \[[^\]]*\]/, 'languages: ["en", "ja"]'),
  );
  mkdirSync(path.join(repo, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(repo, "config", "locales", "en.yml"),
    'en:\n  hint_html: "Read <strong>this</strong>"\n  link_html: \'Go <a href="%{path}">here</a>\'\n  plain: "Read <em>this</em>"\n',
  );
  writeFileSync(
    path.join(repo, "config", "locales", "ja.yml"),
    'ja:\n  hint_html: "<em>これ</em>を読む"\n  link_html: \'<a href="%{path}">ここ< /a>へ\'\n  plain: "これを読む"\n',
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const said = c.stderr.join("\n");
  expect(said).not.toContain("ja.yml:hint_html");
  expect(said).toContain("config/locales/ja.yml:link_html:");
  expect(said).toContain("unclosed <a>");
  expect(said).toContain("config/locales/ja.yml:plain: missing the <em> tag");
});

// The instance's translations (#1074): what an exec source drafted there
// never reaches the repository, so only the server can check it.
async function instance(
  translations: Record<string, Record<string, string>>,
  status = 200,
) {
  const calls: { url: string; auth?: string }[] = [];
  const server: Server = createServer((req, res) => {
    calls.push({ url: req.url ?? "", auth: req.headers.authorization });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        status === 200
          ? {
              contract: "corpus/1",
              project: "pull-fixture",
              sourceLanguage: "en",
              minState: "translated",
              types: {},
              translations,
            }
          : { error: "unauthorized", message: "no" },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.env.CORPUS_SERVER = `http://127.0.0.1:${port}`;
  return { calls, close: () => server.close() };
}

test("--server checks the instance's translations against the repository's sources, an exec source's included (#1074)", async () => {
  const server = await instance({
    en: { greeting: "Hello {name}", "exec.bye": "Bye {who}" },
    pt: {
      greeting: "Olá",
      "exec.bye": "Adeus",
      "gone.key": "Desaparecido",
    },
  });
  try {
    const c = { ...ctx(), env: { CORPUS_TOKEN: "good" } };
    expect(await run(["validate", "--server"], c)).toBe(1);
    expect(server.calls[0]).toEqual({
      url: "/api/pull?minState=translated",
      auth: "Bearer good",
    });
    const err = c.stderr.join("\n");
    expect(err).toContain("i18n/pt.json:greeting: missing {name}");
    expect(err).toContain(
      "exec:node scripts/export.mjs [exec.bye] pt: missing {who}",
    );
    // An id the sources dropped is one warning; the next push archives it.
    expect(err).toMatch(
      /\[gone\.key\] pt: the instance holds a translation of this id, which the sources no longer have; the next push archives it/,
    );
    expect(err).toMatch(/corpus: 2 invalid translation\(s\), 1 warning\(s\)$/);
    // The repository has no pt file: plain validate finds nothing.
    expect(await run(["validate"], ctx())).toBe(0);

    const j = { ...ctx(), env: { CORPUS_TOKEN: "good" } };
    expect(await run(["validate", "--server", "--json"], j)).toBe(1);
    expect(JSON.parse(j.stdout.join("\n"))).toContainEqual({
      file: "exec:node scripts/export.mjs",
      sourceFile: "exec:node scripts/export.mjs",
      key: "exec.bye",
      language: "pt",
      code: "missing-placeholder",
      severity: "invalid",
      message: "missing {who}",
      where: "server",
    });
  } finally {
    server.close();
    delete process.env.CORPUS_SERVER;
  }
});

test("--server on a valid instance says how many it checked, and a refused token is said (#1074)", async () => {
  const server = await instance({
    pt: { greeting: "Olá {name}", "exec.bye": "Adeus {who}" },
  });
  try {
    const c = { ...ctx(), env: { CORPUS_TOKEN: "good" } };
    expect(await run(["validate", "--server"], c)).toBe(0);
    expect(c.stdout.join("\n")).toBe(
      "validate --server: every translation on the instance is valid (2 checked)",
    );
    expect(c.stderr.join("\n")).not.toMatch(/hands over/);
  } finally {
    server.close();
  }
  const refused = await instance({}, 401);
  try {
    const c = { ...ctx(), env: { CORPUS_TOKEN: "bad" } };
    expect(await run(["validate", "--server"], c)).toBe(1);
    expect(c.stderr.join("\n")).toMatch(/^corpus: /);
  } finally {
    refused.close();
    delete process.env.CORPUS_SERVER;
  }
});

test("--server takes no value, and names a shared string at the copy the build keeps (#1074)", async () => {
  const c = { ...ctx(), env: { CORPUS_TOKEN: "good" } };
  await expect(
    run(["validate", "--server", "http://elsewhere:3000"], c),
  ).resolves.toBe(1);
  expect(c.stderr.join("\n")).toContain(
    "validate: --server takes no value; it checks the instance the config names (http://elsewhere:3000 given)",
  );

  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "ui", path: ["a/{lang}.json", "b/{lang}.json"] }],',
    ),
  );
  mkdirSync(path.join(repo, "a"));
  mkdirSync(path.join(repo, "b"));
  write("a/en.json", { shared: "Hi {name}", own: "Bye {name}" });
  write("b/en.json", { shared: "Hi {name}" });
  const server = await instance({ pt: { shared: "Olá", own: "Adeus" } });
  try {
    const s = { ...ctx(), env: { CORPUS_TOKEN: "good" } };
    expect(await run(["validate", "--server"], s)).toBe(1);
    const err = s.stderr.join("\n");
    expect(err).toContain("a/pt.json:shared: missing {name}");
    expect(err).toContain("a/pt.json:own: missing {name}");
    expect(err).not.toContain("b/pt.json");
  } finally {
    server.close();
    delete process.env.CORPUS_SERVER;
  }
});

test("a Fluent translation's own select is valid; one on a variable never passed is a warning, a term's never (#1032)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "fluent", type: "ui", path: "l10n/{lang}.ftl" }],',
    ),
  );
  mkdirSync(path.join(repo, "l10n"));
  writeFileSync(
    path.join(repo, "l10n", "en.ftl"),
    `-brand = Firefox
shared = { $user } shared a file with { -brand }
account = { $capitalization ->
    [lowercase] account
   *[uppercase] Account
  }
`,
  );
  writeFileSync(
    path.join(repo, "l10n", "pt.ftl"),
    `-brand = { $case ->
    [gen] do Firefox
   *[other] Firefox
  }
shared = { $user_gender ->
    [female] { $user } partilhou um ficheiro com o { -brand(case: "gen") } (ela)
   *[other] { $user } partilhou um ficheiro com o { -brand(case: "gen") }
  }
account = { $capitalization ->
   *[other] Conta
  }
`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    "l10n/pt.ftl:shared: selects on {user_gender}, which the source never passes: Fluent renders the default",
  );
  expect(err).not.toContain("-brand");
  expect(err).not.toContain("account");
  expect(err).toMatch(/corpus: 1 warning\(s\)$/);
});

test("a plural written as one text where the source never prints its count is incomplete, in --json too (#992)", async () => {
  write("i18n/en.json", {
    greeting:
      "{count, plural, one {card from the deck} other {cards from the deck}}",
  });
  write("i18n/pt.json", { greeting: "cartas do baralho" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toContain(
    "i18n/pt.json:greeting: the plural on {count} is written as one text",
  );
  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(0);
  expect(JSON.parse(j.stdout.join("\n"))).toContainEqual(
    expect.objectContaining({
      key: "greeting",
      code: "flattened-plural",
      severity: "incomplete",
    }),
  );
});

test("under vue a source's bare @ is a warning and builds, a translation's is invalid (#1017)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json", library: "vue" }],',
    ),
  );
  write("i18n/en.json", { mail: "Write to a@b.c", hi: "Hi {'@'}all" });
  write("i18n/pt.json", { mail: "Write to a@b.c", hi: "Olá @all" });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(1);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    "i18n/pt.json:hi: an @ that opens no link does not compile in vue-i18n, which then shows the message raw; write {'@'}",
  );
  expect(err).toContain(
    "i18n/en.json:mail: an @ that opens no link does not compile in vue-i18n",
  );
  expect(c.stderr.at(-1)).toBe(
    "corpus: 1 invalid translation(s), 1 warning(s)",
  );
  const b = ctx();
  expect(await run(["build", "--out", path.join(repo, "s.json")], b)).toBe(0);
  expect(b.stderr.join("\n")).toContain(
    "i18n/en.json:mail: an @ that opens no link does not compile in vue-i18n",
  );
});

test("a source's pluralRules asks for the categories its runtime picks, beyond the tolerant default (#997)", async () => {
  write("i18n/en.json", { marks: "{n, plural, one {# mark} other {# marks}}" });
  write("i18n/pt.json", {
    marks: "{n, plural, one {# marca} other {# marcas}}",
  });
  // Without it, Portuguese `many` is not asked for: the #556 test above.
  const config = path.join(repo, "corpus.config.ts");
  const { readFileSync } = await import("node:fs");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }',
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json", pluralRules: { pt: ["one", "many", "other"] } }',
    ),
  );
  const declared = ctx();
  expect(await run(["validate"], declared)).toBe(0);
  expect(declared.stderr.join("\n")).toContain(
    "i18n/pt.json:marks: plural on {n} lacks the many branch the runtime picks in its language",
  );
});

test('under pluralRules: "default" a vue translation whose forms number other than the source\'s is incomplete, each index named (#1018)', async () => {
  const config = path.join(repo, "corpus.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }',
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json", library: "vue", pluralRules: "default" }',
    ),
  );
  write("i18n/en.json", { minutes: "{n} minute | {n} minutes" });
  write("i18n/pt.json", {
    minutes: "{n} minuto | {n} minutos | {n} de minutos",
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toContain(
    "i18n/pt.json:minutes: 3 form(s) read as =0 | =1 | other under vue-i18n's default rule, where the source's 2 are =1 | other",
  );
});

test('under easy_localization with pluralRules: "cldr" a translation needs CLDR\'s categories, as ignorePluralRules: false picks (#961)', async () => {
  const config = path.join(repo, "corpus.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8")
      .replace('languages: ["en", "pt"]', 'languages: ["en", "pt", "pl"]')
      .replace(
        '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }',
        '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json", library: "easy_localization", pluralRules: "cldr" }',
      ),
  );
  write("i18n/en.json", { files: { one: "{} file", other: "{} files" } });
  write("i18n/pl.json", { files: { one: "{} plik", other: "{} pliku" } });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toContain(
    "i18n/pl.json:files: plural on {count} lacks the few branch the runtime picks in its language",
  );
});

test("under chrome a source's lone $ or $40 is a warning, and a translation's lone $ too, exit 0 (#631)", async () => {
  const config = path.join(repo, "corpus.config.ts");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }',
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json", library: "chrome" }',
    ),
  );
  write("i18n/en.json", {
    sign: { message: "$$ character" },
    price: { message: "Pay $40" },
  });
  write("i18n/pt.json", {
    sign: { message: "$ caractere" },
    price: { message: "Pague $$40" },
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    'i18n/en.json:price: Chrome reads $40 at 4 as substitution 4 then "0": write $$40 for a price',
  );
  expect(err).toContain(
    'i18n/pt.json:sign: Chrome drops the lone $ at 0 with the character after it ("$ "): write $$ for the sign',
  );
});

test("under a namespace, a Qt numerus translation short of its forms is still a warning in validate and a note in build (#1004, #998)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8")
      .replace(
        /sources: \[[\s\S]*?\n {2}\],/,
        'sources: [{ adapter: "qt-ts", type: "ui", path: "lang/app_{lang}.ts", namespace: "qt" }],',
      )
      .replace(/languages: \[[^\]]*\]/, 'languages: ["en", "km"]'),
  );
  const ts = (language: string, forms: string[], state = "") =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language ? ` language="${language}"` : ""}>\n<context>\n    <name>Main</name>\n    <message numerus="yes">\n        <source>%n file(s)</source>\n        <translation${state}>\n${forms.map((f) => `            <numerusform>${f}</numerusform>`).join("\n")}\n        </translation>\n    </message>\n</context>\n</TS>\n`;
  mkdirSync(path.join(repo, "lang"), { recursive: true });
  writeFileSync(
    path.join(repo, "lang", "app_en.ts"),
    ts("", ["", ""], ' type="unfinished"'),
  );
  writeFileSync(path.join(repo, "lang", "app_km.ts"), ts("km", ["%n ឯកសារ"]));
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).toContain(
    "lang/app_km.ts:qt:Main | %n file(s): Qt's rule for km has 2 forms; the file has 1",
  );
  const b = ctx();
  expect(await run(["build", "--out", "snapshot.json"], b)).toBe(0);
  expect(b.stderr.join("\n")).toContain(
    "lang/app_km.ts: 1 numerus translation(s) hold fewer than the 2 forms Qt's rule for km has, so a count past them shows the source text (qt:Main | %n file(s))",
  );
});

test("a category the source plural lacks under its own language's rule is one finding on the source, naming the translations that lack it too; --json keeps theirs, marked (#1029)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr", "ja", "pl"],
  sources: [{ adapter: "messages", type: "ui", library: "counterpart", path: "i18n/{lang}.json" }],
});
`,
  );
  // Element's truncated_list_n_more: English writes other alone, and
  // counterpart picks one at 1.
  write("i18n/en.json", {
    truncated: { other: "and %(count)s others" },
    rooms: { one: "%(count)s room", other: "%(count)s rooms" },
  });
  write("i18n/de.json", { truncated: { other: "und %(count)s weitere" } });
  write("i18n/fr.json", { truncated: { other: "et %(count)s autres" } });
  write("i18n/ja.json", { truncated: { other: "他 %(count)s 件" } });
  // A category the source has is the translation's own finding.
  write("i18n/pl.json", {
    // counterpart picks one and other in every language.
    truncated: { one: "i %(count)s inny", other: "i %(count)s innych" },
    rooms: { other: "%(count)s pokoi" },
  });
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const err = c.stderr.join("\n");
  expect(err).toContain(
    "i18n/en.json:truncated: plural on {count} lacks the one branch the runtime picks in en; 3 translation(s) lack it too (de, fr, ja)",
  );
  expect(err).not.toMatch(/i18n\/(de|fr|ja)\.json:truncated: plural/);
  expect(err).toContain(
    "i18n/pl.json:rooms: plural on {count} lacks the one branch the runtime picks in its language",
  );
  expect(err).toMatch(/corpus: 2 incomplete plural\(s\)/);

  const j = ctx();
  expect(await run(["validate", "--json"], j)).toBe(0);
  const findings = JSON.parse(j.stdout.join("\n")) as {
    file: string;
    key: string;
    language: string;
    severity: string;
    sourceLacks?: boolean;
  }[];
  const truncated = findings.filter((f) => f.key === "truncated");
  expect(
    truncated.map((f) => [f.file, f.language, f.sourceLacks ?? false]),
  ).toEqual([
    ["i18n/en.json", "en", false],
    ["i18n/de.json", "de", true],
    ["i18n/fr.json", "fr", true],
    ["i18n/ja.json", "ja", true],
  ]);
  expect(truncated.every((f) => f.severity === "incomplete")).toBe(true);
  expect(findings.find((f) => f.key === "rooms")?.sourceLacks).toBeUndefined();
});

test("a gettext msgid and msgid_plural are two forms whatever the source's language, so a Polish source pair lacks no category; an exporter that hands over nothing still has its source checked (#1029)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "pl",
  languages: ["pl", "de"],
  sources: [{ adapter: "gettext", type: "ui", path: "po/{lang}.po", sourcePath: "po/messages.pot" }],
});
`,
  );
  mkdirSync(path.join(repo, "po"), { recursive: true });
  writeFileSync(
    path.join(repo, "po", "messages.pot"),
    `msgid ""\nmsgstr ""\n\nmsgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] ""\nmsgstr[1] ""\n\n# A brace a msgid holds alone is text to gettext.\nmsgid "%d brace {"\nmsgid_plural "%d braces {"\nmsgstr[0] ""\nmsgstr[1] ""\n`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  expect(c.stderr.join("\n")).not.toMatch(/lacks the/);
  // Under a namespace too, whose prefix the ids carry.
  const config = readFileSync(path.join(repo, "corpus.config.ts"), "utf8");
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    config.replace(
      'sourcePath: "po/messages.pot" }',
      'sourcePath: "po/messages.pot", namespace: "app" }',
    ),
  );
  const named = ctx();
  expect(await run(["validate"], named)).toBe(0);
  expect(named.stderr.join("\n")).not.toMatch(/lacks the/);
  writeFileSync(path.join(repo, "corpus.config.ts"), config);

  // An ICU plural a msgid writes itself is Polish's, by CLDR, whatever
  // its shape: trailing text, a few branch, an =0 one.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    readFileSync(path.join(repo, "corpus.config.ts"), "utf8").replace(
      'sourcePath: "po/messages.pot" }',
      'sourcePath: "po/messages.pot", library: "icu" }',
    ),
  );
  writeFileSync(
    path.join(repo, "po", "messages.pot"),
    `msgid ""\nmsgstr ""\n\nmsgid "{count, plural, one {# plik} other {# pliki}} w folderze"\nmsgstr ""\n\nmsgid "{count, plural, one {# plik} few {# pliki} other {# plików}}"\nmsgstr ""\n\nmsgid "{count, plural, one {# plik} =0 {brak} other {# pliki}}"\nmsgstr ""\n`,
  );
  const icu = ctx();
  expect(await run(["validate"], icu)).toBe(0);
  const lines = icu.stderr.join("\n");
  expect(lines).toMatch(/w folderze: plural on \{count\} lacks the few branch/);
  expect(lines).toMatch(
    /plików\}\}: plural on \{count\} lacks the many branch/,
  );
  expect(lines).toMatch(
    /=0 \{brak\}.*: plural on \{count\} lacks the few branch/,
  );

  // An exporter that hands over no translations: its source is checked.
  writeFileSync(
    path.join(repo, "scripts", "gaps.mjs"),
    `console.log(JSON.stringify({ strings: [{ id: "n", type: "ui", source: "{count, plural, other {# items}}" }] }));\n`,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [{ adapter: "exec", command: "node scripts/gaps.mjs", importCommand: "node scripts/import.mjs" }],
});
`,
  );
  const e = ctx();
  expect(await run(["validate"], e)).toBe(0);
  expect(e.stderr.join("\n")).toContain(
    "exec:node scripts/gaps.mjs [n] en: plural on {count} lacks the one branch the runtime picks in en",
  );
});

test("a Fluent term argument the locale's term never reads, and a term attribute it never defines, are warnings, read across the source's files (#1033)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "id", "cs"],
  sources: [{ adapter: "fluent", type: "ui", path: ["l10n/{lang}/brands.ftl", "l10n/{lang}/app.ftl"] }],
});
`,
  );
  const ftl = (lang: string, brands: string, app: string) => {
    mkdirSync(path.join(repo, "l10n", lang), { recursive: true });
    writeFileSync(path.join(repo, "l10n", lang, "brands.ftl"), brands);
    writeFileSync(path.join(repo, "l10n", lang, "app.ftl"), app);
  };
  // Relay: the terms live in brands.ftl, the messages that use them in
  // another file of the same bundle.
  ftl(
    "en",
    `-brand = { $capitalization ->\n   *[lower] account\n    [upper] Account\n  }\n-relay = Relay\n    .gender = feminine\n`,
    `a = Your { -brand(capitalization: "upper") }\nb = { -relay.gender ->\n    [feminine] She\n   *[other] It\n  }\n`,
  );
  ftl(
    "id",
    `-brand = { $capitalization ->\n   *[lower] akun\n    [upper] Akun\n  }\n-relay = Relay\n    .gender = feminine\n`,
    `a = { -brand(kapitalisasi: "upper") } Anda\nb = { -relay.gender ->\n    [feminine] Dia\n   *[other] Itu\n  }\n`,
  );
  ftl(
    "cs",
    `-brand = { $capitalization ->\n   *[lower] účet\n    [upper] Účet\n  }\n-relay = Relay\n`,
    `a = Váš { -brand(capitalization: "upper") }\nb = { -relay.gender ->\n    [feminine] Ona\n   *[other] To\n  }\n`,
  );
  const c = ctx();
  expect(await run(["validate"], c)).toBe(0);
  const lines = c.stderr.filter((l) => /reads no argument|has no \./.test(l));
  expect(lines).toEqual([
    "l10n/id/app.ftl:a: -brand reads no argument kapitalisasi in this language, so Fluent renders it as if none were passed",
    "l10n/cs/app.ftl:b: -relay has no .gender in this language, so Fluent renders the default variant",
  ]);
  expect(c.stderr.join("\n")).toMatch(/2 warning\(s\)/);
  // Its own definition with the attribute is no finding.
  ftl(
    "cs",
    `-brand = { $capitalization ->\n   *[lower] účet\n    [upper] Účet\n  }\n-relay = Relay\n    .gender = feminine\n`,
    `a = Váš { -brand(capitalization: "upper") }\nb = { -relay.gender ->\n    [feminine] Ona\n   *[other] To\n  }\n`,
  );
  const d = ctx();
  expect(await run(["validate"], d)).toBe(0);
  expect(d.stderr.filter((l) => /\.gender/.test(l))).toEqual([]);
});
