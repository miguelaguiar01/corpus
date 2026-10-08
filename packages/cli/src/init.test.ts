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
import { buildSnapshotReport } from "./build";
import { run, type RunContext } from "./cli";
import { loadConfig } from "./config";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function project(): {
  dir: string;
  ctx: RunContext;
  out: string[];
  err: string[];
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-init-"));
  dirs.push(dir);
  const out: string[] = [];
  const err: string[] = [];
  return {
    dir,
    out,
    err,
    ctx: {
      cwd: dir,
      env: {},
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    },
  };
}

// The written config imports the CLI package; a stub in the project's own
// node_modules lets it load here.
function stubCli(dir: string) {
  const pkg = path.join(dir, "node_modules", "@corpus-tool", "cli");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@corpus-tool/cli",
      type: "module",
      exports: "./index.js",
    }),
  );
  writeFileSync(
    path.join(pkg, "index.js"),
    "export const defineCorpus = (c) => c;\n",
  );
}

const FLAGS = [
  "init",
  "--project",
  "moonlight-manor",
  "--source",
  "pt-PT",
  "--languages",
  "pt-PT, en",
  "--messages",
  "src/i18n/{lang}.json",
];

test("writes a config that the loader accepts, and says what to do next", async () => {
  const p = project();
  stubCli(p.dir);
  const code = await run(FLAGS, p.ctx);
  expect(code).toBe(0);
  const file = path.join(p.dir, "corpus.config.ts");
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, "utf8");
  expect(text).toContain('from "@corpus-tool/cli"');
  expect(text).not.toContain("process.env");
  const config = await loadConfig(p.dir);
  expect(config.project).toBe("moonlight-manor");
  expect(config.languages).toEqual(["pt-PT", "en"]);
  expect(config.sources[0]).toMatchObject({
    adapter: "messages",
    type: "ui",
    path: "src/i18n/{lang}.json",
  });
  expect(p.out.join("\n")).toMatch(/wrote corpus\.config\.ts/);
  expect(p.out.join("\n")).toMatch(/corpus workbench.*\.corpus\/token/);
  // Without --server the default is named, since a workbench on another
  // port would otherwise leave push aiming at it (#559).
  expect(p.out.join("\n")).toMatch(
    /The config's server is http:\/\/localhost:3000: corpus workbench listens there by default/,
  );
  const given = project();
  stubCli(given.dir);
  expect(
    await run([...FLAGS, "--server", "http://localhost:4100"], given.ctx),
  ).toBe(0);
  expect(given.out.join("\n")).not.toMatch(/The config's server is/);
  expect(p.out.join("\n")).toMatch(/corpus push/);
});

test("without @corpus-tool/cli in the repository, init writes a plain corpus.config.mjs the loader accepts, and says so (#598)", async () => {
  const p = project();
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
  const text = readFileSync(path.join(p.dir, "corpus.config.mjs"), "utf8");
  expect(text).toMatch(/^export default \{\n {2}project: "moonlight-manor",/);
  expect(text).not.toContain("defineCorpus");
  expect(text).toMatch(/\n\};\n$/);
  const config = await loadConfig(p.dir);
  expect(config.project).toBe("moonlight-manor");
  expect(config.sources[0]).toMatchObject({ path: "src/i18n/{lang}.json" });
  expect(p.out.join("\n")).toMatch(
    /wrote corpus\.config\.mjs \(a plain object: @corpus-tool\/cli is not installed in this repository\)/,
  );
});

test("refuses to overwrite an existing config, of any filename", async () => {
  const p = project();
  writeFileSync(path.join(p.dir, "corpus.config.mjs"), "export default {};\n");
  const code = await run(FLAGS, p.ctx);
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/corpus\.config\.mjs already exists/);
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
  // A refusal writes nothing, .gitignore included.
  expect(existsSync(path.join(p.dir, ".gitignore"))).toBe(false);
});

test("a missing flag names the flag and shows the usage", async () => {
  const p = project();
  const code = await run(["init", "--project", "x"], p.ctx);
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/--source is required/);
  expect(p.err.join("\n")).toMatch(/usage: corpus init/);
});

test("languages that leave out the source language are refused before anything is written", async () => {
  const p = project();
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--languages",
      "pt-PT",
      "--messages",
      "i18n/{lang}.json",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(
    /sourceLanguage: languages must include sourceLanguage/,
  );
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
});

test("the messages path must carry the language placeholder", async () => {
  const p = project();
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--languages",
      "en",
      "--messages",
      "i18n/en.json",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/--messages must contain \{lang\}/);
});

test(".gitignore ignores .corpus/ after init: created, extended, or left as it is", async () => {
  const none = project();
  stubCli(none.dir);
  expect(await run(FLAGS, none.ctx)).toBe(0);
  expect(readFileSync(path.join(none.dir, ".gitignore"), "utf8")).toBe(
    ".corpus/\n",
  );
  expect(none.out).toContain("created .gitignore with .corpus/");

  const lacking = project();
  stubCli(lacking.dir);
  writeFileSync(path.join(lacking.dir, ".gitignore"), "node_modules");
  expect(await run(FLAGS, lacking.ctx)).toBe(0);
  expect(readFileSync(path.join(lacking.dir, ".gitignore"), "utf8")).toBe(
    "node_modules\n.corpus/\n",
  );
  expect(lacking.out).toContain("added .corpus/ to .gitignore");

  const has = project();
  stubCli(has.dir);
  writeFileSync(path.join(has.dir, ".gitignore"), "node_modules\n.corpus\n");
  expect(await run(FLAGS, has.ctx)).toBe(0);
  expect(readFileSync(path.join(has.dir, ".gitignore"), "utf8")).toBe(
    "node_modules\n.corpus\n",
  );
  expect(has.out.join("\n")).not.toMatch(/gitignore/);
});

test("with no --languages, the codes come from the files that fill {lang}, the source first; a code the runtime does not know is warned about", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  for (const code of ["pt-PT", "en", "de", "cr"]) {
    writeFileSync(path.join(p.dir, "src", "i18n", `${code}.json`), "{}\n");
  }
  writeFileSync(path.join(p.dir, "src", "i18n", "glossary.en.json"), "[]\n");
  const flags = FLAGS.filter(
    (f, i) => f !== "--languages" && FLAGS[i - 1] !== "--languages",
  );
  expect(await run(flags, p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["pt-PT", "cr", "de", "en"]);
  expect(p.err.join("\n")).toMatch(
    /cr is not a language tag the runtime knows/,
  );
  expect(p.err.join("\n")).not.toMatch(/de is not/);
});

test("with no --languages and no files, init says what to pass", async () => {
  const p = project();
  stubCli(p.dir);
  const flags = FLAGS.filter(
    (f, i) => f !== "--languages" && FLAGS[i - 1] !== "--languages",
  );
  expect(await run(flags, p.ctx)).toBe(1);
  expect(p.err.join("\n")).toMatch(
    /no src\/i18n\/\{lang\}\.json file to take the languages from; pass --languages/,
  );
});

test("a {lang} directory segment is read too", async () => {
  const p = project();
  stubCli(p.dir);
  for (const code of ["en", "fr"]) {
    mkdirSync(path.join(p.dir, "locales", code), { recursive: true });
    writeFileSync(path.join(p.dir, "locales", code, "common.json"), "{}\n");
  }
  mkdirSync(path.join(p.dir, "locales", "stale"), { recursive: true });
  const flags = [
    "init",
    "--project",
    "shop",
    "--source",
    "en",
    "--messages",
    "locales/{lang}/common.json",
  ];
  expect(await run(flags, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en", "fr"]);
});

test("--languages without a value is refused, as before; a given code is checked too", async () => {
  const bare = project();
  stubCli(bare.dir);
  const flags = FLAGS.filter(
    (f, i) => f !== "--languages" && FLAGS[i - 1] !== "--languages",
  );
  expect(await run([...flags, "--languages"], bare.ctx)).toBe(1);
  expect(bare.err.join("\n")).toMatch(/--languages needs a value/);
  const comma = project();
  stubCli(comma.dir);
  expect(await run([...flags, "--languages", ","], comma.ctx)).toBe(1);
  expect(comma.err.join("\n")).toMatch(/--languages needs a value/);
  const given = project();
  stubCli(given.dir);
  expect(await run([...flags, "--languages", "pt-PT,cr"], given.ctx)).toBe(0);
  expect(given.err.join("\n")).toMatch(
    /cr is not a language tag the runtime knows/,
  );
});

test("underscore language directories are read and known to the runtime", async () => {
  const p = project();
  stubCli(p.dir);
  for (const code of ["en_US", "pt_PT"]) {
    mkdirSync(path.join(p.dir, "locales", code), { recursive: true });
    writeFileSync(
      path.join(p.dir, "locales", code, "translation.json"),
      "{}\n",
    );
  }
  const flags = [
    "init",
    "--project",
    "kb",
    "--source",
    "en_US",
    "--messages",
    "locales/{lang}/translation.json",
  ];
  expect(await run(flags, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en_US", "pt_PT"]);
  expect(p.err.join("\n")).not.toMatch(/not a language tag/);
});

test("--library i18next is written on the source; icu writes nothing extra; another value is refused", async () => {
  const p = project();
  stubCli(p.dir);
  expect(await run([...FLAGS, "--library", "i18next"], p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({ library: "i18next" });
  expect(p.out.join("\n")).toMatch(/library: i18next/);

  const q = project();
  stubCli(q.dir);
  expect(await run([...FLAGS, "--library", "icu"], q.ctx)).toBe(0);
  const text = readFileSync(path.join(q.dir, "corpus.config.ts"), "utf8");
  expect(text).not.toContain("library");

  const r = project();
  stubCli(r.dir);
  expect(await run([...FLAGS, "--library", "gettext"], r.ctx)).toBe(1);
  expect(r.err.join("\n")).toMatch(/--library.*icu.*i18next/);
  expect(existsSync(path.join(r.dir, "corpus.config.ts"))).toBe(false);
});

test("without --library, a source file with {{ }} and no ICU argument is read as i18next, and said", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    // A list the source refuses leaves the rest to count (#1026).
    JSON.stringify({ a: "Olá {{ name }}", b: { c: "Sem nada" }, l: ["x"] }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({ library: "i18next" });
  expect(p.out.join("\n")).toMatch(
    /library: i18next, from \{\{ \}\} in src\/i18n\/pt-PT\.json/,
  );

  for (const values of [
    { a: "Olá {name}" },
    { a: "{n, plural, one {x} other {y}} {{z}}" },
    {},
  ]) {
    const q = project();
    stubCli(q.dir);
    mkdirSync(path.join(q.dir, "src", "i18n"), { recursive: true });
    writeFileSync(
      path.join(q.dir, "src", "i18n", "pt-PT.json"),
      JSON.stringify(values),
    );
    expect(await run(FLAGS, q.ctx)).toBe(0);
    const config = await loadConfig(q.dir);
    expect(config.sources[0]).not.toHaveProperty("library");
    expect(q.out.join("\n")).not.toMatch(/library/);
  }

  // A source file that does not parse, or none, leaves the syntax unset.
  const r = project();
  stubCli(r.dir);
  mkdirSync(path.join(r.dir, "src", "i18n"), { recursive: true });
  writeFileSync(path.join(r.dir, "src", "i18n", "pt-PT.json"), "{ not json");
  expect(await run(FLAGS, r.ctx)).toBe(0);
  expect((await loadConfig(r.dir)).sources[0]).not.toHaveProperty("library");
  const none = project();
  stubCli(none.dir);
  expect(await run(FLAGS, none.ctx)).toBe(0);
  expect((await loadConfig(none.dir)).sources[0]).not.toHaveProperty("library");
});

test("init names the chrome library for a Chrome i18n catalogue (#595)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    "\uFEFF" +
      JSON.stringify({
        appName: { message: "Bitwarden" },
        copied: {
          message: "$ITEM$ copied",
          placeholders: { item: { content: "$1" } },
        },
      }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "chrome",
  });
  expect(p.out.join("\n")).toMatch(
    /library: chrome, from the Chrome i18n shape in src\/i18n\/pt-PT\.json/,
  );
});

test("init counts the placeholder shapes: one {{ }} among printf verbs is not i18next, and the verbs name printf (#591, #594)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  const values: Record<string, string> = {
    "dropzone.file_too_big": "File is {{filesize}} MB, over {{maxFilesize}} MB",
    "install.sqlite_helper": "File path for the SQLite3 database.",
  };
  for (let i = 0; i < 40; i++) values[`repo.n${i}`] = `Pushed %d commits to %s`;
  values["install.err"] = "Invalid data: %v";
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify(values),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect(await loadConfig(p.dir)).toMatchObject({
    sources: [{ adapter: "messages" }],
  });
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "printf",
  });
  expect(p.out.join("\n")).toMatch(
    /library: printf, from printf verbs in src\/i18n\/pt-PT\.json/,
  );

  // An iOS catalogue's %ld and %@ are printf verbs too (#614).
  const ios = project();
  stubCli(ios.dir);
  mkdirSync(path.join(ios.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(ios.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ a: "%ld photos", b: "%@ shared %lu", c: "Done" }),
  );
  expect(await run(FLAGS, ios.ctx)).toBe(0);
  expect((await loadConfig(ios.dir)).sources[0]).toMatchObject({
    library: "printf",
  });

  // A catalogue where {{ }} strings outnumber the single-brace and the
  // printf ones is i18next; a tie is not, and one {{ }} alone still is.
  for (const [values2, i18next] of [
    [{ a: "{{x}} one", b: "{{y}} two", c: "{z} three" }, true],
    [{ a: "{{x}} one", b: "{y} two" }, false],
    [{ a: "{{x}} one", b: "%s two" }, false],
    [{ a: "{{x}} one", b: "plain" }, true],
  ] as const) {
    const q = project();
    stubCli(q.dir);
    mkdirSync(path.join(q.dir, "src", "i18n"), { recursive: true });
    writeFileSync(
      path.join(q.dir, "src", "i18n", "pt-PT.json"),
      JSON.stringify(values2),
    );
    expect(await run(FLAGS, q.ctx)).toBe(0);
    const config = await loadConfig(q.dir);
    if (i18next)
      expect(config.sources[0]).toMatchObject({ library: "i18next" });
    else expect(config.sources[0]).not.toHaveProperty("library");
  }
});

test("a catalogue whose values are empty is said to take the key as the text (#589)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ "{amount} off": "", "Sign in": "", "ui.title": "Title" }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect(p.out.join("\n")).toMatch(
    /source values are empty: the key is the text, and a proposal on those strings is refused in src\/i18n\/pt-PT\.json/,
  );
});

test("i18next plural keys with single-brace interpolation stay icu, and init says why (#591)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      "{count} month_one": "{count} mês",
      "{count} month_other": "{count} meses",
      "{amount} off": "{amount} de desconto",
    }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).not.toHaveProperty("library");
  expect(p.out.join("\n")).toMatch(
    /i18next keys with \{ \} interpolation: read as icu, which checks the placeholders in src\/i18n\/pt-PT\.json/,
  );
});

test("a .ts catalogue is read for the library through the same loader as push", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.ts"),
    'export default { a: "Olá {{ name }}" };\n',
  );
  const flags = FLAGS.map((f) =>
    f === "src/i18n/{lang}.json" ? "src/i18n/{lang}.ts" : f,
  );
  expect(await run(flags, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "i18next",
  });
});

test("--syntax still works and says it is the old name", async () => {
  const p = project();
  stubCli(p.dir);
  expect(await run([...FLAGS, "--syntax", "i18next"], p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "i18next",
  });
  expect(p.err.join("\n")).toMatch(
    /--syntax is the old name for --library; it goes at 1\.0/,
  );
});

