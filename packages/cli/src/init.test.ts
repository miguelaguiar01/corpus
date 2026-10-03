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
    "check.include: init found no .jsx, .tsx, .vue or .svelte components where it looks; set check.include in corpus.config.ts to where they are, or, if the UI is written in something else (C, GTK, Angular, Handlebars, templates), corpus check does not apply: leave it out of CI",
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
    "corpus check reads .jsx, .tsx, .vue and .svelte components, which a Qt interface has none of: leave corpus check out of CI",
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
    "corpus check reads .jsx, .tsx, .vue and .svelte components, which an Android app has none of: leave corpus check out of CI",
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
    /init found no \.jsx, \.tsx, \.vue or \.svelte components where it looks; set check\.include .* or, if the UI is written in something else .*, corpus check does not apply/,
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
  // Hoppscotch: packages/hoppscotch-common/src/components.
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
    "corpus: no loc/en/messages.en.xlf; set the xliff source's sourcePath to the file Angular extracts",
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

test("init names exec for a catalogue of entry objects, never writing a config that reads each field as a string (#1026)", async () => {
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
  expect(await run(args, p.ctx)).toBe(1);
  expect(p.err.join("\n")).toContain(
    "--messages _locales/{lang}/messages.json: each value is an entry object with its text in messageformat, which the messages source would read as a string per field; an exec source converts it",
  );
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
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
  expect(await run(args, stray.ctx)).toBe(1);
  expect(stray.err.join("\n")).toContain("an exec source converts it");
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
