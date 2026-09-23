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
    type: "chrome",
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
    JSON.stringify({ a: "Olá {{ name }}", b: { c: "Sem nada" } }),
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