test("check.include is written from the directories that hold components (#498)", async () => {
  // Outline keeps its components in app/ and shared/, so the default
  // `src` scanned nothing until the config named them.
  const p = project();
  stubCli(p.dir);
  for (const [dir, file] of [
    ["app", "page.tsx"],
    ["shared", "Button.vue"],
    ["lib", "format.ts"],
  ] as const) {
    mkdirSync(path.join(p.dir, dir, "nested"), { recursive: true });
    writeFileSync(path.join(p.dir, dir, "nested", file), "");
  }
  expect(await run(FLAGS, p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.check).toEqual({ include: ["app", "shared"] });
  expect(p.out.join("\n")).toMatch(/check\.include: app, shared/);
});

test("check.include is not written when src alone holds the components, nor when nothing does", async () => {
  // `src` is what check scans by default, so a config that names it
  // says nothing the default does not.
  const only = project();
  stubCli(only.dir);
  mkdirSync(path.join(only.dir, "src", "components"), { recursive: true });
  writeFileSync(path.join(only.dir, "src", "components", "A.jsx"), "");
  expect(await run(FLAGS, only.ctx)).toBe(0);
  expect((await loadConfig(only.dir)).check).toBeUndefined();
  expect(only.out.join("\n")).not.toMatch(/check\.include/);

  const none = project();
  stubCli(none.dir);
  // What check skips, init skips: a compiled .jsx under dist is not a
  // component.
  mkdirSync(path.join(none.dir, "app", "node_modules", "x"), {
    recursive: true,
  });
  writeFileSync(path.join(none.dir, "app", "node_modules", "x", "a.tsx"), "");
  mkdirSync(path.join(none.dir, "lib", "dist"), { recursive: true });
  writeFileSync(path.join(none.dir, "lib", "dist", "b.jsx"), "");
  expect(await run(FLAGS, none.ctx)).toBe(0);
  expect((await loadConfig(none.dir)).check).toBeUndefined();
  // Nothing found is said, so the first corpus check is no surprise.
  // A messages catalogue may be any UI: both ways out are said (#1016).
  expect(none.out.join("\n")).toContain(
    "check.include: init found no .jsx, .tsx, .vue, .svelte, .hbs or .handlebars components or templates where it looks; set check.include in corpus.config.ts to where they are, or, if the UI is written in something else (C, GTK, Angular, ERB or Jinja templates), corpus check does not apply: leave it out of CI",
  );
});

test("a Qt, Android or Apple project with no components is told corpus check does not apply; a gettext one is told both ways (#1016)", async () => {
  const qt = project();
  write(
    qt.dir,
    "lang/app_en.ts",
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="en">\n<context><name>A</name><message><source>Quit</source><translation></translation></message></context>\n</TS>\n',
  );
  expect(await run(initFor("lang/app_{lang}.ts"), qt.ctx)).toBe(0);
  expect(qt.out.join("\n")).toContain(
    "corpus check reads .jsx, .tsx, .vue, .svelte, .hbs and .handlebars components and templates, which a Qt interface has none of: leave corpus check out of CI",
  );
  expect(qt.out.join("\n")).not.toMatch(/set check\.include/);
  const android = project();
  write(
    android.dir,
    "res/values/strings.xml",
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="hi">Hi</string>\n</resources>\n',
  );
  expect(await run(initFor("res"), android.ctx)).toBe(0);
  expect(android.out.join("\n")).toContain(
    "corpus check reads .jsx, .tsx, .vue, .svelte, .hbs and .handlebars components and templates, which an Android app has none of: leave corpus check out of CI",
  );
  // A .po catalogue may be a Lingui or Vue app's: both ways are said.
  const po = project();
  write(
    po.dir,
    "po/en.po",
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Quit"\nmsgstr ""\n',
  );
  expect(await run(initFor("po/{lang}.po"), po.ctx)).toBe(0);
  expect(po.out.join("\n")).toMatch(
    /init found no \.jsx, \.tsx, \.vue, \.svelte, \.hbs or \.handlebars components or templates where it looks; set check\.include .* or, if the UI is written in something else .*, corpus check does not apply/,
  );
  // Components found beside a .po catalogue are what check reads.
  const vue = project();
  write(
    vue.dir,
    "po/en.po",
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Quit"\nmsgstr ""\n',
  );
  write(
    vue.dir,
    "app/Home.vue",
    "<template><p>{{ $gettext('Quit') }}</p></template>\n",
  );
  expect(await run(initFor("po/{lang}.po"), vue.ctx)).toBe(0);
  expect(vue.out.join("\n")).toContain("check.include: app");
  expect(vue.out.join("\n")).not.toMatch(/does not apply/);
});

test("in a monorepo, check.include is the components directories below the root (#655)", async () => {
  // A monorepo's components, as Excalidraw's packages/excalidraw/components.
  const p = project();
  stubCli(p.dir);
  for (const dir of [
    "packages/hoppscotch-common/src/components/app",
    "packages/ui/components",
    "packages/node_modules/x/components",
  ]) {
    mkdirSync(path.join(p.dir, dir), { recursive: true });
    writeFileSync(path.join(p.dir, dir, "A.vue"), "");
  }
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).check).toEqual({
    include: [
      "packages/hoppscotch-common/src/components",
      "packages/ui/components",
    ],
  });
});

test("a components directory beside pages or layouts gives its parent, the app's root, as Nuxt's app/ is (#1047)", async () => {
  // Mealie: frontend/app/{components,pages,layouts}.
  const p = project();
  stubCli(p.dir);
  for (const [dir, file] of [
    ["web/app/components", "A.vue"],
    ["web/app/pages", "index.vue"],
    ["web/app/layouts", "default.vue"],
    ["web/app/pages/admin/components", "B.vue"],
    // Pages with nothing check reads leave a components directory as it is.
    ["packages/x/src/components", "C.vue"],
    ["packages/x/src/pages", "README.md"],
  ] as const) {
    mkdirSync(path.join(p.dir, dir), { recursive: true });
    writeFileSync(path.join(p.dir, dir, file), "");
  }
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).check).toEqual({
    include: ["packages/x/src/components", "web/app"],
  });
});

test("at the repository root, a components directory beside pages or layouts brings them along (#1047)", async () => {
  // Nuxt 3's layout: components/, pages/ and layouts/ at the root.
  const p = project();
  stubCli(p.dir);
  for (const [dir, file] of [
    ["components", "A.vue"],
    ["pages", "index.vue"],
    ["layouts", "default.vue"],
  ] as const) {
    mkdirSync(path.join(p.dir, dir), { recursive: true });
    writeFileSync(path.join(p.dir, dir, file), "");
  }
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).check).toEqual({
    include: ["components", "pages", "layouts"],
  });
});

test("a templates directory holding Handlebars is a root, as Zulip's web/templates is, its components below it included (#1027)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const [dir, file] of [
    ["web/templates", "about_zulip.hbs"],
    ["web/templates/components", "action_button.hbs"],
    ["web/templates/settings", "bot_settings.hbs"],
    // A templates directory of another engine is no root of check's.
    ["server/templates", "base.html"],
  ] as const) {
    mkdirSync(path.join(p.dir, dir), { recursive: true });
    writeFileSync(path.join(p.dir, dir, file), "");
  }
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).check).toEqual({
    include: ["web/templates"],
  });
});

test("with no components directory, the catalogue's own package's roots (#655)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "web", "locales"), { recursive: true });
  writeFileSync(path.join(p.dir, "web", "package.json"), "{}\n");
  writeFileSync(path.join(p.dir, "web", "locales", "pt-PT.json"), "{}\n");
  mkdirSync(path.join(p.dir, "web", "pages", "home"), { recursive: true });
  writeFileSync(path.join(p.dir, "web", "pages", "home", "index.tsx"), "");
  const flags = FLAGS.map((f) =>
    f === "src/i18n/{lang}.json" ? "web/locales/{lang}.json" : f,
  );
  expect(await run(flags, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).check).toEqual({ include: ["web/pages"] });

  // A path outside the repository names no package of its own, and an
  // absolute one ends the search rather than looping at the root.
  for (const messages of [
    "../web/locales/{lang}.json",
    `${p.dir}/web/locales/{lang}.json`,
  ]) {
    const q = project();
    stubCli(q.dir);
    const outside = FLAGS.map((f) =>
      f === "src/i18n/{lang}.json" ? messages : f,
    );
    await run(outside, q.ctx);
    expect(q.out.join("\n")).not.toMatch(/check\.include: \.\./);
  }
});

test("an .arb catalogue is read for its languages and its library (#558)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "l10n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "l10n", "strings_en.arb"),
    JSON.stringify({
      "@@locale": "en",
      hello: "Hello {{name}}",
      "@hello": { placeholders: { name: {} } },
    }),
  );
  writeFileSync(path.join(p.dir, "l10n", "strings_de.arb"), "{}\n");
  const code = await run(
    [
      "init",
      "--project",
      "app",
      "--source",
      "en",
      "--messages",
      "l10n/strings_{lang}.arb",
    ],
    p.ctx,
  );
  expect(code).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de"]);
  expect(config.sources[0]).toMatchObject({ library: "i18next" });
});

test("init reads the languages and the library through a {ns} pattern and writes it as given (#513)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const [lang, ns, text] of [
    ["en", "common", { hello: "Hello {{name}}" }],
    ["en", "admin", { users: "Users" }],
    ["de", "common", { hello: "Hallo {{name}}" }],
  ] as const) {
    mkdirSync(path.join(p.dir, "locales", lang), { recursive: true });
    writeFileSync(
      path.join(p.dir, "locales", lang, `${ns}.json`),
      JSON.stringify(text),
    );
  }
  expect(
    await run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        "locales/{lang}/{ns}.json",
      ],
      p.ctx,
    ),
  ).toBe(0);
  expect(readFileSync(path.join(p.dir, "corpus.config.ts"), "utf8")).toContain(
    'path: "locales/{lang}/{ns}.json"',
  );
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de"]);
  expect(
    config.sources.map((s) => (s.adapter === "exec" ? "" : s.path)),
  ).toEqual(["locales/{lang}/admin.json", "locales/{lang}/common.json"]);
  expect(config.sources[0]).toMatchObject({
    library: "i18next",
    namespace: "admin",
  });
});

test("init detects the library from the namespaces that read, and names the ones that do not (#1046)", async () => {
  const at = (files: Record<string, string>) => {
    const p = project();
    stubCli(p.dir);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(p.dir, file)), { recursive: true });
      writeFileSync(path.join(p.dir, file), text);
    }
    return p;
  };
  const flags = [
    "init",
    "--project",
    "app",
    "--source",
    "en",
    "--messages",
    "locales/{lang}/{ns}.json",
  ];
  // Chatwoot: a namespace that does not read hid the pipes of the rest.
  const some = at({
    "locales/en/a.json": JSON.stringify({ files: "one file | {n} files" }),
    "locales/en/b.json": "{ not json",
    "locales/en/c.json": JSON.stringify({ email: "Email {'@'} domain" }),
    "locales/de/a.json": JSON.stringify({ files: "eine Datei | {n} Dateien" }),
  });
  expect(await run(flags, some.ctx)).toBe(0);
  const config = await loadConfig(some.dir);
  expect(
    config.sources.map((s) => (s.adapter === "messages" ? s.library : "")),
  ).toEqual(["vue", "vue", "vue"]);
  expect(some.out.join("\n")).toMatch(
    /^library: vue, from a pipe or a quoted literal in locales\/en\/a\.json \(locales\/en\/b\.json not read: .+\)$/m,
  );
  // An icu result says it too, and more than three are counted.
  const icu = at({
    "locales/en/a.json": JSON.stringify({ hello: "Hello {name}" }),
    ...Object.fromEntries(
      ["b", "c", "d", "e"].map((ns) => [`locales/en/${ns}.json`, "{ x"]),
    ),
    "locales/de/a.json": "{}",
  });
  await run(flags, icu.ctx);
  expect(icu.out.join("\n")).toMatch(
    /^library: icu \(locales\/en\/b\.json, locales\/en\/c\.json, locales\/en\/d\.json, and 1 more not read: .+\)$/m,
  );
  // A source file that is missing is said already, not again here.
  const missing = project();
  stubCli(missing.dir);
  mkdirSync(path.join(missing.dir, "locales"), { recursive: true });
  writeFileSync(path.join(missing.dir, "locales", "de.json"), "{}");
  await run(
    [
      "init",
      "--project",
      "app",
      "--source",
      "en",
      "--messages",
      "locales/{lang}.json",
    ],
    missing.ctx,
  );
  expect(missing.out.join("\n")).not.toMatch(/library: not detected/);
  // A module catalogue's too, which jiti says otherwise.
  const module = project();
  stubCli(module.dir);
  mkdirSync(path.join(module.dir, "l"), { recursive: true });
  writeFileSync(path.join(module.dir, "l", "de.js"), "export default {};\n");
  await run(
    ["init", "--project", "app", "--source", "en", "--messages", "l/{lang}.js"],
    module.ctx,
  );
  expect(module.out.join("\n")).not.toMatch(/library: not detected/);
  // A namespace that is a broken link is a file that does not read.
  const linked = at({
    "locales/en/a.json": JSON.stringify({ files: "one file | {n} files" }),
    "locales/de/a.json": "{}",
  });
  const { symlinkSync } = await import("node:fs");
  symlinkSync(
    path.join(linked.dir, "nowhere.json"),
    path.join(linked.dir, "locales/en/b.json"),
  );
  await run(flags, linked.ctx);
  expect(linked.out.join("\n")).toMatch(
    /^library: vue, .*\(locales\/en\/b\.json not read: .+\)$/m,
  );
  // None that reads is said, not silence.
  const none = at({
    "locales/en/b.json": "{ not json",
    "locales/de/b.json": "{}",
  });
  await run(flags, none.ctx);
  expect(none.out.join("\n")).toMatch(
    /^library: not detected \(locales\/en\/b\.json: .+\)$/m,
  );
});

test("init reads languages through a {ns} pattern in either order, and names sibling catalogues a plain pattern leaves out (#513)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const [dir, lang, text] of [
    ["src/Button/i18n", "en", { save: "Save" }],
    ["src/Button/i18n", "de", { save: "Speichern" }],
    ["src/Card/Header/i18n", "en", { save: "Save the card" }],
  ] as const) {
    mkdirSync(path.join(p.dir, dir), { recursive: true });
    writeFileSync(path.join(p.dir, dir, `${lang}.json`), JSON.stringify(text));
  }
  expect(
    await run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        "src/{ns}/i18n/{lang}.json",
      ],
      p.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en", "de"]);

  const flat = project();
  stubCli(flat.dir);
  mkdirSync(path.join(flat.dir, "locales", "en"), { recursive: true });
  writeFileSync(path.join(flat.dir, "locales", "en", "common.json"), "{}\n");
  writeFileSync(path.join(flat.dir, "locales", "en", "admin.json"), "{}\n");
  expect(
    await run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        "locales/{lang}/common.json",
      ],
      flat.ctx,
    ),
  ).toBe(0);
  expect(flat.out.join("\n")).toMatch(
    /locales\/en\/common\.json has 1 sibling catalogue\(s\) the pattern does not name \(locales\/en\/admin\.json\); a \{ns\} pattern or an array of paths names them all/,
  );

  // Another language of the same pattern is not a sibling catalogue.
  const langs = project();
  stubCli(langs.dir);
  mkdirSync(path.join(langs.dir, "i18n"), { recursive: true });
  writeFileSync(path.join(langs.dir, "i18n", "messages.en.json"), "{}\n");
  writeFileSync(path.join(langs.dir, "i18n", "messages.pt-PT.json"), "{}\n");
  expect(
    await run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        "i18n/messages.{lang}.json",
      ],
      langs.ctx,
    ),
  ).toBe(0);
  expect(langs.out.join("\n")).not.toMatch(/sibling catalogue/);
});

test("init writes a yaml source for Rails catalogues, the languages from the files (#754)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "config", "locales", "client.en.yml"),
    'en:\n  a: "Hello %{name}"\n',
  );
  writeFileSync(
    path.join(p.dir, "config", "locales", "client.pt_BR.yml"),
    'pt_BR:\n  a: "Olá %{name}"\n',
  );
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "config/locales/client.{lang}.yml",
    ],
    p.ctx,
  );
  expect(p.err.join("\n")).toBe("");
  expect(code).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "pt_BR"]);
  expect(config.sources[0]).toEqual({
    adapter: "yaml",
    type: "ui",
    path: "config/locales/client.{lang}.yml",
  });
  expect(await run(["build"], p.ctx)).toBe(0);
});

test("init writes a qt-ts source for Qt Linguist .ts files, a POSIX code mapped through languageFiles (#742)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "lang"));
  const ts = (language: string, translation: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language}>\n<context>\n    <name>Main</name>\n    <message>\n        <source>Quit</source>\n        <translation${translation}</translation>\n    </message>\n</context>\n</TS>\n`;
  writeFileSync(
    path.join(p.dir, "lang", "app_en.ts"),
    ts("", ' type="unfinished">'),
  );
  writeFileSync(
    path.join(p.dir, "lang", "app_sr@latin.ts"),
    ts(' language="sr@latin"', ">Izlaz"),
  );
  writeFileSync(
    path.join(p.dir, "lang", "app_de.ts"),
    ts(' language="de"', ">Beenden"),
  );
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "lang/app_{lang}.ts",
    ],
    p.ctx,
  );
  expect(p.err.join("\n")).toBe("");
  expect(code).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "sr-Latn"]);
  expect(config.sources[0]).toEqual({
    adapter: "qt-ts",
    type: "ui",
    path: "lang/app_{lang}.ts",
    languageFiles: { "sr-Latn": "sr@latin" },
  });
  expect(await run(["build"], p.ctx)).toBe(0);
});

test("a real language without plural data draws no warning; a pseudo-locale and a made-up code do (#657)", async () => {
  const p = project();
  stubCli(p.dir);
  const flags = FLAGS.map((f) =>
    f === "pt-PT, en" ? "pt-PT, kaa, oc, oc-FR, ltg, qq, cr" : f,
  );
  expect(await run(flags, p.ctx)).toBe(0);
  const err = p.err.join("\n");
  for (const code of ["kaa", "oc", "oc-FR", "ltg"])
    expect(err).not.toMatch(new RegExp(`\\b${code} is not a language tag`));
  expect(err).toMatch(/qq is not a language tag the runtime knows/);
  expect(err).toMatch(/cr is not a language tag the runtime knows/);
});

test("init names counterpart where %(name)s placeholders dominate, as Element's catalogue does (#663)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      a: "%(user)s joined",
      b: "Invite <pill> to %(room)s",
      c: { one: "%(count)s room", other: "%(count)s rooms" },
      d: "Plain",
    }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "counterpart",
  });
  expect(p.out.join("\n")).toMatch(
    /library: counterpart, from %\(name\)s placeholders/,
  );
});

test("init names easy_localization where {} or @:key appear, as AppFlowy's catalogue does (#664)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ a: "Welcome to @:appName", b: "{} files", c: "Plain" }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "easy_localization",
  });
});

test("a vue catalogue's links and an ICU catalogue's stray {} do not make easy_localization (#664)", async () => {
  const vue = project();
  stubCli(vue.dir);
  mkdirSync(path.join(vue.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(vue.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      a: "Welcome to @:brand",
      b: "Write {'@'} to mention",
      c: "no apples | one apple | {count} apples",
    }),
  );
  expect(await run(FLAGS, vue.ctx)).toBe(0);
  expect((await loadConfig(vue.dir)).sources[0]).toMatchObject({
    library: "vue",
  });
  const icu = project();
  stubCli(icu.dir);
  mkdirSync(path.join(icu.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(icu.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      a: "{n, plural, one {# item} other {# items}}",
      b: "Use {} as a wildcard",
      c: "Hello {name}",
    }),
  );
  expect(await run(FLAGS, icu.ctx)).toBe(0);
  expect((await loadConfig(icu.dir)).sources[0]?.library).toBeUndefined();
  const printf = project();
  stubCli(printf.dir);
  mkdirSync(path.join(printf.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(printf.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      a: "%d files in %s",
      b: "%s deleted",
      c: "%d left",
      d: "Match {} and {}",
      e: "Use {}",
    }),
  );
  expect(await run(FLAGS, printf.ctx)).toBe(0);
  expect((await loadConfig(printf.dir)).sources[0]).toMatchObject({
    library: "printf",
  });
});

test("init names rails where %{name} placeholders dominate (#665)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({
      a: "Welcome to %{application_name}",
      b: "%{count} posts",
      c: "Plain",
    }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "rails",
  });
  expect(p.out.join("\n")).toMatch(
    /library: rails, from %\{name\} placeholders/,
  );
});

test("init writes an xliff source for Angular's catalogues, the source file apart (#712)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "locale"), { recursive: true });
  const unit = `<xliff version="1.2"><file source-language="en"><body><trans-unit id="a"><source>Hello</source></trans-unit></body></file></xliff>\n`;
  writeFileSync(path.join(p.dir, "src", "locale", "messages.xlf"), unit);
  for (const lang of ["de", "fr"])
    writeFileSync(
      path.join(p.dir, "src", "locale", `messages.${lang}.xlf`),
      unit,
    );
  const flags = [
    "init",
    "--project",
    "ghostfolio",
    "--source",
    "en",
    "--messages",
    "src/locale/messages.{lang}.xlf",
  ];
  const code = await run(flags, p.ctx);
  expect(p.err.join("\n")).toBe("");
  expect(code).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "fr"]);
  expect(config.sources[0]).toMatchObject({
    adapter: "xliff",
    path: "src/locale/messages.{lang}.xlf",
    sourcePath: "src/locale/messages.xlf",
  });
});

test("init finds Angular's messages.xlf where angular.json's extract-i18n writes it, and the config builds (#1045)", async () => {
  const unit = `<xliff version="1.2"><file source-language="en"><body><trans-unit id="a"><source>Hello</source></trans-unit></body></file></xliff>\n`;
  const initAt = async (
    files: Record<string, string>,
    messages: string,
  ): Promise<{ p: ReturnType<typeof project>; code: number }> => {
    const p = project();
    stubCli(p.dir);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(p.dir, file)), { recursive: true });
      writeFileSync(path.join(p.dir, file), text);
    }
    const code = await run(
      ["init", "--project", "app", "--source", "en", "--messages", messages],
      p.ctx,
    );
    return { p, code };
  };
  // paperless-ngx: no outputPath, so ng extract-i18n writes messages.xlf
  // beside angular.json, above the translations.
  const workspace = await initAt(
    {
      "web/angular.json": JSON.stringify({
        projects: {
          ui: {
            architect: {
              "extract-i18n": { options: { buildTarget: "ui:build" } },
            },
          },
        },
      }),
      "web/messages.xlf": unit,
      "web/src/locale/messages.de.xlf": unit,
      "web/src/locale/messages.fr.xlf": unit,
    },
    "web/src/locale/messages.{lang}.xlf",
  );
  expect(workspace.p.err.join("\n")).toBe("");
  expect(workspace.code).toBe(0);
  expect((await loadConfig(workspace.p.dir)).sources[0]).toMatchObject({
    adapter: "xliff",
    sourcePath: "web/messages.xlf",
  });
  expect(workspace.p.out).toContain(
    "sourcePath: web/messages.xlf (ng extract-i18n's output, from web/angular.json)",
  );
  expect(await run(["build"], workspace.p.ctx)).toBe(0);
  // An outputPath is the directory, from angular.json's.
  const output = await initAt(
    {
      "angular.json": JSON.stringify({
        projects: {
          ui: {
            architect: {
              "extract-i18n": { options: { outputPath: "src/i18n" } },
            },
          },
        },
      }),
      "src/i18n/messages.xlf": unit,
      "src/locale/messages.de.xlf": unit,
    },
    "src/locale/messages.{lang}.xlf",
  );
  expect((await loadConfig(output.p.dir)).sources[0]).toMatchObject({
    sourcePath: "src/i18n/messages.xlf",
  });
  expect(output.p.out).toContain(
    "sourcePath: src/i18n/messages.xlf (ng extract-i18n's output, from angular.json)",
  );
  // No angular.json: the messages.xlf nearest the targets, above them.
  const above = await initAt(
    {
      "web/messages.xlf": unit,
      "messages.xlf": unit,
      "web/src/locale/messages.de.xlf": unit,
    },
    "web/src/locale/messages.{lang}.xlf",
  );
  expect((await loadConfig(above.p.dir)).sources[0]).toMatchObject({
    sourcePath: "web/messages.xlf",
  });
  expect(above.p.out).toContain(
    "sourcePath: web/messages.xlf (the messages.xlf nearest the translations)",
  );
  // Nothing found names where init looked.
  const none = await initAt(
    { "web/src/locale/messages.de.xlf": unit },
    "web/src/locale/messages.{lang}.xlf",
  );
  expect(none.p.err).toContain(
    "corpus: no web/src/locale/messages.en.xlf, no web/src/locale/messages.xlf and no messages.xlf in web/src or above; set the xliff source's sourcePath to the file Angular extracts",
  );
});

test("init's search for Angular's messages.xlf: an absolute pattern, several projects, a non-XLIFF output, a commented angular.json and a git-ignored find (#1045)", async () => {
  const { spawnSync } = await import("node:child_process");
  const unit = `<xliff version="1.2"><file source-language="en"><body><trans-unit id="a"><source>Hello</source></trans-unit></body></file></xliff>\n`;
  const at = (files: Record<string, string>) => {
    const p = project();
    stubCli(p.dir);
    spawnSync("git", ["init", "-q"], { cwd: p.dir });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(p.dir, file)), { recursive: true });
      writeFileSync(path.join(p.dir, file), text);
    }
    return p;
  };
  const init = (
    p: ReturnType<typeof project>,
    messages: string,
    ...more: string[]
  ) =>
    run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        messages,
        ...more,
      ],
      p.ctx,
    );
  const sourcePathOf = async (p: ReturnType<typeof project>) =>
    (await loadConfig(p.dir)).sources[0] as { sourcePath?: string };
  // An absolute pattern walks up to the config's directory, no further.
  const absolute = at({ "loc/messages.de.xlf": unit, "messages.xlf": unit });
  expect(
    await init(
      absolute,
      path.join(absolute.dir, "loc/messages.{lang}.xlf"),
      "--languages",
      "en, de",
    ),
  ).toBe(0);
  expect(await sourcePathOf(absolute)).toMatchObject({
    sourcePath: "messages.xlf",
  });
  // The output nearest the translations, of several projects'; one that
  // is not XLIFF is none.
  const extract = (options: Record<string, string>) => ({
    architect: { "extract-i18n": { options } },
  });
  const projects = at({
    "angular.json": JSON.stringify({
      projects: {
        a: extract({ outFile: "apps/a/locale/messages.xlf" }),
        j: extract({ format: "json", outFile: "apps/b/source.json" }),
        b: extract({ outFile: "apps/b/src.xlf" }),
      },
    }),
    "apps/a/locale/messages.xlf": unit,
    "apps/b/source.json": "{}",
    "apps/b/src.xlf": unit,
    "apps/b/locale/de.xlf": unit,
  });
  await init(projects, "apps/b/locale/{lang}.xlf");
  expect(await sourcePathOf(projects)).toMatchObject({
    sourcePath: "apps/b/src.xlf",
  });
  // angular.json is JSON with comments, as the Angular CLI reads it.
  const commented = at({
    "web/angular.json": `{\n  // the workspace\n  "projects": { "ui": { "architect": { "extract-i18n": { "options": { "outputPath": "src/i18n", }, }, }, }, },\n}\n`,
    "web/src/i18n/messages.xlf": unit,
    "web/src/locale/messages.de.xlf": unit,
  });
  await init(commented, "web/src/locale/messages.{lang}.xlf");
  expect(await sourcePathOf(commented)).toMatchObject({
    sourcePath: "web/src/i18n/messages.xlf",
  });
  // An absolute outputPath is written in the config's terms, and builds;
  // angular.json may open with a byte-order mark, as the Angular CLI
  // reads it.
  const absoluteOutput = at({
    "src/locale/messages.de.xlf": unit,
    "i18n/messages.xlf": unit,
  });
  writeFileSync(
    path.join(absoluteOutput.dir, "angular.json"),
    "\uFEFF" +
      JSON.stringify({
        projects: {
          ui: extract({ outputPath: path.join(absoluteOutput.dir, "i18n") }),
        },
      }),
  );
  await init(absoluteOutput, "src/locale/messages.{lang}.xlf");
  expect(await sourcePathOf(absoluteOutput)).toMatchObject({
    sourcePath: "i18n/messages.xlf",
  });
  expect(await run(["build"], absoluteOutput.ctx)).toBe(0);
  // One outside the config's directory is written relative to it too.
  const outside = mkdtempSync(path.join(os.tmpdir(), "corpus-init-out-"));
  dirs.push(outside);
  writeFileSync(path.join(outside, "messages.xlf"), unit);
  const beyond = at({
    "angular.json": JSON.stringify({
      projects: { ui: extract({ outputPath: outside }) },
    }),
    "src/locale/messages.de.xlf": unit,
  });
  await init(beyond, "src/locale/messages.{lang}.xlf");
  expect(await sourcePathOf(beyond)).toMatchObject({
    sourcePath: path.relative(beyond.dir, path.join(outside, "messages.xlf")),
  });
  expect(await run(["build"], beyond.ctx)).toBe(0);
  // A missing output inside it is named in its terms, once, however
  // angular.json writes it.
  const twice = at({ "src/locale/messages.de.xlf": unit });
  writeFileSync(
    path.join(twice.dir, "angular.json"),
    JSON.stringify({
      projects: {
        a: extract({ outputPath: "i18n" }),
        b: extract({ outputPath: path.join(twice.dir, "i18n") }),
      },
    }),
  );
  await init(twice, "src/locale/messages.{lang}.xlf");
  expect(twice.err).toContain(
    "corpus: no src/locale/messages.en.xlf, no src/locale/messages.xlf, no i18n/messages.xlf and no messages.xlf in src or above; set the xliff source's sourcePath to the file Angular extracts",
  );
  // An angular.json that is no file guesses nothing.
  const directory = at({
    "angular.json/x": "",
    "src/locale/messages.de.xlf": unit,
  });
  expect(await init(directory, "src/locale/messages.{lang}.xlf")).toBe(0);
  // A file found is said git-ignored as a missing one is.
  const ignored = at({
    ".gitignore": "/web/messages.xlf\n",
    "web/angular.json": JSON.stringify({ projects: {} }),
    "web/messages.xlf": unit,
    "web/src/locale/messages.de.xlf": unit,
  });
  await init(ignored, "./web/src/locale/messages.{lang}.xlf");
  expect(ignored.err).toContain(
    "corpus: web/messages.xlf is git-ignored, so it is generated: commit it, or point the source at a file that is committed",
  );
  // Nothing found says each place once, `./` aside.
  const none = at({
    "angular.json": JSON.stringify({
      projects: { ui: extract({ outputPath: "/elsewhere" }) },
    }),
    "src/locale/messages.de.xlf": unit,
  });
  await init(none, "./src/locale/messages.{lang}.xlf");
  expect(none.err).toContain(
    "corpus: no src/locale/messages.en.xlf, no src/locale/messages.xlf, no /elsewhere/messages.xlf and no messages.xlf in src or above; set the xliff source's sourcePath to the file Angular extracts",
  );
});

test("the xliff sourcePath init chose is not said to be left out for naming no language; a stray file still is (#1219)", async () => {
  const unit = `<xliff version="1.2"><file source-language="en"><body><trans-unit id="a"><source>Hello</source></trans-unit></body></file></xliff>\n`;
  // However the pattern spells its directory.
  for (const messages of [
    "src/locale/{lang}.xlf",
    "./src/locale/{lang}.xlf",
    "src/./locale/{lang}.xlf",
  ]) {
    const p = project();
    stubCli(p.dir);
    mkdirSync(path.join(p.dir, "src", "locale"), { recursive: true });
    for (const name of ["de.xlf", "messages.xlf", "notes.xlf"])
      writeFileSync(path.join(p.dir, "src", "locale", name), unit);
    await run(
      ["init", "--project", "app", "--source", "en", "--messages", messages],
      p.ctx,
    );
    expect(p.out, messages).toContain(
      "sourcePath: src/locale/messages.xlf (the messages.xlf nearest the translations)",
    );
    const said = p.err.join("\n");
    expect(said, messages).not.toMatch(/messages\.xlf names no language tag/);
    expect(said, messages).toMatch(/notes\.xlf names no language tag/);
  }
  // A gettext target read as the source (#996), however its pattern
  // spells the directory.
  const po = (ids: string[]) =>
    `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"POT-Creation-Date: 2026-01-01 00:00+0000\\n"\n\n${ids.map((id) => `#: src/app.c:1\nmsgid "${id}"\nmsgstr ""\n`).join("\n")}`;
  for (const messages of ["po/{lang}.po", "./po/{lang}.po", "po/./{lang}.po"]) {
    const p = project();
    stubCli(p.dir);
    mkdirSync(path.join(p.dir, "po"), { recursive: true });
    writeFileSync(path.join(p.dir, "po", "de.po"), po(["Hello"]));
    writeFileSync(path.join(p.dir, "po", "messages.po"), po(["Hello", "Bye"]));
    writeFileSync(path.join(p.dir, "po", "notes.po"), po(["Hello"]));
    await run(
      ["init", "--project", "app", "--source", "en", "--messages", messages],
      p.ctx,
    );
    const said = p.err.join("\n");
    expect(said, messages).toMatch(
      /sourcePath is (\.\/)?po\/(\.\/)?messages\.po/,
    );
    expect(said, messages).not.toMatch(/messages\.po names no language tag/);
    expect(said, messages).toMatch(/notes\.po names no language tag/);
  }
});

test("init writes a gettext source for .po catalogues, the .pot beside them its source, and the config builds (#720)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "locales"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "locales", "joplin.pot"),
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] ""\nmsgstr[1] ""\n\nmsgid "Open %s"\nmsgstr ""\n',
  );
  for (const lang of ["de_DE", "ru_RU"])
    writeFileSync(
      path.join(p.dir, "locales", `${lang}.po`),
      'msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "Open %s"\nmsgstr "Öffne %s"\n',
    );
  const code = await run(
    [
      "init",
      "--project",
      "joplin",
      "--source",
      "en",
      "--messages",
      "locales/{lang}.po",
    ],
    p.ctx,
  );
  expect(p.err.join("\n")).not.toMatch(/gettext catalogue/);
  expect(code).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de_DE", "ru_RU"]);
  expect(config.sources[0]).toEqual({
    adapter: "gettext",
    type: "ui",
    path: "locales/{lang}.po",
    sourcePath: "locales/joplin.pot",
  });
  expect(p.out.join("\n")).not.toMatch(/^library:/m);
  expect(await run(["build"], p.ctx)).toBe(0);
});

test("init names the .pot files when there are several, and sets none (#720)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "po"), { recursive: true });
  for (const name of ["a.pot", "b.pot", "en.po", "de.po"])
    writeFileSync(path.join(p.dir, "po", name), 'msgid "x"\nmsgstr ""\n');
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "po/{lang}.po",
      ],
      p.ctx,
    ),
  ).toBe(0);
  expect(p.err.join("\n")).toContain("po/a.pot, po/b.pot sit beside");
  expect((await loadConfig(p.dir)).sources[0]).toEqual({
    adapter: "gettext",
    type: "ui",
    path: "po/{lang}.po",
  });
});

test("init finds GNU's layout's .pot above the language directories, writes --library on a gettext source, and refuses it on xliff (#720)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const lang of ["de", "fr"]) {
    mkdirSync(path.join(p.dir, "locales", lang, "LC_MESSAGES"), {
      recursive: true,
    });
    writeFileSync(
      path.join(p.dir, "locales", lang, "LC_MESSAGES", "app.po"),
      'msgid "Hello %(name)s"\nmsgstr ""\n',
    );
  }
  writeFileSync(
    path.join(p.dir, "locales", "app.pot"),
    'msgid "Hello %(name)s"\nmsgstr ""\n',
  );
  writeFileSync(
    path.join(p.dir, "locales", "other.pot"),
    'msgid "x"\nmsgstr ""\n',
  );
  const code = await run(
    [
      "init",
      "--project",
      "app",
      "--source",
      "en",
      "--messages",
      "locales/{lang}/LC_MESSAGES/app.po",
      "--library",
      "counterpart",
    ],
    p.ctx,
  );
  expect(p.err.join("\n")).toBe("");
  expect(code).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toEqual({
    adapter: "gettext",
    type: "ui",
    path: "locales/{lang}/LC_MESSAGES/app.po",
    sourcePath: "locales/app.pot",
    library: "counterpart",
  });
  expect(p.out.join("\n")).toContain("library: counterpart");
  expect(await run(["build"], p.ctx)).toBe(0);

  const x = project();
  stubCli(x.dir);
  mkdirSync(path.join(x.dir, "locale"), { recursive: true });
  writeFileSync(path.join(x.dir, "locale", "messages.en.xlf"), "<xliff/>");
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "locale/messages.{lang}.xlf",
        "--library",
        "icu",
      ],
      x.ctx,
    ),
  ).toBe(1);
  expect(x.err.join("\n")).toContain(
    "--library does not apply to an xliff source",
  );
});

test("init says so when a gettext source has no template, no source-language file and no target holding msgids (#720, #996)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "po"), { recursive: true });
  writeFileSync(path.join(p.dir, "po", "de.po"), 'msgid ""\nmsgstr ""\n');
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "po/{lang}.po",
      ],
      p.ctx,
    ),
  ).toBe(0);
  expect(p.err.join("\n")).toContain(
    "no .pot beside the catalogues and no po/en.po; set the gettext source's sourcePath",
  );
});

test("init writes an xcstrings source for a String Catalog, its languages and source read from the file (#729)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "App"), { recursive: true });
  const unit = (value: string) => ({
    stringUnit: { state: "translated", value },
  });
  writeFileSync(
    path.join(p.dir, "App", "Localizable.xcstrings"),
    JSON.stringify({
      sourceLanguage: "en",
      strings: {
        "Hello %@": {
          localizations: {
            en: unit("Hello %@"),
            "zh-Hans": unit("你好 %@"),
            de: unit("Hallo %@"),
          },
        },
      },
    }),
  );
  const flags = [
    "init",
    "--project",
    "app",
    "--messages",
    "App/Localizable.xcstrings",
  ];
  expect(await run(flags, p.ctx)).toBe(0);
  expect(p.err.join("\n")).toBe("");
  const config = await loadConfig(p.dir);
  expect(config.sourceLanguage).toBe("en");
  expect(config.languages).toEqual(["en", "de", "zh-Hans"]);
  expect(config.sources[0]).toEqual({
    adapter: "xcstrings",
    type: "ui",
    path: "App/Localizable.xcstrings",
  });
  expect(await run(["build"], p.ctx)).toBe(0);

  // A --source the catalogue does not name is refused.
  const q = project();
  stubCli(q.dir);
  mkdirSync(path.join(q.dir, "App"), { recursive: true });
  writeFileSync(
    path.join(q.dir, "App", "Localizable.xcstrings"),
    JSON.stringify({ sourceLanguage: "en", strings: {} }),
  );
  expect(await run([...flags, "--source", "pt"], q.ctx)).toBe(1);
  expect(q.err.join("\n")).toContain(
    "--source pt: App/Localizable.xcstrings names en as its source language",
  );
});

test("init names what is wrong with a String Catalog path: missing, broken, {lang}, or --source without a value (#729)", async () => {
  const p = project();
  const base = ["init", "--project", "app", "--messages"];
  expect(await run([...base, "App/Localizable.xcstrings"], p.ctx)).toBe(1);
  expect(p.err.join("\n")).toContain("App/Localizable.xcstrings: no such file");
  mkdirSync(path.join(p.dir, "App"), { recursive: true });
  writeFileSync(path.join(p.dir, "App", "Localizable.xcstrings"), "{ nope");
  expect(await run([...base, "App/Localizable.xcstrings"], p.ctx)).toBe(1);
  writeFileSync(path.join(p.dir, "App", "Localizable.xcstrings"), "{}");
  expect(await run([...base, "App/Localizable.xcstrings"], p.ctx)).toBe(1);
  expect(p.err.join("\n")).toContain("not a String Catalog");
  expect(await run([...base, "App/{lang}.xcstrings"], p.ctx)).toBe(1);
  expect(p.err.join("\n")).toContain("its path has no {lang}");
  expect(
    await run([...base, "App/Localizable.xcstrings", "--source"], p.ctx),
  ).toBe(1);
  expect(p.err.join("\n")).toContain("--source needs a value");
});

test("init's qt-ts: --languages keeps its mappings, an unmapped POSIX file is named, {lang} may be a directory, a missing source is said (#742)", async () => {
  const ts = (language: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language ? ` language="${language}"` : ""}>\n<context>\n    <name>Main</name>\n    <message>\n        <source>Quit</source>\n        <translation type="unfinished"></translation>\n    </message>\n</context>\n</TS>\n`;
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "lang"));
  for (const code of ["en", "de", "sr@latin", "de@euro"])
    writeFileSync(
      path.join(p.dir, "lang", `app_${code}.ts`),
      ts(code === "en" ? "" : code),
    );
  const base = ["init", "--project", "x", "--source", "en", "--messages"];
  expect(
    await run(
      [...base, "lang/app_{lang}.ts", "--languages", "en,sr-Latn"],
      p.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    languageFiles: { "sr-Latn": "sr@latin" },
  });
  expect(p.err.join("\n")).toContain(
    "lang/app_de@euro.ts names no language tag; left out",
  );

  // {lang} as a directory.
  const q = project();
  stubCli(q.dir);
  for (const code of ["en", "de"]) {
    mkdirSync(path.join(q.dir, "t", code), { recursive: true });
    writeFileSync(
      path.join(q.dir, "t", code, "app.ts"),
      ts(code === "en" ? "" : code),
    );
  }
  expect(await run([...base, "t/{lang}/app.ts"], q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).languages).toEqual(["en", "de"]);

  // No file for the source language: Qt still, and sourcePath is asked for.
  const r = project();
  stubCli(r.dir);
  mkdirSync(path.join(r.dir, "lang"));
  writeFileSync(path.join(r.dir, "lang", "app_de.ts"), ts("de"));
  expect(await run([...base, "lang/app_{lang}.ts"], r.ctx)).toBe(0);
  expect((await loadConfig(r.dir)).sources[0]?.adapter).toBe("qt-ts");
  expect(r.err.join("\n")).toContain(
    "no lang/app_en.ts; set the qt-ts source's sourcePath",
  );
});

test("init refuses a catalogue no adapter reads, by its format (#647)", async () => {
  const p = project();
  mkdirSync(path.join(p.dir, "i18n"), { recursive: true });
  writeFileSync(path.join(p.dir, "i18n", "app_en.properties"), "a=A\n");
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "i18n/app_{lang}.properties",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(
    /a Java \.properties catalogue, which no adapter reads/,
  );
  expect(existsSync(path.join(p.dir, "corpus.config.mjs"))).toBe(false);
});

test("init refuses a YAML catalogue that is not Rails', naming what it holds (#754)", async () => {
  const p = project();
  mkdirSync(path.join(p.dir, "translations"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "translations", "messages.en.yaml"),
    'hello: "Hello"\nbye: "Bye"\n',
  );
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "translations/messages.{lang}.yaml",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toContain(
    "a YAML catalogue the yaml source cannot read (no root key en: the file's root keys are hello, bye",
  );
  expect(p.err.join("\n")).toContain("an exec source converts any other");
  expect(existsSync(path.join(p.dir, "corpus.config.mjs"))).toBe(false);
});

test("init's qt-ts: lupdate's template is the sourcePath, {lang} as a directory needs no source directory, and only the files the pattern names decide (#749)", async () => {
  const ts = (language: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language ? ` language="${language}"` : ""}>\n<context>\n    <name>Main</name>\n    <message>\n        <source>Quit</source>\n        <translation type="unfinished"></translation>\n    </message>\n</context>\n</TS>\n`;
  const base = ["init", "--project", "x", "--source", "en", "--messages"];

  // The template beside the language files, and no app_en.ts.
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "lang"));
  writeFileSync(path.join(p.dir, "lang", "app.ts"), ts(""));
  for (const code of ["de", "fr"])
    writeFileSync(path.join(p.dir, "lang", `app_${code}.ts`), ts(code));
  expect(await run([...base, "lang/app_{lang}.ts"], p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    adapter: "qt-ts",
    sourcePath: "lang/app.ts",
  });
  expect(p.err.join("\n")).not.toContain("set the qt-ts source's sourcePath");
  expect(await run(["build", "--out", "snapshot.json"], p.ctx)).toBe(0);

  // {lang} as a directory with no t/en/.
  const q = project();
  stubCli(q.dir);
  for (const code of ["de", "fr"]) {
    mkdirSync(path.join(q.dir, "t", code), { recursive: true });
    writeFileSync(path.join(q.dir, "t", code, "app.ts"), ts(code));
  }
  expect(await run([...base, "t/{lang}/app.ts"], q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]?.adapter).toBe("qt-ts");

  // Only the files the pattern names decide: a Qt file beside TypeScript
  // catalogues the pattern names does not make them Qt's.
  const r = project();
  stubCli(r.dir);
  mkdirSync(path.join(r.dir, "src"));
  writeFileSync(path.join(r.dir, "src", "other.ts"), ts(""));
  writeFileSync(path.join(r.dir, "src", "main_de.ts"), "export default {};\n");
  expect(await run([...base, "src/main_{lang}.ts"], r.ctx)).toBe(0);
  expect((await loadConfig(r.dir)).sources[0]?.adapter).toBe("messages");

  // Another component's catalogue, which names its language, is no
  // template: sourcePath is asked for instead.
  const s = project();
  stubCli(s.dir);
  mkdirSync(path.join(s.dir, "lang"));
  for (const code of ["de", "fr"])
    writeFileSync(path.join(s.dir, "lang", `app_${code}.ts`), ts(code));
  writeFileSync(path.join(s.dir, "lang", "qt_de.ts"), ts("de"));
  expect(await run([...base, "lang/app_{lang}.ts"], s.ctx)).toBe(0);
  expect((await loadConfig(s.dir)).sources[0]).not.toHaveProperty("sourcePath");
  expect(s.err.join("\n")).toContain("set the qt-ts source's sourcePath");
});

test("a GNU @modifier catalogue is kept for every format: a script maps through languageFiles, another modifier is named (#855)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "po"), { recursive: true });
  const po = (lang: string) =>
    `msgid ""\nmsgstr ""\n"Language: ${lang}\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Quit"\nmsgstr "${lang === "en" ? "" : "Q"}"\n`;
  writeFileSync(path.join(p.dir, "po", "app.pot"), po("en"));
  for (const lang of ["en", "de", "sr@latin", "de@euro", "pt_BR"])
    writeFileSync(path.join(p.dir, "po", `${lang}.po`), po(lang));
  const code = await run(
    ["init", "--project", "x", "--source", "en", "--messages", "po/{lang}.po"],
    p.ctx,
  );
  expect(code).toBe(0);
  expect(p.err.join("\n")).toMatch(/po\/de@euro\.po names no language tag/);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "pt_BR", "sr-Latn"]);
  expect(config.sources[0]).toMatchObject({
    adapter: "gettext",
    languageFiles: { "sr-Latn": "sr@latin" },
  });
});

test("a JSON catalogue's @script files are languages, never siblings (#855)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "messages"), { recursive: true });
  for (const lang of ["en", "de", "sr@latin", "uz@Latn"])
    writeFileSync(
      path.join(p.dir, "messages", `${lang}.json`),
      JSON.stringify({ hello: lang === "en" ? "Hello" : "Hallo" }),
    );
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "messages/{lang}.json",
    ],
    p.ctx,
  );
  expect(code).toBe(0);
  expect([...p.out, ...p.err].join("\n")).not.toMatch(/sibling/);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "sr-Latn", "uz-Latn"]);
  expect(config.sources[0]).toMatchObject({
    languageFiles: { "sr-Latn": "sr@latin", "uz-Latn": "uz@Latn" },
  });
});

test("init refuses {ns} for a format whose adapter does not read it, Qt's .ts too (#855)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "lang"), { recursive: true });
  const ts = (lang: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="${lang}">\n<context>\n    <name>A</name>\n    <message>\n        <source>Quit</source>\n        <translation>Q</translation>\n    </message>\n</context>\n</TS>\n`;
  for (const lang of ["en", "de"])
    writeFileSync(path.join(p.dir, "lang", `app_${lang}.ts`), ts(lang));
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--messages",
      "lang/{ns}_{lang}.ts",
    ],
    p.ctx,
  );
  expect(code).not.toBe(0);
  expect(p.err.join("\n")).toMatch(
    /qt-ts does not read \{ns\}: only messages, table, fluent and android do/,
  );
});

test("a pattern with {lang} twice inits and builds (#856)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const lang of ["en", "de"]) {
    mkdirSync(path.join(p.dir, "i18n", lang), { recursive: true });
    writeFileSync(
      path.join(p.dir, "i18n", lang, `${lang}.json`),
      JSON.stringify({ hello: lang === "en" ? "Hello" : "Hallo" }),
    );
  }
  const init = [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    "i18n/{lang}/{lang}.json",
  ];
  expect(await run(init, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en", "de"]);
  expect(await run(["build"], p.ctx)).toBe(0);
});

test("init warns of a missing source file for every format, and build names it plainly (#856)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "loc"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "loc", "messages.de.xlf"),
    `<?xml version="1.0" encoding="UTF-8" ?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file source-language="en" target-language="de" datatype="plaintext" original="a">\n    <body>\n      <trans-unit id="a">\n        <source>A</source>\n        <target>Aa</target>\n      </trans-unit>\n    </body>\n  </file>\n</xliff>\n`,
  );
  const init = [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    "loc/messages.{lang}.xlf",
    "--languages",
    "en,de",
  ];
  expect(await run(init, p.ctx)).toBe(0);
  expect(p.err.join("\n")).toMatch(/no loc\/messages\.en\.xlf/);
  p.err.length = 0;
  expect(await run(["build"], p.ctx)).toBe(1);
  expect(p.err.join("\n")).toMatch(
    /source file loc\/messages\.en\.xlf does not exist/,
  );
  expect(p.err.join("\n")).not.toMatch(/ENOENT/);
});

test("init warns of a missing JSON source file, and is silent where a {ns} pattern's files exist (#856)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "i18n"), { recursive: true });
  writeFileSync(path.join(p.dir, "i18n", "de.json"), '{"a":"A"}');
  const flags = (messages: string) => [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    messages,
    "--languages",
    "en,de",
  ];
  expect(await run(flags("i18n/{lang}.json"), p.ctx)).toBe(0);
  expect(p.err.join("\n")).toMatch(
    /no i18n\/en\.json: build reads the source language's strings from it/,
  );
  const q = project();
  stubCli(q.dir);
  mkdirSync(path.join(q.dir, "locales", "en"), { recursive: true });
  writeFileSync(path.join(q.dir, "locales", "en", "common.json"), '{"a":"A"}');
  expect(await run(flags("locales/{lang}/{ns}.json"), q.ctx)).toBe(0);
  expect(q.err.join("\n")).not.toMatch(/build reads the source language/);
});

test("a yaml pattern with {lang} twice reads each file's own language (#856)", async () => {
  const p = project();
  stubCli(p.dir);
  for (const lang of ["en", "de"]) {
    mkdirSync(path.join(p.dir, "cfg", lang), { recursive: true });
    writeFileSync(
      path.join(p.dir, "cfg", lang, `${lang}.yml`),
      `${lang}:\n  a: ${lang === "en" ? "A" : "B"}\n`,
    );
  }
  const init = [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    "cfg/{lang}/{lang}.yml",
  ];
  expect(await run(init, p.ctx)).toBe(0);
  expect(await run(["build", "--out", "snap.json"], p.ctx)).toBe(0);
  const snap = JSON.parse(readFileSync(path.join(p.dir, "snap.json"), "utf8"));
  expect(snap.seedTranslations).toEqual({ de: { a: "B" } });
});

test("a JSON catalogue named with a POSIX modifier that is no tag is said to name no language, not a sibling (#930)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "l"));
  for (const code of ["en", "de", "sr@latin", "de@euro"])
    writeFileSync(path.join(p.dir, "l", `${code}.json`), '{"a":"A"}');
  expect(
    await run(
      [
        "init",
        "--project",
        "app",
        "--source",
        "en",
        "--messages",
        "l/{lang}.json",
      ],
      p.ctx,
    ),
  ).toBe(0);
  const said = [...p.out, ...p.err].join("\n");
  expect(said).toMatch(
    /l\/de@euro\.json names no language tag; left out: name its language, as languages: \["<tag>"\] with languageFiles: \{ "<tag>": "de@euro" \} on the source/,
  );
  expect(said).not.toMatch(/sibling catalogue/);
});

test("an xliff pattern with {lang} twice guesses no bare source file (#930)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "loc", "de"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "loc", "de", "messages.de.xlf"),
    `<?xml version="1.0"?>\n<xliff version="1.2"><file source-language="en" target-language="de" datatype="plaintext" original="x"><body>\n</body></file></xliff>\n`,
  );
  await run(
    [
      "init",
      "--project",
      "app",
      "--source",
      "en",
      "--messages",
      "loc/{lang}/messages.{lang}.xlf",
    ],
    p.ctx,
  );
  const said = p.err.join("\n");
  expect(said).toContain(
    "corpus: no loc/en/messages.en.xlf and no messages.xlf in loc or above; set the xliff source's sourcePath to the file Angular extracts",
  );
  expect(said).not.toContain("{lang}");
});

test("init reads a Rails type as HTML where its tags are only HTML's, and names the edit for any other library (#952)", async () => {
  const rails = project();
  stubCli(rails.dir);
  mkdirSync(path.join(rails.dir, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(rails.dir, "config", "locales", "client.en.yml"),
    'en:\n  empty: "No likes yet.<br>Like a post to see it here."\n  intro: "<p>Welcome, %{name}."\n',
  );
  writeFileSync(
    path.join(rails.dir, "config", "locales", "client.pt.yml"),
    "pt:\n  intro: Olá\n",
  );
  const args = (messages: string) => [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    messages,
  ];
  expect(await run(args("config/locales/client.{lang}.yml"), rails.ctx)).toBe(
    0,
  );
  expect(rails.out.join("\n")).toMatch(
    /richText: ui is read as HTML: 2 source string\(s\) hold tags/,
  );
  expect((await loadConfig(rails.dir)).richText).toEqual({ ui: "html" });
  expect(await run(["build"], rails.ctx)).toBe(0);

  const react = project();
  stubCli(react.dir);
  mkdirSync(path.join(react.dir, "locales"));
  writeFileSync(
    path.join(react.dir, "locales", "en.json"),
    '{ "empty": "No likes yet.<br>Like a post to see it here." }\n',
  );
  writeFileSync(path.join(react.dir, "locales", "pt.json"), "{}\n");
  expect(await run(args("locales/{lang}.json"), react.ctx)).toBe(0);
  expect(react.out.join("\n")).toMatch(
    /1 source string\(s\) hold tags only HTML takes as text.*add richText: \{ ui: "html" \}/,
  );
  expect((await loadConfig(react.dir)).richText).toBeUndefined();

  // A yaml source of another library is not Rails': its tags may be
  // components, as FormatJS's <1> is, so init only says it. (Under
  // i18next an unclosed tag is text already, #986.)
  const i18next = project();
  stubCli(i18next.dir);
  mkdirSync(path.join(i18next.dir, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(i18next.dir, "config", "locales", "client.en.yml"),
    'en:\n  cta: "Click <1>here to continue"\n  br: "One<br>two"\n',
  );
  expect(
    await run(
      [
        ...args("config/locales/client.{lang}.yml"),
        "--library",
        "icu",
        "--type",
        "ui-text",
        "--languages",
        "en,pt",
      ],
      i18next.ctx,
    ),
  ).toBe(0);
  expect(i18next.out.join("\n")).toMatch(
    /add richText: \{ "ui-text": "html" \}/,
  );
  expect((await loadConfig(i18next.dir)).richText).toBeUndefined();

  // A JSON catalogue read as rails, I18n.js's, is not a server's HTML.
  const i18njs = project();
  stubCli(i18njs.dir);
  mkdirSync(path.join(i18njs.dir, "locales"));
  writeFileSync(
    path.join(i18njs.dir, "locales", "en.json"),
    '{ "a": "Hi %{name}<br>there", "b": "%{count} posts", "c": "<p>Bye %{name}" }\n',
  );
  writeFileSync(path.join(i18njs.dir, "locales", "pt.json"), "{}\n");
  expect(await run(args("locales/{lang}.json"), i18njs.ctx)).toBe(0);
  expect(i18njs.out.join("\n")).toMatch(/library: rails/);
  expect(i18njs.out.join("\n")).toMatch(/add richText: \{ ui: "html" \}/);
  expect((await loadConfig(i18njs.dir)).richText).toBeUndefined();
});

test("a plural object's forms count as the file writes them, so {{ }} in them names i18next: Grafana's lone other, Rocket.Chat's one and other (#984)", async () => {
  for (const values of [
    {
      a: "Olá {{ name }}",
      b: "{{count}} ficheiros",
      cat: { other: "Outro" },
    },
    {
      a: "Olá {{ name }}",
      b: "{{count}} ficheiros",
      calls: { one: "{{count}} chamada", other: "{{count}} chamadas" },
    },
  ]) {
    const p = project();
    stubCli(p.dir);
    mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
    writeFileSync(
      path.join(p.dir, "src", "i18n", "pt-PT.json"),
      JSON.stringify(values),
    );
    expect(await run(FLAGS, p.ctx)).toBe(0);
    const config = await loadConfig(p.dir);
    expect(config.sources[0], JSON.stringify(values)).toMatchObject({
      library: "i18next",
    });
  }
});

test("init offers no richText for an i18next catalogue whose tags are only unpaired (#986)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "locales"));
  writeFileSync(
    path.join(p.dir, "locales", "en.json"),
    '{ "a": "Hi {{name}}", "b": "<no title>", "c": "Click <1>here to continue", "d": "{{count}} left" }\n',
  );
  writeFileSync(path.join(p.dir, "locales", "pt.json"), "{}\n");
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "locales/{lang}.json",
      ],
      p.ctx,
    ),
  ).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({ library: "i18next" });
  expect(config.richText).toBeUndefined();
  expect(p.out.join("\n")).not.toMatch(/richText/);
});

test("init writes no richText for tags only an _html key holds, which Rails reads as HTML already, and names the keys that need it (#988)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "config", "locales", "en.yml"),
    'en:\n  hint_html: "One<br>two %{n}"\n  plain: "Hi %{n}"\n',
  );
  writeFileSync(path.join(p.dir, "config", "locales", "pt.yml"), "pt:\n");
  const args = [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    "config/locales/{lang}.yml",
  ];
  expect(await run(args, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).richText).toBeUndefined();

  const q = project();
  stubCli(q.dir);
  mkdirSync(path.join(q.dir, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(q.dir, "config", "locales", "en.yml"),
    'en:\n  hint_html: "One<br>two %{n}"\n  plain: "One<br>two %{n}"\n',
  );
  writeFileSync(path.join(q.dir, "config", "locales", "pt.yml"), "pt:\n");
  expect(await run(args, q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).richText).toEqual({ ui: "html" });
  expect(q.out.join("\n")).toMatch(
    /1 source string\(s\) hold tags only HTML takes as text.*\(plain\)/,
  );
});

const write = (dir: string, rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
const initFor = (messages: string, source = "en") => [
  "init",
  "--project",
  "p",
  "--source",
  source,
  "--messages",
  messages,
];

test("init writes a fluent source for a .ftl pattern, {ns} included, with the languages its files name (#993)", async () => {
  const p = project();
  write(p.dir, "i18n/en/app.ftl", "hello = Hello\n");
  write(p.dir, "i18n/pt-BR/app.ftl", "hello = Olá\n");
  write(p.dir, "i18n/de/app.ftl", "hello = Hallo\n");
  expect(await run(initFor("i18n/{lang}/app.ftl"), p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "pt-BR"]);
  expect(config.sources[0]).toEqual({
    adapter: "fluent",
    type: "ui",
    path: "i18n/{lang}/app.ftl",
  });
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);

  const ns = project();
  write(ns.dir, "core/en/a.ftl", "x = X\n");
  write(ns.dir, "core/en/b.ftl", "y = Y\n");
  write(ns.dir, "core/fr/a.ftl", "x = X\n");
  expect(await run(initFor("core/{lang}/{ns}.ftl"), ns.ctx)).toBe(0);
  const nsConfig = await loadConfig(ns.dir);
  expect(nsConfig.languages).toEqual(["en", "fr"]);
  // The loader expands {ns}; the file keeps the pattern as given.
  expect(nsConfig.sources[0]).toMatchObject({ adapter: "fluent" });
  expect(
    readFileSync(path.join(ns.dir, "corpus.config.mjs"), "utf8"),
  ).toContain('path: "core/{lang}/{ns}.ftl"');
});

test("init writes an android source for a res directory, its values-* qualifiers read as tags (#993)", async () => {
  const strings = (text: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="hi">${text}</string>\n</resources>\n`;
  const res = "legacy/ui/src/main/res";
  const setup = () => {
    const p = project();
    write(p.dir, `${res}/values/strings.xml`, strings("Hi"));
    write(p.dir, `${res}/values-pt-rBR/strings.xml`, strings("Oi"));
    write(p.dir, `${res}/values-b+sr+Latn/strings.xml`, strings("Zdravo"));
    write(p.dir, `${res}/values-iw/strings.xml`, strings("שלום"));
    write(p.dir, `${res}/values-sw360dp/strings.xml`, strings("Hi"));
    write(p.dir, `${res}/values-night/colors.xml`, "<resources/>\n");
    write(p.dir, `${res}/values-b+es+419/strings.xml`, strings("Hola"));
    // Not where the android source writes de, nor a language.
    write(p.dir, `${res}/values-b+de/strings.xml`, strings("Hallo"));
    write(p.dir, `${res}/values-car/strings.xml`, strings("Hi"));
    return p;
  };
  for (const messages of [
    res,
    `${res}/`,
    `${res}/values-{lang}/strings.xml`,
    `${res}/values`,
    `${res}/values/strings.xml`,
  ]) {
    const p = setup();
    expect(await run(initFor(messages), p.ctx)).toBe(0);
    const config = await loadConfig(p.dir);
    expect(config.languages).toEqual([
      "en",
      "es-419",
      "iw",
      "pt-BR",
      "sr-Latn",
    ]);
    expect(config.sources[0]).toEqual({
      adapter: "android",
      type: "ui",
      path: res,
    });
    const said = p.err.join("\n");
    expect(said).toContain(
      `corpus: ${res}/values-sw360dp is no language's own values directory; left out`,
    );
    expect(said).toContain(
      `corpus: ${res}/values-car is no language's own values directory; left out`,
    );
    expect(said).toContain(
      `corpus: ${res}/values-b+de names de, which the android source reads from values-de; left out`,
    );
    expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);
  }
  // A plain .xml outside a res directory is still refused.
  const plain = project();
  write(plain.dir, "data/en.xml", "<a/>\n");
  expect(await run(initFor("data/{lang}.xml"), plain.ctx)).toBe(1);
  expect(plain.err.join("\n")).toMatch(/exec/);
});

const po = (date: string, ids: string[]) =>
  `msgid ""\nmsgstr ""\n"POT-Creation-Date: ${date}\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n\n` +
  ids
    .map((id) => `#: src/app.c:1\nmsgid "${id}"\nmsgstr "${id}!"\n`)
    .join("\n");

test("init with no template and no source .po takes a target .po's msgids as the source (#996)", async () => {
  const p = project();
  write(
    p.dir,
    "po/de.po",
    po("2025-01-01 10:00+0000", ["Open", "Close", "Quit"]),
  );
  write(
    p.dir,
    "po/fr.po",
    po("2025-01-01 10:00+0000", ["Open", "Close", "Quit"]),
  );
  write(p.dir, "po/it.po", po("2025-01-01 10:00+0000", ["Open", "Close"]));
  expect(await run(initFor("po/{lang}.po"), p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({
    adapter: "gettext",
    path: "po/{lang}.po",
    sourcePath: "po/de.po",
  });
  expect(p.err.join("\n")).toContain(
    "corpus: no template: sourcePath is po/de.po, whose msgids are the catalogue's; point it at a .pot when one is committed",
  );
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);
  const snapshot = JSON.parse(readFileSync(path.join(p.dir, "s.json"), "utf8"));
  expect(snapshot.strings.map((s: { id: string }) => s.id)).toEqual([
    "Open",
    "Close",
    "Quit",
  ]);

  // The newest date wins, however many stale files share an older one
  // (paperless-ngx's en_US, which makemessages regenerated), and only a
  // msgid another current file holds is said missing, never a stale one.
  const q = project();
  write(
    q.dir,
    "po/de.po",
    po("2024-01-01 10:00+0000", ["Open", "Close", "Old"]),
  );
  write(
    q.dir,
    "po/es.po",
    po("2024-01-01 10:00+0000", ["Open", "Close", "Old"]),
  );
  write(
    q.dir,
    "po/fr.po",
    po("2025-06-01 10:00+0000", ["Open", "Close", "New"]),
  );
  write(
    q.dir,
    "po/it.po",
    po("2025-06-01 10:00+0000", ["Open", "Close", "New", "Newer"]),
  );
  write(q.dir, "po/pt.po", po("YEAR-MO-DA HO:MI+ZONE", ["Open"]));
  expect(await run(initFor("po/{lang}.po"), q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).toMatchObject({
    sourcePath: "po/it.po",
  });
  expect(q.err.join("\n")).not.toContain("lacks");
  expect(q.err.join("\n")).toContain(
    "corpus: 1 msgid(s) only older catalogues hold, likely removed since, are not read",
  );
  const r = project();
  write(
    r.dir,
    "po/fr.po",
    po("2025-06-01 10:00+0000", ["Open", "Close", "New"]),
  );
  write(
    r.dir,
    "po/it.po",
    po("2025-06-01 10:00+0000", ["Open", "Close", "Newer"]),
  );
  expect(await run(initFor("po/{lang}.po"), r.ctx)).toBe(0);
  expect(r.err.join("\n")).toContain(
    "corpus: po/fr.po lacks 1 msgid(s) another current catalogue holds; those are not read",
  );
});

test("init says a missing source file git ignores is generated, whatever the adapter (#996)", async () => {
  const { spawnSync } = await import("node:child_process");
  const cases: [string, string, string][] = [
    [
      "locale/{lang}/translations.json",
      "locale/de/translations.json",
      '{ "hi": "Hallo" }\n',
    ],
    [
      "src/locale/messages.{lang}.xlf",
      "src/locale/messages.de.xlf",
      '<?xml version="1.0"?>\n<xliff version="1.2"><file source-language="en" target-language="de"><body></body></file></xliff>\n',
    ],
    [
      "lang/app_{lang}.ts",
      "lang/app_de.ts",
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="de"></TS>\n',
    ],
    [
      "config/locales/{lang}.yml",
      "config/locales/de.yml",
      "de:\n  hi: Hallo\n",
    ],
  ];
  for (const [pattern, file, text] of cases) {
    const p = project();
    spawnSync("git", ["init", "-q"], { cwd: p.dir });
    const source = pattern.replace("{lang}", "en");
    write(p.dir, ".gitignore", `/${source}\n`);
    write(p.dir, file, text);
    await run(initFor(pattern), p.ctx);
    expect(p.err.join("\n"), pattern).toContain(
      `corpus: ${source} is git-ignored, so it is generated: commit it, or point the source at a file that is committed`,
    );
  }
});

test("init writes sourceVariants for a target in the source's own language and script, and says so (#1014)", async () => {
  const variants = async (
    source: string,
    codes: string[],
    extra: string[] = [],
  ) => {
    const p = project();
    for (const code of codes) write(p.dir, `l/${code}.json`, "{}\n");
    expect(
      await run([...initFor("l/{lang}.json", source), ...extra], p.ctx),
    ).toBe(0);
    const config = await loadConfig(p.dir);
    return { variants: config.sourceVariants, out: p.out.join("\n") };
  };
  const en = await variants("en", ["en", "en_GB", "de"]);
  expect(en.variants).toEqual(["en_GB"]);
  expect(en.out).toContain(
    "sourceVariants: en_GB (a variant of en: a row it leaves as the source's text seeds as translated, and a row it lacks is not listed as work, since the app falls back to en; remove a variant whose rows are work)",
  );
  const three = await variants("en", ["en", "en_AU", "en_CA", "en_GB"]);
  expect(three.out).toContain(
    "sourceVariants: en_AU, en_CA, en_GB (variants of en: a row a variant leaves as the source's text seeds as translated, and a row it lacks is not listed as work, since the app falls back to en; remove a variant whose rows are work)",
  );
  // A pseudo-locale is generated text, no variant.
  expect(
    (await variants("en", ["en", "en-XA", "en-XC"])).variants,
  ).toBeUndefined();
  expect(
    (await variants("en", ["en", "en-GB", "en_US", "fr"])).variants,
  ).toEqual(["en-GB", "en_US"]);
  expect((await variants("pt-BR", ["pt-BR", "pt-PT", "es"])).variants).toEqual([
    "pt-PT",
  ]);
  // Another script is a translation of its own.
  expect(
    (await variants("zh-Hans", ["zh-Hans", "zh-Hant"])).variants,
  ).toBeUndefined();
  expect((await variants("sr", ["sr", "sr-Latn"])).variants).toBeUndefined();
  expect((await variants("en", ["en", "de"])).variants).toBeUndefined();
  // Android's qualifiers name them too.
  const android = project();
  const strings = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="hi">Hi</string>\n</resources>\n`;
  for (const dir of ["values", "values-en-rGB", "values-de"])
    write(android.dir, `res/${dir}/strings.xml`, strings);
  expect(await run(initFor("res"), android.ctx)).toBe(0);
  expect((await loadConfig(android.dir)).sourceVariants).toEqual(["en-GB"]);
  // A list given by hand is read the same way.
  expect(
    (await variants("en", ["en"], ["--languages", "en,en-AU,ja"])).variants,
  ).toEqual(["en-AU"]);
});

test("init maps ca@valencia to ca-valencia through languageFiles, and names the line to write for a code it cannot (#1015)", async () => {
  for (const pattern of ["l/{lang}.json", "po/{lang}.po"]) {
    const p = project();
    const ext = pattern.endsWith(".po") ? "po" : "json";
    const body =
      ext === "po"
        ? 'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hi"\nmsgstr "Hola"\n'
        : '{ "hi": "Hola" }\n';
    write(
      p.dir,
      `${pattern.split("/")[0]}/en.${ext}`,
      body.replace("Hola", "Hi"),
    );
    write(p.dir, `${pattern.split("/")[0]}/ca@valencia.${ext}`, body);
    expect(await run(initFor(pattern), p.ctx)).toBe(0);
    const config = await loadConfig(p.dir);
    expect(config.languages).toEqual(["en", "ca-valencia"]);
    expect(config.sources[0]).toMatchObject({
      languageFiles: { "ca-valencia": "ca@valencia" },
    });
    expect(p.err.join("\n")).not.toMatch(/left out/);
  }
  const q = project();
  write(q.dir, "l/en.json", "{}\n");
  write(q.dir, "l/ca@foo.json", "{}\n");
  write(q.dir, "l/sr@foo.json", "{}\n");
  expect(await run(initFor("l/{lang}.json"), q.ctx)).toBe(0);
  expect(q.err.join("\n")).toContain(
    'corpus: l/ca@foo.json names no language tag; left out: name its language, as languages: ["<tag>"] with languageFiles: { "<tag>": "ca@foo" } on the source',
  );
  // One line a file, each its own mapping.
  expect(q.err.join("\n")).toContain(
    'corpus: l/sr@foo.json names no language tag; left out: name its language, as languages: ["<tag>"] with languageFiles: { "<tag>": "sr@foo" } on the source',
  );
});

test("an ICU catalogue whose ids end in a plural suffix draws no i18next note (#1020)", async () => {
  const p = project();
  write(
    p.dir,
    "l/en.json",
    JSON.stringify({
      "account.familiar_followers_many": "Followed by {name1}, {name2}",
      "hashtags.and_other": "{count, plural, one {# more} other {# more}}",
    }),
  );
  expect(await run(initFor("l/{lang}.json"), p.ctx)).toBe(0);
  expect(p.out.join("\n")).not.toMatch(/i18next keys/);
});

test("files beside the catalogue that are catalogues of their own are said as families; a long list is cut at five (#1020)", async () => {
  const yml = (lang: string) => `${lang}:\n  hi: Hi\n`;
  const p = project();
  for (const name of ["en", "de", "sf.en", "sf.de", "devise.en", "devise.de"])
    write(p.dir, `y/${name}.yml`, yml(name.split(".").at(-1)!));
  expect(await run(initFor("y/{lang}.yml"), p.ctx)).toBe(0);
  const said = p.err.join("\n");
  expect(said).toContain(
    // A Rails app's families are one tree: one source lists them (#1024).
    'corpus: 2 other catalogue(s) beside y/{lang}.yml, 4 file(s) (y/devise.{lang}.yml, y/sf.{lang}.yml): where the app loads them into one catalogue, as Rails does, list them in the source\'s path in the order it loads them, path: ["y/{lang}.yml", "y/devise.{lang}.yml", "y/sf.{lang}.yml"]; otherwise each is its own source',
  );
  expect(said).not.toMatch(/sf\.en\.yml/);
  // A source that takes one pattern says each is its own.
  const po = project();
  const poText =
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hi"\nmsgstr ""\n';
  for (const name of ["en", "de", "app.en", "app.de"])
    write(po.dir, `po/${name}.po`, poText);
  expect(await run(initFor("po/{lang}.po"), po.ctx)).toBe(0);
  expect(po.err.join("\n")).toContain(
    'corpus: 1 other catalogue(s) beside po/{lang}.po, 2 file(s) (po/app.{lang}.po): each is its own source, as { adapter: "gettext", type: "ui", path: "po/app.{lang}.po" }',
  );
  // A language and a region with a dot are a code, not a family.
  const dotted = project();
  for (const name of ["en", "de", "pt.BR"])
    write(dotted.dir, `y/${name}.yml`, yml(name));
  expect(await run(initFor("y/{lang}.yml"), dotted.ctx)).toBe(0);
  expect(dotted.err.join("\n")).toContain(
    'corpus: y/pt.BR.yml names no language tag; left out: name its language, as languages: ["<tag>"] with languageFiles: { "<tag>": "pt.BR" } on the source',
  );
  // `{lang}` twice is the family's twice.
  const twice = project();
  for (const name of ["en", "de", "foo.de"])
    write(twice.dir, `l/${name}/${name}.yml`, yml(name));
  expect(await run(initFor("l/{lang}/{lang}.yml"), twice.ctx)).toBe(0);
  expect(twice.err.join("\n")).toContain("l/foo.{lang}/foo.{lang}.yml");
  const q = project();
  write(q.dir, "l/en.json", "{}\n");
  for (let i = 0; i < 30; i++) write(q.dir, `l/x${i}@foo.json`, "{}\n");
  expect(await run(initFor("l/{lang}.json"), q.ctx)).toBe(0);
  const lines = q.err.filter((l) => l.includes("names no language tag"));
  expect(lines).toHaveLength(5);
  expect(q.err).toContain(
    "corpus: and 25 more file(s) that name no language tag",
  );
});

test("init writes entries for a catalogue of entry objects, its text field and its note field, never reading each field as a string (#1026, #1001)", async () => {
  const p = project();
  mkdirSync(path.join(p.dir, "_locales", "en"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "_locales", "en", "messages.json"),
    JSON.stringify({
      smartling: { translate_paths: [{ path: "*/messageformat" }] },
      "icu:hello": { messageformat: "Hello", description: "A greeting" },
      "icu:bye": {
        messageformat: "Bye {name}",
        description: "Leaving",
        ignoreUnused: true,
      },
    }),
  );
  const args = [
    "init",
    "--project",
    "x",
    "--source",
    "en",
    "--messages",
    "_locales/{lang}/messages.json",
  ];
  expect(await run(args, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    adapter: "messages",
    entries: { text: "messageformat", note: "description" },
  });
  expect(p.err.join("\n")).toContain(
    "corpus: each value is an entry object: entries reads its text from messageformat and its note from description",
  );
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);
  expect(
    JSON.parse(readFileSync(path.join(p.dir, "s.json"), "utf8")).strings,
  ).toMatchObject([
    { id: "icu:hello", source: "Hello", note: "A greeting" },
    { id: "icu:bye", source: "Bye {name}", note: "Leaving" },
  ]);
  // One entry's stray key, as Signal's `descrption`, decides nothing.
  const stray = project();
  mkdirSync(path.join(stray.dir, "_locales", "en"), { recursive: true });
  writeFileSync(
    path.join(stray.dir, "_locales", "en", "messages.json"),
    JSON.stringify({
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => [
          `icu:s${i}`,
          { messageformat: `S${i}`, description: "d" },
        ]),
      ),
      "icu:hint": { messageformat: "Hint", descrption: "typo" },
    }),
  );
  expect(await run(args, stray.ctx)).toBe(0);
  expect((await loadConfig(stray.dir)).sources[0]).toMatchObject({
    entries: { text: "messageformat", note: "description" },
  });
  // FormatJS's transifex format: its own note field.
  const tx = project();
  mkdirSync(path.join(tx.dir, "_locales", "en"), { recursive: true });
  writeFileSync(
    path.join(tx.dir, "_locales", "en", "messages.json"),
    JSON.stringify({
      hello: { string: "Hello", developer_comment: "A greeting" },
      bye: { string: "Bye" },
    }),
  );
  expect(await run(args, tx.ctx)).toBe(0);
  expect((await loadConfig(tx.dir)).sources[0]).toMatchObject({
    entries: { text: "string", note: "developer_comment" },
  });
  // A nested catalogue of namespaces is no such file.
  const q = project();
  mkdirSync(path.join(q.dir, "locales"), { recursive: true });
  writeFileSync(
    path.join(q.dir, "locales", "en.json"),
    JSON.stringify({
      common: { string: "String", number: "Number" },
      types: { string: "Str" },
    }),
  );
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "locales/{lang}.json",
      ],
      q.ctx,
    ),
  ).toBe(0);
});

test("init writes formatjs where the package runs on a FormatJS runtime, and icu elsewhere (#1010)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ a: "Olá {name}", b: "Sem nada" }),
  );
  writeFileSync(
    path.join(p.dir, "package.json"),
    JSON.stringify({ name: "x", dependencies: { "react-intl": "^7.0.0" } }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "formatjs",
  });
  expect(p.out.join("\n")).toContain(
    "library: formatjs, from react-intl in package.json",
  );
  const q = project();
  stubCli(q.dir);
  mkdirSync(path.join(q.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(q.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ a: "Olá {name}" }),
  );
  writeFileSync(
    path.join(q.dir, "package.json"),
    JSON.stringify({ name: "x", dependencies: { "@angular/core": "^20.0.0" } }),
  );
  expect(await run(FLAGS, q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).not.toHaveProperty("library");
});

test("init's formatjs detection skips FormatJS's Intl polyfills, which i18next projects load too (#1010)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "src", "i18n", "pt-PT.json"),
    JSON.stringify({ a: "Olá {name}" }),
  );
  writeFileSync(
    path.join(p.dir, "package.json"),
    JSON.stringify({
      name: "x",
      dependencies: { "@formatjs/intl-durationformat": "^0.7.0" },
    }),
  );
  expect(await run(FLAGS, p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).not.toHaveProperty("library");
});

test("init's formatjs detection applies only where the catalogue would read as icu, and Lingui, which quotes otherwise, is lingui (#1010, #1154)", async () => {
  const write = (values: object, deps: object) => {
    const p = project();
    stubCli(p.dir);
    mkdirSync(path.join(p.dir, "src", "i18n"), { recursive: true });
    writeFileSync(
      path.join(p.dir, "src", "i18n", "pt-PT.json"),
      JSON.stringify(values),
    );
    writeFileSync(
      path.join(p.dir, "package.json"),
      JSON.stringify({ name: "x", dependencies: deps }),
    );
    return p;
  };
  const react = { "react-intl": "^7.0.0" };
  for (const [values, library] of [
    [{ a: "Olá %s", b: "%d itens", c: "%s e %s" }, "printf"],
    [{ a: "Olá %(name)s", b: "%(count)s itens" }, "counterpart"],
    [{ a: "um | dois", b: "{'@'} at" }, "vue"],
  ] as const) {
    const p = write(values, react);
    expect(await run(FLAGS, p.ctx)).toBe(0);
    expect((await loadConfig(p.dir)).sources[0]).toMatchObject({ library });
  }
  // Lingui quotes otherwise: its own reading (#1154).
  const lingui = write({ a: "Olá {name}" }, { "@lingui/core": "^5.0.0" });
  expect(await run(FLAGS, lingui.ctx)).toBe(0);
  expect((await loadConfig(lingui.dir)).sources[0]).toMatchObject({
    library: "lingui",
  });
  // Named beside a FormatJS runtime, Lingui's reading wins.
  const both = write(
    { a: "Olá {name}" },
    { "@lingui/core": "^5.0.0", "react-intl": "^7.0.0" },
  );
  expect(await run(FLAGS, both.ctx)).toBe(0);
  expect((await loadConfig(both.dir)).sources[0]).toMatchObject({
    library: "lingui",
  });
  const svelte = write({ a: "Olá {name}" }, { "svelte-i18n": "^4.0.0" });
  expect(await run(FLAGS, svelte.ctx)).toBe(0);
  expect((await loadConfig(svelte.dir)).sources[0]).toMatchObject({
    library: "formatjs",
  });
  // A package.json that is no object decides nothing.
  const bad = write({ a: "Olá {name}" }, {});
  writeFileSync(path.join(bad.dir, "package.json"), "null");
  expect(await run(FLAGS, bad.ctx)).toBe(0);
});

test("init with no source-language JSON, where every target holds one key set of sentences, writes a sourcePath with keyIsText: true (#999)", async () => {
  const p = project();
  const keys = ["Save changes", "{count} unread", "Log out"];
  write(
    p.dir,
    "locale/de/translations.json",
    JSON.stringify({
      "Save changes": "Änderungen speichern",
      "{count} unread": "{count} ungelesen",
      "Log out": "",
    }),
  );
  write(
    p.dir,
    "locale/fr/translations.json",
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, ""]))),
  );
  expect(await run(initFor("locale/{lang}/translations.json"), p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({
    adapter: "messages",
    path: "locale/{lang}/translations.json",
    sourcePath: "locale/de/translations.json",
    keyIsText: true,
  });
  expect(p.err.join("\n")).toContain(
    "corpus: no locale/en/translations.json, and the 2 target files hold one key set of sentences: sourcePath is locale/de/translations.json, with keyIsText: true reading its keys as the text",
  );
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);
  const snapshot = JSON.parse(readFileSync(path.join(p.dir, "s.json"), "utf8"));
  expect(snapshot.strings.map((s: { source: string }) => s.source)).toEqual(
    keys,
  );

  // Key sets that differ are no such catalogue.
  const q = project();
  write(
    q.dir,
    "locale/de/translations.json",
    JSON.stringify({ "Log out": "" }),
  );
  write(
    q.dir,
    "locale/fr/translations.json",
    JSON.stringify({ "Log out": "", "Save changes": "" }),
  );
  expect(await run(initFor("locale/{lang}/translations.json"), q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).not.toHaveProperty("keyIsText");

  // A file of the source's language under another code may be the
  // source itself: init stands aside, as it did before.
  const r = project();
  for (const [lang, text] of [
    ["en-US", "Sign out"],
    ["de", "Abmelden"],
    ["fr", "Déconnexion"],
  ])
    write(
      r.dir,
      `locales/${lang}.json`,
      JSON.stringify({ "Log out": text, "Save changes": "" }),
    );
  expect(await run(initFor("locales/{lang}.json"), r.ctx)).toBe(0);
  expect((await loadConfig(r.dir)).sources[0]).not.toHaveProperty("keyIsText");
  expect(r.err.join("\n")).toContain("no locales/en.json");
  // Ghost's empty-valued en/ beside a regional source language, too.
  const g = project();
  for (const lang of ["en", "de", "fr"])
    write(
      g.dir,
      `locales/${lang}/comments.json`,
      JSON.stringify({ "Log out": lang === "en" ? "" : `${lang} out` }),
    );
  expect(
    await run(initFor("locales/{lang}/comments.json", "en-US"), g.ctx),
  ).toBe(0);
  expect((await loadConfig(g.dir)).sources[0]).not.toHaveProperty("keyIsText");
  // An en-US whose values are all filled, most of them its keys, is a
  // natural-keys source, not a variant; init names it.
  const u = project();
  for (const [lang, values] of [
    ["en-US", ["Log out", "Save changes", "Colour"]],
    ["de", ["Abmelden", "", ""]],
    ["fr", ["", "", ""]],
  ] as const)
    write(
      u.dir,
      `locales/${lang}.json`,
      JSON.stringify({
        "Log out": values[0],
        "Save changes": values[1],
        "The color": values[2],
      }),
    );
  expect(await run(initFor("locales/{lang}.json"), u.ctx)).toBe(0);
  expect((await loadConfig(u.dir)).sources[0]).not.toHaveProperty("keyIsText");
  expect(u.err.join("\n")).toContain(
    "corpus: no locales/en.json; locales/en-US.json may be the source language's file under another code: pass --source en-US if so",
  );
  // A file no language's (#994's base.json), or one that does not read
  // as flat strings, is a reason to stand aside, never a target.
  for (const extra of [
    ["locales/base.json", JSON.stringify({ "Log out": "Sign out" })],
    ["locales/en-GB.json", JSON.stringify({ "Log out": { one: "x" } })],
    ["locales/en-GB.json", "{ not json"],
  ]) {
    const b = project();
    write(b.dir, "locales/de.json", JSON.stringify({ "Log out": "Abmelden" }));
    write(b.dir, "locales/fr.json", JSON.stringify({ "Log out": "" }));
    write(b.dir, extra[0]!, extra[1]!);
    await run(initFor("locales/{lang}.json"), b.ctx);
    const written = path.join(b.dir, "corpus.config.mjs");
    if (existsSync(written))
      expect(readFileSync(written, "utf8")).not.toContain("keyIsText");
  }
  // i18next's plural suffixes are forms whose English no key holds.
  const pl = project();
  for (const lang of ["de", "fr"])
    write(
      pl.dir,
      `locales/${lang}.json`,
      JSON.stringify({ "{count} month_one": "", "{count} month_other": "" }),
    );
  expect(await run(initFor("locales/{lang}.json"), pl.ctx)).toBe(0);
  expect(pl.err.join("\n")).toContain(
    "the targets' keys carry plural suffixes (_one, _other), whose English no key holds",
  );
  expect(
    readFileSync(path.join(pl.dir, "corpus.config.mjs"), "utf8"),
  ).not.toContain("keyIsText");
  // A file named for no language is named.
  const nb = project();
  write(nb.dir, "locales/de.json", JSON.stringify({ "Log out": "Abmelden" }));
  write(nb.dir, "locales/fr.json", JSON.stringify({ "Log out": "" }));
  write(nb.dir, "locales/base.json", JSON.stringify({ "Log out": "Sign out" }));
  await run(initFor("locales/{lang}.json"), nb.ctx);
  expect(nb.err.join("\n")).toContain(
    "corpus: no locales/en.json; locales/base.json names no language",
  );
  // Another script of the source's language is a target.
  const zh = project();
  for (const [lang, text] of [
    ["zh_Hant", "登出"],
    ["de", "Abmelden"],
  ])
    write(
      zh.dir,
      `locales/${lang}.json`,
      JSON.stringify({ "Log out": text, "Save changes": "" }),
    );
  expect(await run(initFor("locales/{lang}.json", "zh-Hans"), zh.ctx)).toBe(0);
  expect((await loadConfig(zh.dir)).sources[0]).toMatchObject({
    keyIsText: true,
  });
  // A variant whose values are mostly its keys, Zulip's en_GB, is a
  // target, never the one chosen.
  const z = project();
  for (const [lang, values] of [
    ["en_GB", ["Log out", "Save changes", ""]],
    ["de", ["Abmelden", "", ""]],
    ["fr", ["", "", ""]],
  ] as const)
    write(
      z.dir,
      `locale/${lang}/translations.json`,
      JSON.stringify({
        "Log out": values[0],
        "Save changes": values[1],
        "The color": values[2],
      }),
    );
  expect(await run(initFor("locale/{lang}/translations.json"), z.ctx)).toBe(0);
  expect((await loadConfig(z.dir)).sources[0]).toMatchObject({
    sourcePath: "locale/de/translations.json",
    keyIsText: true,
  });
  expect(z.err.join("\n")).not.toContain("source values are empty");
});

test("init detects the library from an entry object's text field (#1001)", async () => {
  const p = project();
  mkdirSync(path.join(p.dir, "locales"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "locales", "en.json"),
    JSON.stringify({
      hello: { defaultMessage: "Hello {{name}}", description: "A greeting" },
      bye: { defaultMessage: "Bye {{name}}", description: "Leaving" },
    }),
  );
  expect(await run(initFor("locales/{lang}.json"), p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "i18next",
    entries: { text: "defaultMessage", note: "description" },
  });
});

test("FormatJS's crowdin format, { message, description } with ICU text, is entries, not Chrome's (#1001)", async () => {
  const p = project();
  mkdirSync(path.join(p.dir, "lang"), { recursive: true });
  writeFileSync(
    path.join(p.dir, "lang", "en.json"),
    JSON.stringify({
      greeting: { message: "Hello {name}", description: "A greeting" },
      chats: {
        message: "{count, plural, one {# chat} other {# chats}}",
        description: "Count",
      },
    }),
  );
  expect(await run(initFor("lang/{lang}.json"), p.ctx)).toBe(0);
  const source = (await loadConfig(p.dir)).sources[0];
  expect(source).toMatchObject({
    entries: { text: "message", note: "description" },
  });
  expect(source).not.toMatchObject({ library: "chrome" });
  // uBlock's Chrome catalogue, `{{count}}` and no placeholders, stays
  // chrome: a bare `{name}` is no ICU argument.
  const u = project();
  mkdirSync(path.join(u.dir, "_locales", "en"), { recursive: true });
  writeFileSync(
    path.join(u.dir, "_locales", "en", "messages.json"),
    JSON.stringify({
      blocked: { message: "{{count}} blocked", description: "Badge" },
      open: { message: "Open {url}", description: "Link" },
    }),
  );
  expect(await run(initFor("_locales/{lang}/messages.json"), u.ctx)).toBe(0);
  expect((await loadConfig(u.dir)).sources[0]).toMatchObject({
    library: "chrome",
  });
  // Chrome's own, with $NAME$ and placeholders, stays chrome.
  const c = project();
  mkdirSync(path.join(c.dir, "_locales", "en"), { recursive: true });
  writeFileSync(
    path.join(c.dir, "_locales", "en", "messages.json"),
    JSON.stringify({
      greeting: {
        message: "Hello $NAME$",
        placeholders: { name: { content: "$1" } },
      },
      plain: { message: "Save" },
    }),
  );
  expect(await run(initFor("_locales/{lang}/messages.json"), c.ctx)).toBe(0);
  expect((await loadConfig(c.dir)).sources[0]).toMatchObject({
    library: "chrome",
  });
});

test("init writes a strings source for Apple's Localizable.strings, its languages read from the .lproj directories (#1037)", async () => {
  const p = project();
  for (const lang of ["en", "de", "en-GB", "zh-Hans", "Base"])
    write(p.dir, `App/${lang}.lproj/Localizable.strings`, `"CPU" = "CPU";\n`);
  expect(
    await run(initFor("App/{lang}.lproj/Localizable.strings"), p.ctx),
  ).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.sources[0]).toMatchObject({
    adapter: "strings",
    path: "App/{lang}.lproj/Localizable.strings",
  });
  expect(config.languages).toEqual(["en", "de", "en-GB", "zh-Hans"]);
  expect(config.sourceVariants).toEqual(["en-GB"]);
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);
});

test("init writes library gen_l10n for an .arb catalogue, Flutter's gen-l10n, and says use-escaping is not read (#1038)", async () => {
  const p = project();
  write(
    p.dir,
    "lib/l10n/app_en.arb",
    JSON.stringify({
      "@@locale": "en",
      weeks: "{count, plural, one{{count} week} other{{count} weeks}}",
    }),
  );
  write(p.dir, "lib/l10n/app_de.arb", JSON.stringify({ "@@locale": "de" }));
  expect(await run(initFor("lib/l10n/app_{lang}.arb"), p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "gen_l10n",
  });
  expect(p.out.join("\n")).toContain("library: gen_l10n");
  // --library still decides.
  const q = project();
  write(q.dir, "lib/l10n/app_en.arb", JSON.stringify({ hi: "Hi" }));
  expect(
    await run(
      [...initFor("lib/l10n/app_{lang}.arb"), "--library", "icu"],
      q.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).not.toMatchObject({
    library: "gen_l10n",
  });
  // use-escaping is gen-l10n's apostrophe quoting, which Corpus reads as text.
  const e = project();
  write(e.dir, "lib/l10n/app_en.arb", JSON.stringify({ hi: "Hi" }));
  write(e.dir, "l10n.yaml", "arb-dir: lib/l10n\nuse-escaping: true\n");
  expect(await run(initFor("lib/l10n/app_{lang}.arb"), e.ctx)).toBe(0);
  expect(e.out.join("\n")).toContain(
    "l10n.yaml sets use-escaping: true, gen-l10n's apostrophe quoting, which Corpus does not read",
  );
});

test("init writes library fmt for a gettext catalogue whose placeholders are libfmt fields, and leaves printf where verbs are (#1002)", async () => {
  const p = project();
  write(
    p.dir,
    "po/messages.pot",
    po("2025-01-01 10:00+0000", [
      "_Show {count:L} of:",
      "Error: {errmsg}",
      "Couldn't read '{path}': {error} ({error_code})",
      "Quit",
    ]),
  );
  write(p.dir, "po/de.po", po("2025-01-01 10:00+0000", ["Quit"]));
  expect(await run(initFor("po/{lang}.po"), p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    adapter: "gettext",
    library: "fmt",
  });
  expect(p.out.join("\n")).toContain("library: fmt");
  const q = project();
  write(
    q.dir,
    "po/messages.pot",
    po("2025-01-01 10:00+0000", ["%d files", "Error: %s", "Quit"]),
  );
  write(q.dir, "po/de.po", po("2025-01-01 10:00+0000", ["Quit"]));
  expect(await run(initFor("po/{lang}.po"), q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).not.toMatchObject({
    library: "fmt",
  });
});

test("init leaves printf where Python's %(name)s outnumbers the fields, and a C# {0} catalogue is no fmt (#1002)", async () => {
  for (const ids of [
    [
      "%(count)s documents",
      "%(name)s saved",
      "%(n)d items",
      "Hello {name}",
      "Bye {name}",
    ],
    ["{0} files", "{0,-10} name", "{1} of {0}"],
    ["Hello {{user}}", "{{count}} items", "Bye {{user}}"],
  ]) {
    const p = project();
    write(p.dir, "po/messages.pot", po("2025-01-01 10:00+0000", ids));
    write(p.dir, "po/de.po", po("2025-01-01 10:00+0000", ["Quit"]));
    expect(await run(initFor("po/{lang}.po"), p.ctx)).toBe(0);
    expect((await loadConfig(p.dir)).sources[0]).not.toMatchObject({
      library: "fmt",
    });
  }
});

test("init writes placeholders where a catalogue layers a second syntax: uBlock's {{name}} on chrome, sprintf's %s on i18next (#1049)", async () => {
  const p = project();
  write(
    p.dir,
    "_locales/en/messages.json",
    JSON.stringify({
      stats: { message: "{{used}} used out of {{total}}" },
      err: { message: "Cannot connect to {{msg}}" },
      hello: {
        message: "Hello $USER$",
        placeholders: { user: { content: "$1" } },
      },
    }),
  );
  expect(await run(initFor("_locales/{lang}/messages.json"), p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    library: "chrome",
    placeholders: ["i18next"],
  });
  expect(p.out.join("\n")).toContain("placeholders: i18next");
  const q = project();
  write(
    q.dir,
    "i18n/en.json",
    JSON.stringify({
      a: "Hi {{name}}",
      b: "Bye {{name}}",
      c: "{{count}} new",
      push: "Your push was sent to %s devices",
      restart: "Restart in %s seconds",
    }),
  );
  expect(await run(initFor("i18n/{lang}.json"), q.ctx)).toBe(0);
  expect((await loadConfig(q.dir)).sources[0]).toMatchObject({
    library: "i18next",
    placeholders: ["printf"],
  });
});

test("init maps a country code a file is named by to its language, and warns where a language code's file is in another script (#697)", async () => {
  const write = (
    dir: string,
    files: Record<string, Record<string, string>>,
  ) => {
    mkdirSync(path.join(dir, "l"), { recursive: true });
    for (const [code, values] of Object.entries(files))
      writeFileSync(
        path.join(dir, "l", `${code}.json`),
        JSON.stringify(values, null, 2) + "\n",
      );
  };
  const base = ["init", "--project", "x", "--source", "en", "--messages"];
  // Hoppscotch's cn.json and tw.json: Simplified and Traditional Chinese.
  const p = project();
  stubCli(p.dir);
  write(p.dir, {
    en: { autoscroll: "Autoscroll", copy: "Copy {name}" },
    cn: { autoscroll: "自动滚动", copy: "复制 {name}" },
    tw: { autoscroll: "自動捲動", copy: "複製 {name}" },
    de: { autoscroll: "Automatisch scrollen", copy: "{name} kopieren" },
  });
  expect(await run([...base, "l/{lang}.json"], p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "tw", "zh-CN"]);
  expect(config.sources[0]?.languageFiles).toEqual({ "zh-CN": "cn" });
  const err = p.err.join("\n");
  expect(err).toContain(
    'l/cn.json: written as zh-CN, languageFiles: { "zh-CN": "cn" }',
  );
  expect(err).toContain(
    'l/tw.json: tw is Akan (Latn), but its text is Han; if it is Chinese (Taiwan), list zh-TW and map it: languageFiles: { "zh-TW": "tw" }',
  );
  expect(err).not.toContain("cn is not a language tag");
  // build reads cn.json as zh-CN.
  const report = await buildSnapshotReport(config, p.dir);
  expect(report.snapshot.seedTranslations?.["zh-CN"]).toEqual({
    autoscroll: "自动滚动",
    copy: "复制 {name}",
  });

  // A tw.json in Latin script is Twi: no warning. jp is Japanese; de,
  // pt-br and sr@latin are read as before.
  const q = project();
  stubCli(q.dir);
  write(q.dir, {
    en: { a: "Yes" },
    tw: { a: "Aane" },
    jp: { a: "はい" },
    de: { a: "Ja" },
    "pt-br": { a: "Sim" },
    "sr@latin": { a: "Da" },
  });
  expect(await run([...base, "l/{lang}.json"], q.ctx)).toBe(0);
  const plain = await loadConfig(q.dir);
  expect(plain.languages).toEqual(["en", "de", "ja", "pt-br", "sr-Latn", "tw"]);
  expect(plain.sources[0]?.languageFiles).toEqual({
    ja: "jp",
    "sr-Latn": "sr@latin",
  });
  expect(q.err.join("\n")).not.toContain("tw is");
  expect(q.err.join("\n")).toContain(
    'l/jp.json: written as ja, languageFiles: { "ja": "jp" }',
  );

  // kr in Hangul names Korean; in another script it names none.
  const r = project();
  stubCli(r.dir);
  write(r.dir, { en: { a: "Yes" }, kr: { a: "예" }, tw: { a: "Да" } });
  expect(await run([...base, "l/{lang}.json"], r.ctx)).toBe(0);
  expect(r.err.join("\n")).toContain(
    'l/kr.json: kr is Kanuri (Latn), but its text is Hangul; if it is Korean, list ko and map it: languageFiles: { "ko": "kr" }',
  );
  expect(r.err.join("\n")).toContain(
    "l/tw.json: tw is Akan (Latn), but its text is Cyrillic; check which language it holds",
  );

  // A country code beside its language's own file is left as it is, and
  // --languages keeps a mapping it lists.
  const s = project();
  stubCli(s.dir);
  write(s.dir, {
    en: { a: "Yes" },
    cn: { a: "是" },
    "zh-CN": { a: "是" },
    cz: { a: "Ano" },
  });
  expect(
    await run([...base, "l/{lang}.json", "--languages", "en,cs,zh-CN"], s.ctx),
  ).toBe(0);
  expect((await loadConfig(s.dir)).sources[0]?.languageFiles).toEqual({
    cs: "cz",
  });
  expect(s.err.join("\n")).not.toContain("l/cn.json: written as");

  // A source language named so is the one --source gives, as written.
  const t = project();
  stubCli(t.dir);
  write(t.dir, { en: { a: "Yes" }, cn: { a: "是" } });
  expect(
    await run(
      [...base.slice(0, 3), "--source", "cn", "--messages", "l/{lang}.json"],
      t.ctx,
    ),
  ).toBe(0);
  const own = await loadConfig(t.dir);
  expect([own.sourceLanguage, own.languages]).toEqual(["cn", ["cn", "en"]]);
  expect(own.sources[0]?.languageFiles).toBeUndefined();
  expect(t.err.join("\n")).not.toContain("written as");
});

test("init reads a catalogue of 200,000 keys: no spread overflows the stack (#1276)", async () => {
  const p = project();
  stubCli(p.dir);
  mkdirSync(path.join(p.dir, "l"));
  writeFileSync(
    path.join(p.dir, "l", "en.json"),
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 200_000 }, (_, i) => [
          `k${i}`,
          `Hello {name} ${i}`,
        ]),
      ),
    ),
  );
  writeFileSync(
    path.join(p.dir, "l", "de.json"),
    JSON.stringify({ k0: "Hallo {name} 0" }),
  );
  expect(
    await run(
      [
        "init",
        "--project",
        "x",
        "--source",
        "en",
        "--messages",
        "l/{lang}.json",
      ],
      p.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en", "de"]);
  // Every file is read: none is named as one that does not read.
  expect([...p.out, ...p.err].join("\n")).not.toMatch(
    /not read|not detected|call stack/,
  );
}, 120_000);

test("init maps the source language to Pontoon's templates directory, where l10n.toml's reference says its files sit (#1097)", async () => {
  const anki = (p: ReturnType<typeof project>) => {
    write(p.dir, "core/templates/a.ftl", "x = X\n");
    write(p.dir, "core/templates/b.ftl", "y = Y\n");
    for (const lang of ["de", "fr"]) {
      write(p.dir, `core/${lang}/a.ftl`, "x = X\n");
      write(p.dir, `core/${lang}/b.ftl`, "y = Y\n");
    }
  };
  const p = project();
  anki(p);
  write(
    p.dir,
    "l10n.toml",
    'basepath = "core"\n\n[[paths]]\n  reference = "templates/*.ftl"\n  l10n = "{locale}/*.ftl"\n',
  );
  expect(await run(initFor("core/{lang}/{ns}.ftl"), p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual(["en", "de", "fr"]);
  expect(config.sources[0]).toMatchObject({
    adapter: "fluent",
    languageFiles: { en: "templates" },
  });
  const said = p.err.join("\n");
  expect(said).toContain(
    'core/templates holds en\'s files, as l10n.toml\'s reference says: languageFiles: { "en": "templates" }',
  );
  expect(said).not.toMatch(/no core\/en\/\{ns\}\.ftl/);
  expect(await run(["build", "--out", "s.json"], p.ctx)).toBe(0);

  // A fixed name reads the same reference.
  const fixed = project();
  anki(fixed);
  write(
    fixed.dir,
    "l10n.toml",
    'basepath = "core"\n[[paths]]\nreference = "templates/*.ftl"\nl10n = "{locale}/*.ftl"\n',
  );
  expect(await run(initFor("core/{lang}/a.ftl"), fixed.ctx)).toBe(0);
  expect((await loadConfig(fixed.dir)).sources[0]).toMatchObject({
    languageFiles: { en: "templates" },
  });
  expect(fixed.err.join("\n")).not.toMatch(/names no language tag/);
  expect(await run(["build", "--out", "s.json"], fixed.ctx)).toBe(0);

  // Without l10n.toml the one code that names no language is said as the
  // source's mapping, and nothing is written.
  const bare = project();
  anki(bare);
  expect(await run(initFor("core/{lang}/a.ftl"), bare.ctx)).toBe(0);
  expect((await loadConfig(bare.dir)).sources[0]).not.toHaveProperty(
    "languageFiles",
  );
  const bareSaid = bare.err.join("\n");
  expect(bareSaid).toContain(
    'core/templates/a.ftl names no language tag; left out: if it is en\'s file, map it: languageFiles: { "en": "templates" }',
  );
  expect(bareSaid).not.toMatch(/languages: \["<tag>"\]/);

  // A reference the source fills itself (Relay's en/banner.ftl) maps nothing.
  const relay = project();
  write(relay.dir, "en/banner.ftl", "x = X\n");
  write(relay.dir, "de/banner.ftl", "x = X\n");
  write(
    relay.dir,
    "l10n.toml",
    'basepath = "."\n[[paths]]\n    reference = "en/banner.ftl"\n    l10n = "{locale}/banner.ftl"\n',
  );
  expect(await run(initFor("{lang}/banner.ftl"), relay.ctx)).toBe(0);
  expect((await loadConfig(relay.dir)).sources[0]).not.toHaveProperty(
    "languageFiles",
  );
});

test("init names the source language's mapping only for a code that names no language, beside no source file it found (#1097)", async () => {
  // A POSIX modifier is a language's file, not the source's.
  const euro = project();
  write(euro.dir, "locales/de.json", '{"a":"A"}');
  write(euro.dir, "locales/fr.json", '{"a":"A"}');
  write(euro.dir, "locales/de@euro.json", '{"a":"A"}');
  await run(initFor("locales/{lang}.json"), euro.ctx);
  expect(euro.err.join("\n")).toContain(
    "locales/de@euro.json names no language tag; left out: name its language",
  );
  expect(euro.err.join("\n")).not.toContain("map it:");

  // gettext's template is the source init found.
  const pot = project();
  write(pot.dir, "po/app.pot", 'msgid ""\nmsgstr ""\n\nmsgid "A"\nmsgstr ""\n');
  for (const code of ["de", "fr", "en@quot"])
    write(
      pot.dir,
      `po/${code}.po`,
      'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "A"\nmsgstr "A"\n',
    );
  expect(await run(initFor("po/{lang}.po"), pot.ctx)).toBe(0);
  expect(pot.err.join("\n")).not.toContain("map it:");

  // A reference that is a language's own directory maps nothing.
  const relay = project();
  write(relay.dir, "en/banner.ftl", "x = X\n");
  write(relay.dir, "de/banner.ftl", "x = X\n");
  write(
    relay.dir,
    "l10n.toml",
    'basepath = "."\n[[paths]]\n    reference = "en/banner.ftl"\n    l10n = "{locale}/banner.ftl"\n',
  );
  expect(await run(initFor("{lang}/{ns}.ftl", "en-US"), relay.ctx)).toBe(1);
  expect(relay.err.join("\n")).not.toContain("holds en-US's files");

  // A {ns} pattern without l10n.toml names the mapping as well.
  const ns = project();
  write(ns.dir, "core/templates/a.ftl", "x = X\n");
  write(ns.dir, "core/de/a.ftl", "x = X\n");
  write(ns.dir, "core/fr/a.ftl", "x = X\n");
  await run(initFor("core/{lang}/{ns}.ftl"), ns.ctx);
  expect(
    ns.err.filter((line) => line.includes("core/templates names no")),
  ).toHaveLength(1);
  expect(ns.err.join("\n")).toContain(
    'core/templates names no language tag; left out: if it is en\'s file, map it: languageFiles: { "en": "templates" }',
  );
});

test("init writes be@tarask, sr@ijekavian and sr@ijekavianlatin as their tags, and a POSIX code --languages lists as its tag (#1119)", async () => {
  const p = project();
  write(p.dir, "l/en.json", '{ "hi": "Hi" }\n');
  for (const code of ["be@tarask", "sr@ijekavian", "sr@ijekavianlatin"])
    write(p.dir, `l/${code}.json`, '{ "hi": "Hi" }\n');
  expect(await run(initFor("l/{lang}.json"), p.ctx)).toBe(0);
  const config = await loadConfig(p.dir);
  expect(config.languages).toEqual([
    "en",
    "be-tarask",
    "sr-Latn-ijekavsk",
    "sr-ijekavsk",
  ]);
  expect(config.sources[0]).toMatchObject({
    languageFiles: {
      "be-tarask": "be@tarask",
      "sr-ijekavsk": "sr@ijekavian",
      "sr-Latn-ijekavsk": "sr@ijekavianlatin",
    },
  });
  expect(p.err.join("\n")).not.toMatch(/left out/);

  const listed = project();
  write(
    listed.dir,
    "po/en.po",
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hi"\nmsgstr "Hi"\n',
  );
  write(
    listed.dir,
    "po/ca@valencia.po",
    'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hi"\nmsgstr "Hola"\n',
  );
  expect(
    await run(
      [...initFor("po/{lang}.po"), "--languages", "en,ca@valencia"],
      listed.ctx,
    ),
  ).toBe(0);
  const written = await loadConfig(listed.dir);
  expect(written.languages).toEqual(["en", "ca-valencia"]);
  expect(written.sources[0]).toMatchObject({
    languageFiles: { "ca-valencia": "ca@valencia" },
  });
  expect(listed.err.join("\n")).not.toMatch(
    /not a language tag the runtime knows/,
  );
});

test("a POSIX code --languages lists maps no file another spelling of its tag already holds, and an android source takes its tag alone (#1119 review)", async () => {
  // qBittorrent's uz@Latn beside sr@latin: the file there is the mapping.
  const qt = (language: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="${language}">\n<context>\n    <name>Main</name>\n    <message>\n        <source>Hi</source>\n        <translation>Hi</translation>\n    </message>\n</context>\n</TS>\n`;
  const p = project();
  write(p.dir, "lang/app_en.ts", qt("en"));
  write(p.dir, "lang/app_sr@latin.ts", qt("sr@latin"));
  write(p.dir, "lang/app_uz@Latn.ts", qt("uz@Latn"));
  expect(
    await run(
      [...initFor("lang/app_{lang}.ts"), "--languages", "en,uz@latin"],
      p.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(p.dir)).sources[0]).toMatchObject({
    languageFiles: { "uz-Latn": "uz@Latn" },
  });
  // A file named by the tag itself takes no mapping.
  const tagged = project();
  write(tagged.dir, "l/en.json", '{ "hi": "Hi" }\n');
  write(tagged.dir, "l/sr-Latn.json", '{ "hi": "Zdravo" }\n');
  expect(
    await run(
      [...initFor("l/{lang}.json"), "--languages", "en,sr@latin"],
      tagged.ctx,
    ),
  ).toBe(0);
  const taggedConfig = await loadConfig(tagged.dir);
  expect(taggedConfig.languages).toEqual(["en", "sr-Latn"]);
  expect(taggedConfig.sources[0]).not.toHaveProperty("languageFiles");
  // A {ns} pattern's directory is its file's spelling.
  const ns = project();
  write(ns.dir, "l/en/a.json", '{ "hi": "Hi" }\n');
  write(ns.dir, "l/uz@Latn/a.json", '{ "hi": "Salom" }\n');
  expect(
    await run(
      [...initFor("l/{lang}/{ns}.json"), "--languages", "en,uz@latin"],
      ns.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(ns.dir)).sources[0]).toMatchObject({
    languageFiles: { "uz-Latn": "uz@Latn" },
  });
  // No file at all: the listed spelling is the one a new file takes.
  const none = project();
  write(none.dir, "l/en.json", '{ "hi": "Hi" }\n');
  expect(
    await run(
      [...initFor("l/{lang}.json"), "--languages", "en,sr@latin"],
      none.ctx,
    ),
  ).toBe(0);
  expect((await loadConfig(none.dir)).sources[0]).toMatchObject({
    languageFiles: { "sr-Latn": "sr@latin" },
  });
  // An android res directory names its own; it takes no languageFiles.
  const strings = (text: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="hi">${text}</string>\n</resources>\n`;
  const android = project();
  write(android.dir, "res/values/strings.xml", strings("Hi"));
  write(android.dir, "res/values-b+sr+Latn/strings.xml", strings("Zdravo"));
  expect(
    await run([...initFor("res"), "--languages", "en,sr@latin"], android.ctx),
  ).toBe(0);
  const config = await loadConfig(android.dir);
  expect(config.languages).toEqual(["en", "sr-Latn"]);
  expect(config.sources[0]).not.toHaveProperty("languageFiles");
});

test("init reads a b+ values directory's variant as a variant: values-b+ca+valencia is ca-valencia (#1120)", async () => {
  const strings = (text: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n  <string name="hi">${text}</string>\n</resources>\n`;
  const p = project();
  write(p.dir, "res/values/strings.xml", strings("Hi"));
  write(p.dir, "res/values-b+ca+valencia/strings.xml", strings("Hola"));
  expect(await run(initFor("res"), p.ctx)).toBe(0);
  expect((await loadConfig(p.dir)).languages).toEqual(["en", "ca-valencia"]);
  expect(p.err.join("\n")).not.toMatch(/left out/);
});

test("check.include takes a SvelteKit package's src, its routes included, for a components directory inside it (#1139)", async () => {
  const immich = (svelte: boolean) => {
    const p = project();
    write(p.dir, "i18n/en.json", '{ "hi": "Hi" }\n');
    write(p.dir, "i18n/de.json", '{ "hi": "Hallo" }\n');
    write(p.dir, "web/package.json", '{ "name": "web" }\n');
    if (svelte) write(p.dir, "web/svelte.config.js", "export default {};\n");
    write(p.dir, "web/src/lib/components/A.svelte", "<p>{$t('hi')}</p>\n");
    write(p.dir, "web/src/lib/modals/B.svelte", "<p>{$t('hi')}</p>\n");
    write(p.dir, "web/src/routes/+page.svelte", "<p>{$t('hi')}</p>\n");
    return p;
  };
  const sveltekit = immich(true);
  expect(await run(initFor("i18n/{lang}.json"), sveltekit.ctx)).toBe(0);
  expect((await loadConfig(sveltekit.dir)).check?.include).toEqual(["web/src"]);
  // Two components directories in one src are that src once.
  write(sveltekit.dir, "web/src/routes/components/C.svelte", "<p>C</p>\n");
  rmSync(path.join(sveltekit.dir, "corpus.config.mjs"), { force: true });
  rmSync(path.join(sveltekit.dir, "corpus.config.ts"), { force: true });
  expect(await run(initFor("i18n/{lang}.json"), sveltekit.ctx)).toBe(0);
  expect((await loadConfig(sveltekit.dir)).check?.include).toEqual(["web/src"]);
  const plain = immich(false);
  expect(await run(initFor("i18n/{lang}.json"), plain.ctx)).toBe(0);
  expect((await loadConfig(plain.dir)).check?.include).toEqual([
    "web/src/lib/components",
  ]);
});
