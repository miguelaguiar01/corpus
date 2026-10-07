import {
  cpSync,
  existsSync,
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

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/pull-repo", import.meta.url),
);
const TMP = fileURLToPath(new URL("../test/.tmp", import.meta.url));

const PAYLOAD = {
  contract: "corpus/1",
  project: "pull-fixture",
  sourceLanguage: "en",
  minState: "verified",
  types: { "app.title": "chrome", greeting: "chrome", "exec.bye": "computed" },
  translations: {
    en: {
      "app.title": "Corpus",
      greeting: "Hello {name}",
      "exec.bye": "Bye {who}",
    },
    pt: {
      "app.title": "Corpus",
      greeting: "Olá {name}",
      "exec.bye": "Adeus {who}",
    },
  },
};

type Captured = { url: string; auth: string | undefined };

function startServer(
  respond: (captured: Captured) => { status: number; json: unknown },
): Promise<{ server: Server; url: string; calls: Captured[] }> {
  const calls: Captured[] = [];
  const server = createServer((req, res) => {
    const captured = { url: req.url ?? "", auth: req.headers.authorization };
    calls.push(captured);
    const { status, json } = respond(captured);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

let active: Server | undefined;
let repo: string;
beforeEach(() => {
  // Inside the repo tree so the config's `@corpus/contract` import resolves.
  mkdirSync(TMP, { recursive: true });
  repo = mkdtempSync(path.join(TMP, "pull-"));
  cpSync(FIXTURE, repo, { recursive: true });
});
afterEach(() => {
  active?.close();
  active = undefined;
  delete process.env.CORPUS_SERVER;
  rmSync(repo, { recursive: true, force: true });
});

function ctx(): RunContext & { output: string[] } {
  const output: string[] = [];
  return {
    cwd: repo,
    env: { CORPUS_TOKEN: "good" },
    out: (s) => output.push(s),
    err: (s) => output.push(s),
    output,
  };
}

async function serve(status = 200, json: unknown = PAYLOAD) {
  const started = await startServer(() => ({ status, json }));
  active = started.server;
  process.env.CORPUS_SERVER = started.url;
  return started;
}

const read = (rel: string) => readFileSync(path.join(repo, rel), "utf8");

test("pull fetches at verified by default with the bearer token and writes the target catalog", async () => {
  const { calls } = await serve();
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(calls[0]?.url).toBe("/api/pull?minState=verified");
  expect(calls[0]?.auth).toBe("Bearer good");
  expect(read("i18n/pt.json")).toBe(
    `{\n  "app.title": "Corpus",\n  "greeting": "Olá {name}"\n}\n`,
  );
});

test("the source-language file is untouched and not reported when nothing changed", async () => {
  await serve();
  const before = read("i18n/en.json");
  const c = ctx();
  await run(["pull"], c);
  expect(read("i18n/en.json")).toBe(before);
  const out = c.output.join("\n");
  expect(out).toContain("i18n/pt.json");
  expect(out).not.toContain("i18n/en.json");
});

test("--min-state is passed through", async () => {
  const { calls } = await serve(200, { ...PAYLOAD, minState: "translated" });
  await run(["pull", "--min-state", "translated"], ctx());
  expect(calls[0]?.url).toBe("/api/pull?minState=translated");
});

test("an existing target file keeps keys the payload does not mention", async () => {
  await serve(200, {
    ...PAYLOAD,
    translations: {
      en: PAYLOAD.translations.en,
      pt: { greeting: "Olá {name}" },
    },
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "i18n/pt.json"),
    `{\n  "app.title": "Corpo"\n}\n`,
  );
  await run(["pull"], ctx());
  expect(JSON.parse(read("i18n/pt.json"))).toEqual({
    "app.title": "Corpo",
    greeting: "Olá {name}",
  });
});

test("exec sources receive the entries the file adapters did not claim, on stdin", async () => {
  await serve();
  await run(["pull"], ctx());
  const imported = JSON.parse(read("imported.json")) as {
    sourceLanguage: string;
    translations: Record<string, Record<string, string>>;
  };
  expect(imported.sourceLanguage).toBe("en");
  expect(imported.translations.pt).toEqual({ "exec.bye": "Adeus {who}" });
  // The source language's text belongs to the repository; it is not sent.
  expect(imported.translations.en).toBeUndefined();
});

test("what an import command says is printed under its ran line, and the summary counts it (#599)", async () => {
  await serve();
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  const out = c.output;
  const at = out.indexOf("ran node scripts/import.mjs");
  expect(at).toBeGreaterThanOrEqual(0);
  expect(out[at + 1]).toBe("  import: wrote imported.json");
  expect(out.at(-1)).toBe(
    "pulled pull-fixture at verified: 2 file(s) changed, 1 import command(s) ran",
  );
  // A silent importer prints nothing more than its ran line.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "scripts/import.mjs"),
    "process.stdin.resume();\n",
  );
  const quiet = ctx();
  expect(await run(["pull"], quiet)).toBe(0);
  const q = quiet.output.indexOf("ran node scripts/import.mjs");
  expect(quiet.output[q + 1]).toMatch(/^pulled pull-fixture/);
});

test("a 401 prints an actionable message", async () => {
  await serve(401, { error: "unauthorized" });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN/);
  expect(existsSync(path.join(repo, "i18n/pt.json"))).toBe(false);
});

test("a payload that does not match the contract is refused before any write", async () => {
  await serve(200, { contract: "corpus/2" });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/contract/i);
  expect(existsSync(path.join(repo, "i18n/pt.json"))).toBe(false);
});

test("the server being unreachable is a clean error", async () => {
  process.env.CORPUS_SERVER = "http://127.0.0.1:1";
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/could not reach the server/);
});

test("a table source with {lang} is written per language, one record per line", async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(repo, "data"), { recursive: true });
  writeFileSync(
    path.join(repo, "data/steps.en.json"),
    `[\n  { "id": "step.1", "text": "Open the door.", "kind": "hint" }\n]\n`,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      "sources: [",
      'sources: [\n    { adapter: "table", type: "step", path: "data/steps.{lang}.json", map: { id: "id", text: "text" } },',
    ),
  );
  await serve(200, {
    ...PAYLOAD,
    types: { ...PAYLOAD.types, "step.1": "step" },
    translations: {
      en: { ...PAYLOAD.translations.en, "step.1": "Open the door." },
      pt: { ...PAYLOAD.translations.pt, "step.1": "Abre a porta." },
    },
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(read("data/steps.pt.json")).toBe(
    `[\n  { "id": "step.1", "text": "Abre a porta.", "kind": "hint" }\n]\n`,
  );
  expect(c.output.join("\n")).toContain("data/steps.pt.json");
});

test("--lang is passed through, repeatable, and refuses the source or an unknown language before any request", async () => {
  const { calls } = await serve();
  expect(await run(["pull", "--lang", "pt", "--lang", "pt"], ctx())).toBe(0);
  expect(calls[0]?.url).toBe("/api/pull?minState=verified&lang=pt&lang=pt");
  const c = ctx();
  expect(await run(["pull", "--lang", "en"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/source language/);
  const d = ctx();
  expect(await run(["pull", "--lang", "de"], d)).toBe(1);
  expect(d.output.join("\n")).toMatch(
    /--lang de is not a language of this config \(pt\)/,
  );
  expect(calls).toHaveLength(1);
});

test("--lang writes only that language's files and hands importers only its entries, whatever the server returns", async () => {
  // A server that ignores ?lang= and returns fr too: the CLI still
  // narrows. fr.json is compact, which the writer would reformat.
  await serve(200, {
    ...PAYLOAD,
    translations: {
      ...PAYLOAD.translations,
      fr: { greeting: "Salut {name}", "exec.bye": "Salut {who}" },
    },
  });
  const { writeFileSync } = await import("node:fs");
  const fr = '{"greeting":"Bonjour {name}"}';
  writeFileSync(path.join(repo, "i18n/fr.json"), fr);
  const configPath = path.join(repo, "corpus.config.ts");
  writeFileSync(
    configPath,
    read("corpus.config.ts").replace('["en", "pt"]', '["en", "pt", "fr"]'),
  );
  const c = ctx();
  expect(await run(["pull", "--lang", "pt"], c)).toBe(0);
  expect(read("i18n/fr.json")).toBe(fr);
  expect(JSON.parse(read("i18n/pt.json"))).toEqual({
    "app.title": "Corpus",
    greeting: "Olá {name}",
  });
  const out = c.output.join("\n");
  expect(out).toContain("i18n/pt.json");
  expect(out).not.toContain("i18n/fr.json");
  const imported = JSON.parse(read("imported.json")) as {
    translations: Record<string, unknown>;
  };
  expect(Object.keys(imported.translations)).toEqual(["pt"]);
});

test("--check writes nothing, asks the importer to report, lists the files a pull would change, and exits 1 (#659)", async () => {
  await serve();
  const c = ctx();
  expect(await run(["pull", "--check"], c)).toBe(1);
  expect(() => read("i18n/pt.json")).toThrow();
  expect(() => read("imported.json")).toThrow();
  const out = c.output.join("\n");
  expect(out).toContain("ran node scripts/import.mjs (CORPUS_PULL_CHECK=1)");
  expect(out).toContain("i18n/pt.json");
  expect(out).toContain("imported.json");
  expect(out).toMatch(/2 file\(s\) would change/);
});

test("a pull counts the files an importer reports; one that reports nothing under --check is said unchecked (#659)", async () => {
  await serve();
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(c.output.join("\n")).toMatch(
    /2 file\(s\) changed, 1 import command\(s\) ran/,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      "scripts/import.mjs",
      "scripts/import-silent.mjs",
    ),
  );
  const q = ctx();
  await run(["pull", "--check"], q);
  expect(q.output.join("\n")).toMatch(
    /exec "node scripts\/import-silent.mjs" is not checked: it printed no \{"changed": \[…\]\} line under CORPUS_PULL_CHECK=1/,
  );
  // Without importCheck a check never runs an import command.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace("importCheck: true,", ""),
  );
  rmSync(path.join(repo, "imported.json"), { force: true });
  const r = ctx();
  await run(["pull", "--check"], r);
  expect(r.output.join("\n")).toMatch(
    /exec "node scripts\/import-silent.mjs" is not checked: set importCheck: true/,
  );
  expect(() => read("imported.json")).toThrow();
});

test("--check exits 0 when the repository already carries what the server would give", async () => {
  await serve();
  expect(await run(["pull"], ctx())).toBe(0);
  const c = ctx();
  expect(await run(["pull", "--check"], c)).toBe(0);
  expect(c.output.join("\n")).toMatch(/0 file\(s\) would change/);
});

test("an invalid --min-state is refused before any request", async () => {
  const { calls } = await serve();
  const c = ctx();
  expect(await run(["pull", "--min-state", "done"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/--min-state must be one of/);
  expect(calls).toHaveLength(0);
});

test("translations no writable source can take are reported, not dropped silently", async () => {
  await serve(200, {
    ...PAYLOAD,
    types: { ...PAYLOAD.types, "orphan.x": "nowhere" },
    translations: {
      ...PAYLOAD.translations,
      pt: { ...PAYLOAD.translations.pt, "orphan.x": "?" },
    },
  });
  const { writeFileSync } = await import("node:fs");
  // Drop the exec importer so nothing can claim the orphan.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      /,\s*importCommand: "node scripts\/import.mjs"/,
      "",
    ),
  );
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(c.output.join("\n")).toMatch(
    /2 translation\(s\) belong to no writable source/,
  );
});

test("a .ts catalogue is skipped with a message instead of failing in JSON.parse", async () => {
  await serve();
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.ts" }],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n/en.ts"),
    'export default { "app.title": "Corpus", greeting: "Hello {name}" };\n',
  );
  const c = ctx();
  const code = await run(["pull"], c);
  expect(code).toBe(0);
  expect(c.output).toContain(
    "corpus: i18n/{lang}.ts is not JSON: pull writes JSON only, so its translations cannot be written back",
  );
  expect(existsSync(path.join(repo, "i18n/pt.ts"))).toBe(false);
});

test("the source-language file keeps its own shape even at untranslated, and importers never see the source", async () => {
  await serve(200, { ...PAYLOAD, minState: "untranslated" });
  const compact = '{"app.title":"Corpus","greeting":"Hello {name}"}';
  writeFileSync(path.join(repo, "i18n/en.json"), compact);
  const c = ctx();
  expect(await run(["pull", "--min-state", "untranslated"], c)).toBe(0);
  expect(read("i18n/en.json")).toBe(compact);
  expect(c.output.join("\n")).not.toContain("i18n/en.json");
  const received = JSON.parse(read("imported.json")) as {
    translations: Record<string, unknown>;
  };
  expect(Object.keys(received.translations)).toEqual(["pt"]);
});

test("pending proposals are written into the source file, a removal into the target files too, and --check counts them", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "i18n/pt.json"),
    `{\n  "app.title": "Corpo",\n  "greeting": "Olá {name}"\n}\n`,
  );
  const withProposals = {
    ...PAYLOAD,
    translations: { en: PAYLOAD.translations.en, pt: {} },
    sourceChanges: [
      {
        kind: "edit",
        id: "greeting",
        type: "chrome",
        file: "i18n/en.json",
        text: "Hi {name}",
      },
      {
        kind: "add",
        id: "farewell",
        type: "chrome",
        file: "i18n/en.json",
        text: "Bye",
      },
      { kind: "delete", id: "app.title", type: "chrome", file: "i18n/en.json" },
      {
        kind: "edit",
        id: "exec.bye",
        type: "computed",
        file: "scripts/none.json",
        text: "x",
      },
    ],
  };
  await serve(200, withProposals);
  const c = ctx();
  expect(await run(["pull", "--check"], c)).toBe(1);
  // The two catalogue files and the file the importer reports.
  expect(c.output.join("\n")).toMatch(/3 file\(s\) would change/);
  expect(JSON.parse(read("i18n/en.json"))).toEqual({
    "app.title": "Corpus",
    greeting: "Hello {name}",
  });
  const d = ctx();
  expect(await run(["pull"], d)).toBe(0);
  expect(JSON.parse(read("i18n/en.json"))).toEqual({
    greeting: "Hi {name}",
    farewell: "Bye",
  });
  expect(JSON.parse(read("i18n/pt.json"))).toEqual({ greeting: "Olá {name}" });
  const out = d.output.join("\n");
  expect(out).toMatch(
    /scripts\/none\.json matches no writable source; not written/,
  );
  expect(out).toContain("i18n/en.json");
  expect(out).toContain("i18n/pt.json");
  expect(out).toContain(
    "3 proposal(s) written: commit and push, and the next corpus push marks them applied",
  );
});

test("a proposal for a table source without {lang} is written to the path itself", async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "steps.json"),
    `[\n  { "id": "s1", "text": "Um" }\n]\n`,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      "sources: [",
      'sources: [\n    { adapter: "table", type: "step", path: "steps.json", map: { id: "id", text: "text" } },',
    ),
  );
  await serve(200, {
    ...PAYLOAD,
    types: { ...PAYLOAD.types, s1: "step" },
    sourceChanges: [
      { kind: "edit", id: "s1", type: "step", file: "steps.json", text: "Um!" },
    ],
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("steps.json")).toBe(`[\n  { "id": "s1", "text": "Um!" }\n]\n`);
});

test("a {ns} source pulls each namespace's strings into its own file, prefix stripped, and a proposal lands in the file its id names (#513)", async () => {
  const { mkdirSync, writeFileSync, readFileSync, readdirSync } =
    await import("node:fs");
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "chrome", path: "locales/{lang}/{ns}.json" }],',
    ),
  );
  for (const [lang, ns, data] of [
    ["en", "common", { title: "Common title", greeting: "Hello {name}" }],
    ["en", "admin", { title: "Admin title" }],
    ["pt", "common", { title: "Título comum" }],
    ["pt", "admin", { title: "Título de administração" }],
  ] as const) {
    mkdirSync(path.join(repo, "locales", lang), { recursive: true });
    writeFileSync(
      path.join(repo, "locales", lang, `${ns}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
    );
  }
  const before = {
    common: read("locales/pt/common.json"),
    admin: read("locales/pt/admin.json"),
  };
  await serve(200, {
    ...PAYLOAD,
    types: {
      "common:title": "chrome",
      "common:greeting": "chrome",
      "admin:title": "chrome",
    },
    translations: {
      en: {
        "common:title": "Common title",
        "common:greeting": "Hello {name}",
        "admin:title": "Admin title",
      },
      pt: {
        "common:title": "Título comum",
        "common:greeting": "Olá {name}",
        "admin:title": "Título de administração",
      },
    },
    sourceChanges: [
      {
        kind: "edit",
        id: "admin:title",
        type: "chrome",
        file: "locales/en/admin.json",
        text: "Administration",
      },
    ],
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  // common gained its greeting, in its own file and without the prefix.
  expect(read("locales/pt/common.json")).toBe(
    `{\n  "title": "Título comum",\n  "greeting": "Olá {name}"\n}\n`,
  );
  // admin is byte-identical: nothing of its own changed, and common's
  // greeting did not leak into it.
  expect(read("locales/pt/admin.json")).toBe(before.admin);
  // The proposal edited admin's source file under its own key.
  expect(read("locales/en/admin.json")).toBe(
    `{\n  "title": "Administration"\n}\n`,
  );
  expect(read("locales/en/common.json")).toContain('"title": "Common title"');
});

test("a component whose language file is missing gets it on pull with its own ids, and a proposal without the namespace is refused by name (#513)", async () => {
  const { mkdirSync, writeFileSync, readFileSync, readdirSync } =
    await import("node:fs");
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "chrome", path: "src/{ns}/i18n/{lang}.json" }],',
    ),
  );
  for (const [ns, data] of [
    ["Button", { save: "Save" }],
    ["Card/Header", { save: "Save the card" }],
  ] as const) {
    mkdirSync(path.join(repo, "src", ns, "i18n"), { recursive: true });
    writeFileSync(
      path.join(repo, "src", ns, "i18n", "en.json"),
      `${JSON.stringify(data, null, 2)}\n`,
    );
  }
  await serve(200, {
    ...PAYLOAD,
    types: { "Button:save": "chrome", "Card/Header:save": "chrome" },
    translations: {
      en: { "Button:save": "Save", "Card/Header:save": "Save the card" },
      pt: { "Button:save": "Guardar", "Card/Header:save": "Guardar o cartão" },
    },
    sourceChanges: [
      {
        kind: "add",
        id: "title",
        type: "chrome",
        file: "src/Button/i18n/en.json",
        text: "Title",
      },
    ],
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(read("src/Button/i18n/pt.json")).toBe(`{\n  "save": "Guardar"\n}\n`);
  expect(read("src/Card/Header/i18n/pt.json")).toBe(
    `{\n  "save": "Guardar o cartão"\n}\n`,
  );
  expect(c.output.join("\n")).toContain(
    "proposal title for src/Button/i18n/en.json lacks the namespace Button: that file's ids carry; not written",
  );
  expect(c.output.join("\n")).not.toMatch(/1 proposal\(s\) written/);
  expect(read("src/Button/i18n/en.json")).toBe(`{\n  "save": "Save"\n}\n`);
});

test("a first pull into a missing .arb writes @@locale first; a missing .json gets no such key (#568)", async () => {
  const { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } =
    await import("node:fs");
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8")
      .replace(
        /sources: \[[\s\S]*?\n {2}\],/,
        'sources: [{ adapter: "messages", type: "chrome", path: "arb/strings_{lang}.arb" }, { adapter: "messages", type: "email", path: "i18n/{lang}.json" }],',
      )
      .replace(
        /languages: \[[^\]]*\]/,
        'languages: ["en", "pt", "de", "pt-PT", "sr_Latn"]',
      ),
  );
  mkdirSync(path.join(repo, "arb"));
  writeFileSync(
    path.join(repo, "arb/strings_en.arb"),
    `{
  "@@locale": "en",
  "wallpaper": "Wallpaper",
  "@wallpaper": {
    "description": "Menu entry",
    "placeholders": {}
  },
  "photosCount": "{count, plural, one {# photo} other {# photos}}"
}
`,
  );
  expect(existsSync(path.join(repo, "arb/strings_de.arb"))).toBe(false);
  expect(existsSync(path.join(repo, "i18n/de.json"))).toBe(false);
  await serve(200, {
    ...PAYLOAD,
    types: {
      wallpaper: "chrome",
      photosCount: "chrome",
      "app.title": "email",
      greeting: "email",
    },
    translations: {
      en: {
        wallpaper: "Wallpaper",
        photosCount: "{count, plural, one {# photo} other {# photos}}",
        "app.title": "Corpus",
        greeting: "Hello {name}",
      },
      de: { wallpaper: "Hintergrund", greeting: "Hallo {name}" },
      "pt-PT": { wallpaper: "Fundo" },
      sr_Latn: { wallpaper: "Pozadina" },
    },
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(read("arb/strings_de.arb")).toBe(
    `{\n  "@@locale": "de",\n  "wallpaper": "Hintergrund"\n}\n`,
  );
  // A hyphenated code takes the underscore form gen-l10n checks against,
  // whatever form the file name carries; an underscore code is as it is (#585).
  expect(read("arb/strings_pt-PT.arb")).toBe(
    `{\n  "@@locale": "pt_PT",\n  "wallpaper": "Fundo"\n}\n`,
  );
  expect(read("arb/strings_sr_Latn.arb")).toBe(
    `{\n  "@@locale": "sr_Latn",\n  "wallpaper": "Pozadina"\n}\n`,
  );
  expect(read("i18n/de.json")).toBe(`{\n  "greeting": "Hallo {name}"\n}\n`);
});

test("an array of patterns of one type is held together: a pull that changes nothing names no orphan (#513)", async () => {
  const { mkdirSync, writeFileSync, readFileSync, readdirSync } =
    await import("node:fs");
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    readFileSync(path.join(repo, configFile), "utf8").replace(
      /sources: \[[\s\S]*?\n {2}\],/,
      'sources: [{ adapter: "messages", type: "chrome", path: ["a/{lang}.json", "b/{lang}.json"] }],',
    ),
  );
  for (const [dir, en, pt] of [
    ["a", { one: "One" }, { one: "Um" }],
    ["b", { two: "Two" }, { two: "Dois" }],
  ] as const) {
    mkdirSync(path.join(repo, dir), { recursive: true });
    writeFileSync(
      path.join(repo, dir, "en.json"),
      `${JSON.stringify(en, null, 2)}\n`,
    );
    writeFileSync(
      path.join(repo, dir, "pt.json"),
      `${JSON.stringify(pt, null, 2)}\n`,
    );
  }
  await serve(200, {
    ...PAYLOAD,
    types: { one: "chrome", two: "chrome" },
    translations: {
      en: { one: "One", two: "Two" },
      pt: { one: "Um", two: "Dois" },
    },
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(c.output.join("\n")).not.toMatch(/no source-language file holds/);
  expect(read("a/pt.json")).toBe(`{\n  "one": "Um"\n}\n`);
  expect(read("b/pt.json")).toBe(`{\n  "two": "Dois"\n}\n`);
});

test("an android source builds, pulls into values-<qualifier>/strings.xml and validates its verbs and tags (#596)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt-BR", "br"],
  sources: [{ adapter: "android", type: "ui", path: "res" }],
});
`,
  );
  mkdirSync(path.join(repo, "res", "values"), { recursive: true });
  mkdirSync(path.join(repo, "res", "values-br"), { recursive: true });
  writeFileSync(
    path.join(repo, "res", "values", "strings.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="status">Logged in as %1$s on %2$s</string>
    <plurals name="episodes">
        <item quantity="one">%d episode</item>
        <item quantity="other">%d episodes</item>
    </plurals>
</resources>
`,
  );
  const breton = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="status">Kevreet evel <i>%1$s</i></string>
</resources>
`;
  writeFileSync(path.join(repo, "res", "values-br", "strings.xml"), breton);

  const built = ctx();
  const out = path.join(repo, "snapshot.json");
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8"));
  expect(snapshot.strings).toEqual([
    expect.objectContaining({
      id: "status",
      library: "android",
      file: "res/values/strings.xml",
    }),
    expect.objectContaining({
      id: "episodes",
      source: "{quantity, plural, one {%d episode} other {%d episodes}}",
    }),
  ]);
  expect(snapshot.seedTranslations).toEqual({
    br: { status: "Kevreet evel <i>%1$s</i>" },
  });
  expect(snapshot.sources).toEqual([
    expect.objectContaining({
      adapter: "android",
      path: "res/values/strings.xml",
    }),
  ]);

  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(1);
  expect(checked.output.join("\n")).toContain(
    "res/values-br/strings.xml:status: missing %2$s",
  );
  expect(checked.output.join("\n")).toContain("unexpected <i> tag");

  await serve(200, {
    ...PAYLOAD,
    types: { status: "ui", episodes: "ui" },
    translations: {
      "pt-BR": {
        status: "Conectado como %1$s em %2$s",
        episodes: "{quantity, plural, one {%d episódio} other {%d episódios}}",
      },
      br: { status: "Kevreet evel <i>%1$s</i>" },
    },
  });
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(0);
  expect(read("res/values-pt-rBR/strings.xml"))
    .toBe(`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="status">Conectado como %1$s em %2$s</string>
    <plurals name="episodes">
        <item quantity="one">%d episódio</item>
        <item quantity="other">%d episódios</item>
    </plurals>
</resources>
`);
  expect(read("res/values-br/strings.xml")).toBe(breton);
});

test("a fluent source builds, validates and pulls in the file's layout; an attribute is refused by name (#597)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "gl", "pt"],
  sources: [{ adapter: "fluent", type: "ui", path: "i18n/{lang}/app.ftl" }],
});
`,
  );
  for (const lang of ["en", "gl"])
    mkdirSync(path.join(repo, "i18n", lang), { recursive: true });
  writeFileSync(
    path.join(repo, "i18n", "en", "app.ftl"),
    `trash = Trash
copied = Copied {$items} {$items ->
    [one] item
    *[other] items
  } to {trash}
`,
  );
  const galician = `trash = Lixo
copied = Copiado {$items} {$items ->
    [unha] elemento
   *[outra] elementos
  } ao {trash}
`;
  writeFileSync(path.join(repo, "i18n", "gl", "app.ftl"), galician);

  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  expect(built.output.join("\n")).not.toContain("cannot be written back");
  const snapshot = JSON.parse(readFileSync(out, "utf8"));
  expect(snapshot.strings[1]).toMatchObject({
    id: "copied",
    source:
      "Copied {items} {items, plural, one {item} other {items}} to {@trash}",
    file: "i18n/en/app.ftl",
  });

  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(1);
  expect(checked.output.join("\n")).toContain("i18n/gl/app.ftl:copied:");

  await serve(200, {
    ...PAYLOAD,
    types: { trash: "ui", copied: "ui" },
    translations: {
      pt: {
        trash: "Lixo",
        copied:
          "Copiado {items} {items, plural, one {item} many {itens} other {itens}} para {@trash}",
      },
      gl: { trash: "Lixo" },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("i18n/pt/app.ftl")).toBe(`trash = Lixo
copied = Copiado {$items} {$items ->
    [one] item
    [many] itens
    *[other] itens
  } para {trash}
`);
  expect(read("i18n/gl/app.ftl")).toBe(galician);

  writeFileSync(
    path.join(repo, "i18n", "en", "app.ftl"),
    "login = Log in\n    .title = Log in to your account\n",
  );
  const refused = ctx();
  expect(await run(["build", "--out", out], refused)).toBe(1);
  expect(refused.output.join("\n")).toContain(
    "i18n/en/app.ftl [login]: invalid Fluent message: login has an attribute (.title)",
  );
});

test("a Fluent message Corpus cannot read is refused by itself: the rest build and seed, and a target's is a warning that a pull leaves alone (#991)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "uz"],
  sources: [{ adapter: "fluent", type: "ui", path: "i18n/{lang}/app.ftl" }],
});
`,
  );
  mkdirSync(path.join(repo, "i18n", "en"), { recursive: true });
  mkdirSync(path.join(repo, "i18n", "uz"), { recursive: true });
  writeFileSync(
    path.join(repo, "i18n", "en", "app.ftl"),
    "size = { PLATFORM() } files\nhello = Hello\nbye = Bye\n",
  );
  const uz = "hello = Salom { PLATFORM() } 2\nbye = Xayr\n";
  writeFileSync(path.join(repo, "i18n", "uz", "app.ftl"), uz);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(1);
  const said = built.output.join("\n");
  expect(said).toContain(
    "i18n/en/app.ftl [size]: invalid Fluent message: size calls a function",
  );
  expect(said).toContain(
    "i18n/uz/app.ftl: 1 translation(s) not seeded: a message Corpus cannot read, left as the file has it (hello)",
  );
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => s.id)).toEqual(["hello", "bye"]);
  expect(snapshot.seedTranslations).toEqual({ uz: { bye: "Xayr" } });
  const checked = ctx();
  // A refused message is an invalid finding.
  expect(await run(["validate"], checked)).toBe(1);
  const found = checked.output.join("\n");
  expect(found).toContain("i18n/en/app.ftl:size: invalid Fluent message");
  expect(found).toContain(
    "i18n/uz/app.ftl:hello: Corpus cannot read this message",
  );
  await serve(200, {
    ...PAYLOAD,
    types: { hello: "ui", bye: "ui" },
    translations: { uz: { bye: "Xayr" } },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("i18n/uz/app.ftl")).toBe(uz);
  // Terms are strings (#990): a file of terms Corpus cannot read is a
  // ruined file like any, since pushing the rest would archive them.
  writeFileSync(
    path.join(repo, "i18n", "en", "brands.ftl"),
    "-brand = { PLATFORM() }\n-relay = { OS() }\n",
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      'path: "i18n/{lang}/app.ftl"',
      'path: ["i18n/{lang}/app.ftl", "i18n/{lang}/brands.ftl"]',
    ),
  );
  const terms = ctx();
  expect(await run(["build", "--out", out], terms)).toBe(1);
  expect(terms.output.join("\n")).toContain(
    "i18n/en/brands.ftl [-brand]: invalid Fluent message: -brand calls a function",
  );
  expect(terms.output.join("\n")).toContain(
    "i18n/en/brands.ftl: every string in the file was refused (2)",
  );
  expect(terms.output.join("\n")).toContain("no snapshot was built");
  // A source term Corpus cannot read is that file's invalid finding, as
  // a message is; its translation in a target is no orphan.
  writeFileSync(
    path.join(repo, "i18n", "en", "app.ftl"),
    "hello = Hello\nbye = Bye\n",
  );
  writeFileSync(
    path.join(repo, "i18n", "uz", "app.ftl"),
    "hello = Salom\nbye = Xayr\n",
  );
  writeFileSync(
    path.join(repo, "i18n", "uz", "brands.ftl"),
    "-brand = Firefox\n",
  );
  const valid = ctx();
  expect(await run(["validate"], valid)).toBe(1);
  expect(valid.output.join("\n")).toContain(
    "i18n/en/brands.ftl:-brand: invalid Fluent message: -brand calls a function",
  );
  expect(valid.output.join("\n")).not.toContain("uz/brands.ftl");
  // A term Corpus reads is a string like any message, seeded and
  // pulled; a target's own term, which no source defines, is the
  // locale's and no orphan (#990).
  writeFileSync(
    path.join(repo, "i18n", "en", "brands.ftl"),
    "-brand = Firefox\n    .gender = masculine\n",
  );
  writeFileSync(
    path.join(repo, "i18n", "en", "app.ftl"),
    "hello = Hello { -brand }\nbye = Bye\n",
  );
  const uzBrands =
    "-brand = Firefoxu\n    .gender = masculine\n-local = Mahalliy\n-os = { OS() }\n";
  writeFileSync(path.join(repo, "i18n", "uz", "brands.ftl"), uzBrands);
  writeFileSync(
    path.join(repo, "i18n", "uz", "app.ftl"),
    "hello = Salom { -brand } { -local }\nbye = Xayr\n",
  );
  const termsBuilt = ctx();
  expect(await run(["build", "--out", out], termsBuilt)).toBe(0);
  const withTerms = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; source: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(withTerms.strings).toContainEqual(
    expect.objectContaining({ id: "-brand", source: "Firefox" }),
  );
  expect(withTerms.seedTranslations.uz).toMatchObject({
    "-brand": "Firefoxu",
    hello: "Salom {-brand} {-local}",
  });
  expect(withTerms.seedTranslations.uz!["-local"]).toBeUndefined();
  const termsValid = ctx();
  expect(await run(["validate"], termsValid)).toBe(0);
  expect(termsValid.output.join("\n")).not.toMatch(/-local|-os/);
  await serve(200, {
    ...PAYLOAD,
    types: { hello: "ui", bye: "ui", "-brand": "ui" },
    translations: {
      uz: { "-brand": "Firefoxa", hello: "Salom {-brand} {-local}" },
    },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("i18n/uz/brands.ftl")).toBe(
    "-brand = Firefoxa\n    .gender = masculine\n-local = Mahalliy\n-os = { OS() }\n",
  );
});

test("a language whose files use another code is pulled into that file, and seeded from it (#657)", async () => {
  // Hoppscotch keeps zh-CN in cn.json.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "zh-CN"],
  sources: [
    { adapter: "messages", type: "chrome", path: "i18n/{lang}.json", languageFiles: { "zh-CN": "cn" } },
  ],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n", "cn.json"),
    `{\n  "app.title": "Corpus"\n}\n`,
  );
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations?.["zh-CN"]).toEqual({
    "app.title": "Corpus",
  });
  await serve(200, {
    ...PAYLOAD,
    types: { "app.title": "chrome", greeting: "chrome" },
    translations: {
      en: { "app.title": "Corpus", greeting: "Hello {name}" },
      "zh-CN": { "app.title": "Corpus", greeting: "你好 {name}" },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("i18n/cn.json")).toBe(
    `{\n  "app.title": "Corpus",\n  "greeting": "你好 {name}"\n}\n`,
  );
  expect(existsSync(path.join(repo, "i18n", "zh-CN.json"))).toBe(false);
});

test("an importer's reported paths are the repository's, spelt as the adapters spell them; one outside it is refused (#659)", async () => {
  await serve();
  const script = (changed: string) =>
    `process.stdin.resume();\nprocess.stdin.on("end", () => console.log(JSON.stringify({ changed: ${changed} })));\n`;
  writeFileSync(
    path.join(repo, "scripts", "import.mjs"),
    script(
      `["./i18n/pt.json", process.cwd() + "/i18n/pt.json", "i18n\\\\pt.json", "imported.json"]`,
    ),
  );
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(c.output.at(-1)).toBe(
    "pulled pull-fixture at verified: 2 file(s) changed, 1 import command(s) ran",
  );
  writeFileSync(
    path.join(repo, "scripts", "import.mjs"),
    script(`["../x.json"]`),
  );
  const d = ctx();
  expect(await run(["pull"], d)).toBe(1);
  expect(d.output.join("\n")).toMatch(
    /reported \.\.\/x\.json changed, which is outside the repository/,
  );
});

test("a string two files of one source share goes into each target file that holds it, else the first's; a push and a pull change nothing (#661)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt", "de"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["i18n/{lang}.json", "shared/{lang}.json"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "shared"));
  writeFileSync(
    path.join(repo, "shared", "en.json"),
    `{\n  "greeting": "Hello {name}"\n}\n`,
  );
  // pt: only the shared file holds it. de: neither does.
  writeFileSync(
    path.join(repo, "shared", "pt.json"),
    `{\n  "greeting": "Olá {name}"\n}\n`,
  );
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  const payload = {
    ...PAYLOAD,
    types: { "app.title": "chrome", greeting: "chrome" },
    translations: {
      en: { "app.title": "Corpus", greeting: "Hello {name}" },
      ...snapshot.seedTranslations,
    },
  };
  // A push and a pull of what was pushed leave every file as it was.
  await serve(200, payload);
  const c = ctx();
  expect(await run(["pull", "--check"], c)).toBe(0);
  // A new German draft goes into the first file only.
  active?.close();
  await serve(200, {
    ...payload,
    translations: { ...payload.translations, de: { greeting: "Hallo {name}" } },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(JSON.parse(read("i18n/de.json"))).toEqual({
    greeting: "Hallo {name}",
  });
  expect(existsSync(path.join(repo, "shared", "de.json"))).toBe(false);
  expect(existsSync(path.join(repo, "i18n", "pt.json"))).toBe(false);
});

test("an edit or a removal proposed on a shared string goes into each source file that holds it (#661)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["i18n/{lang}.json", "shared/{lang}.json"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "shared"));
  writeFileSync(
    path.join(repo, "shared", "en.json"),
    `{\n  "greeting": "Hello {name}"\n}\n`,
  );
  await serve(200, {
    ...PAYLOAD,
    types: { "app.title": "chrome", greeting: "chrome" },
    translations: { en: {}, pt: {} },
    sourceChanges: [
      {
        kind: "edit",
        id: "greeting",
        type: "chrome",
        file: "i18n/en.json",
        text: "Hi {name}",
      },
    ],
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(JSON.parse(read("i18n/en.json")).greeting).toBe("Hi {name}");
  expect(JSON.parse(read("shared/en.json")).greeting).toBe("Hi {name}");
  expect(c.output.join("\n")).toMatch(/1 proposal\(s\) written/);
});

test("a plural object pushes as one plural string, validates without orphans, and pulls into an object with the language's forms (#662)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pl"],
  sources: [{ adapter: "messages", type: "chrome", library: "i18next", path: "i18n/{lang}.json" }],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n", "en.json"),
    `{\n  "rooms": {\n    "one": "{{count}} room",\n    "other": "{{count}} rooms"\n  }\n}\n`,
  );
  writeFileSync(
    path.join(repo, "i18n", "pl.json"),
    `{\n  "rooms": {\n    "one": "{{count}} pokój",\n    "few": "{{count}} pokoje",\n    "many": "{{count}} pokoi",\n    "other": "{{count}} pokoju"\n  }\n}\n`,
  );
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.strings.map((s) => [s.id, s.source])).toEqual([
    ["rooms", "{count, plural, one {{{count}} room} other {{{count}} rooms}}"],
  ]);
  const pl = snapshot.seedTranslations?.pl?.rooms;
  expect(pl).toBe(
    "{count, plural, one {{{count}} pokój} few {{{count}} pokoje} many {{{count}} pokoi} other {{{count}} pokoju}}",
  );
  const v = ctx();
  expect(await run(["validate"], v)).toBe(0);
  expect(v.output.join("\n")).not.toMatch(/no longer has/);
  // The pushed seed pulled back changes nothing; a new form is added.
  await serve(200, {
    ...PAYLOAD,
    types: { rooms: "chrome" },
    translations: { en: {}, pl: { rooms: pl } },
  });
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  active?.close();
  await serve(200, {
    ...PAYLOAD,
    types: { rooms: "chrome" },
    translations: {
      en: {},
      pl: {
        rooms:
          "{count, plural, one {{{count}} pokój} few {{{count}} pokoje} many {{{count}} pokoi} other {{{count}} pokoju!}}",
      },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(JSON.parse(read("i18n/pl.json")).rooms.other).toBe(
    "{{count}} pokoju!",
  );
});

test("a String Catalog naming another source language than the config's still reads its ids, and names no orphan (#868 review)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      '{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },',
      '{ adapter: "xcstrings", type: "chrome", path: "L.xcstrings" },',
    ),
  );
  writeFileSync(
    path.join(repo, "L.xcstrings"),
    '{\n  "sourceLanguage" : "de",\n  "strings" : {\n    "greeting" : {\n\n    }\n  },\n  "version" : "1.0"\n}\n',
  );
  await serve(200, {
    ...PAYLOAD,
    types: { greeting: "chrome" },
    translations: { pt: { greeting: "Olá {name}" } },
  });
  const c = ctx();
  await run(["pull"], c);
  expect(c.output.join("\n")).not.toMatch(/no source-language file holds/);
});

test("a target's plural object without other is seeded as the plural, named by validate for its missing other, and pulled back unchanged (#950)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pl"],
  sources: [{ adapter: "messages", type: "chrome", library: "counterpart", path: "i18n/{lang}.json" }],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n", "en.json"),
    `{\n  "rooms": {\n    "one": "%(count)s room",\n    "other": "%(count)s rooms"\n  }\n}\n`,
  );
  const plFile = `{\n  "rooms": {\n    "one": "%(count)s pokój",\n    "few": "%(count)s pokoje",\n    "many": "%(count)s pokoi"\n  }\n}\n`;
  writeFileSync(path.join(repo, "i18n", "pl.json"), plFile);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  const pl = snapshot.seedTranslations?.pl?.rooms;
  expect(pl).toBe(
    "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi}}",
  );
  const v = ctx();
  expect(await run(["validate"], v)).toBe(1);
  const said = v.output.join("\n");
  expect(said).not.toMatch(/no longer has/);
  expect(said).toMatch(/pl\.json:rooms: .*other/);
  await serve(200, {
    ...PAYLOAD,
    types: { rooms: "chrome" },
    translations: { en: {}, pl: { rooms: pl } },
  });
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  expect(read("i18n/pl.json")).toBe(plFile);
});

test("a target's plural object with a broken form is seeded as the plural, named by validate as an invalid translation rather than orphans, and pulled back unchanged (#960)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pl"],
  sources: [{ adapter: "messages", type: "chrome", library: "icu", path: "i18n/{lang}.json" }],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n", "en.json"),
    `{\n  "rooms": {\n    "one": "{count} room",\n    "other": "{count} rooms"\n  }\n}\n`,
  );
  const plFile = `{\n  "rooms": {\n    "one": "{count} pokój }",\n    "few": "{count} pokoje",\n    "other": "{count} pokoi"\n  }\n}\n`;
  writeFileSync(path.join(repo, "i18n", "pl.json"), plFile);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  const pl = snapshot.seedTranslations?.pl?.rooms;
  expect(pl).toBe(
    "{count, plural, one {{count} pokój }} few {{count} pokoje} other {{count} pokoi}}",
  );
  const v = ctx();
  expect(await run(["validate"], v)).toBe(1);
  const said = v.output.join("\n");
  expect(said).not.toMatch(/no longer has/);
  expect(said).toMatch(/pl\.json:rooms: /);
  await serve(200, {
    ...PAYLOAD,
    types: { rooms: "chrome" },
    translations: { en: {}, pl: { rooms: pl } },
  });
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  expect(read("i18n/pl.json")).toBe(plFile);
});

test("under i18next a target that writes its plural in the other shape than the source's is seeded as the plural and pulled back unchanged, either way (#1187)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pl"],
  sources: [{ adapter: "messages", type: "chrome", library: "i18next", path: "i18n/{lang}.json" }],
});
`,
  );
  const object = (forms: string[]) =>
    `{\n  "rooms": {\n${forms.map((f) => `    "${f}": "{{count}} ${f}"`).join(",\n")}\n  }\n}\n`;
  const suffix = (forms: string[]) =>
    `{\n${forms.map((f) => `  "rooms_${f}": "{{count}} ${f}"`).join(",\n")}\n}\n`;
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  for (const [en, pl] of [
    [suffix(["one", "other"]), object(["one", "few", "many", "other"])],
    [object(["one", "other"]), suffix(["one", "few", "many", "other"])],
  ] as const) {
    writeFileSync(path.join(repo, "i18n", "en.json"), en);
    writeFileSync(path.join(repo, "i18n", "pl.json"), pl);
    const snapshot = await buildSnapshot(await loadConfig(repo), repo);
    const seed = snapshot.seedTranslations?.pl?.rooms;
    expect(seed).toBe(
      "{count, plural, one {{{count}} one} few {{{count}} few} many {{{count}} many} other {{{count}} other}}",
    );
    const v = ctx();
    expect(await run(["validate"], v)).toBe(0);
    await serve(200, {
      ...PAYLOAD,
      types: { rooms: "chrome" },
      translations: { en: {}, pl: { rooms: seed } },
    });
    expect(await run(["pull", "--check"], ctx())).toBe(0);
    expect(read("i18n/pl.json")).toBe(pl);
  }
});

test("a source's arguments carry on its strings, so validate allows a value the code passes beside the source's; one naming no string stops the build (#1031)", async () => {
  const config = (args: string) =>
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "ja"],
  sources: [{ adapter: "yaml", type: "ui", path: "i18n/client.{lang}.yml"${args} }],
});
`;
  writeFileSync(
    path.join(repo, "i18n", "client.en.yml"),
    `en:\n  js:\n    views_long:\n      one: "this topic has been viewed %{count} time"\n      other: "this topic has been viewed %{count} times"\n`,
  );
  writeFileSync(
    path.join(repo, "i18n", "client.ja.yml"),
    `ja:\n  js:\n    views_long:\n      other: "このトピックは %{number} 回表示されました"\n`,
  );
  writeFileSync(path.join(repo, "corpus.config.ts"), config(""));
  const before = ctx();
  expect(await run(["validate"], before)).toBe(1);
  expect(before.output.join("\n")).toMatch(/views_long: .*%\{number\}/);
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    config(`, arguments: { "js.views_long": ["number"] }`),
  );
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(
    snapshot.strings.find((s) => s.id === "js.views_long")?.arguments,
  ).toEqual(["number"]);
  expect(await run(["validate"], ctx())).toBe(0);
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    config(`, arguments: { "js.view_long": ["number"] }`),
  );
  await expect(buildSnapshot(await loadConfig(repo), repo)).rejects.toThrow(
    /arguments names js\.view_long, which the source does not have/,
  );
  // A path list's patterns share the map, a module validate does not
  // read back among them, so an id only it holds is no typo there.
  writeFileSync(
    path.join(repo, "i18n", "extra.en.js"),
    `export default { en: { js: { z: "Z %{count}" } } };\n`,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "ja"],
  sources: [{ adapter: "messages", type: "ui", library: "rails", path: ["i18n/views.{lang}.json", "i18n/extra.{lang}.js"], arguments: { "z": ["number"] } }],
});
`,
  );
  writeFileSync(path.join(repo, "i18n", "views.en.json"), `{ "y": "Y" }\n`);
  expect(await run(["validate"], ctx())).toBe(0);
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    config(`, arguments: { "js.view_long": ["number"] }`),
  );
  // Local validate says the same, rather than checking without it.
  const typo = ctx();
  expect(await run(["validate"], typo)).toBe(1);
  expect(typo.output.join("\n")).toMatch(
    /arguments names js\.view_long, which the source does not have/,
  );
});

test("a pull into an empty {} target takes its sibling targets' indent, as wger's Weblate files have four spaces beside a two-space source (#1041)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "gl"],
  sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }],
});
`,
  );
  writeFileSync(
    path.join(repo, "i18n", "en.json"),
    `{\n  "a": "A",\n  "b": "B"\n}\n`,
  );
  writeFileSync(path.join(repo, "i18n", "de.json"), `{\n    "a": "Ä"\n}\n`);
  writeFileSync(path.join(repo, "i18n", "gl.json"), "{}\n");
  await serve(200, {
    ...PAYLOAD,
    types: { a: "chrome", b: "chrome" },
    translations: { en: {}, de: { a: "Ä" }, gl: { a: "Á", b: "Bé" } },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("i18n/gl.json")).toBe(`{\n    "a": "Á",\n    "b": "Bé"\n}\n`);
});

test("under merge: last-wins the later file's translation is seeded and written, an earlier one only where it agreed, and a pull of what was pushed changes nothing (#953)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt", "de", "fr"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["i18n/{lang}.json", "shared/{lang}.json"], merge: "last-wins" },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "shared"));
  writeFileSync(
    path.join(repo, "shared", "en.json"),
    `{\n  "greeting": "Hello {name}"\n}\n`,
  );
  // pt: the files disagree. de: they agree. fr: neither holds it.
  const files = {
    "i18n/pt.json": `{\n  "greeting": "Olá {name}"\n}\n`,
    "shared/pt.json": `{\n  "greeting": "Oi {name}"\n}\n`,
    "i18n/de.json": `{\n  "greeting": "Hallo {name}"\n}\n`,
    "shared/de.json": `{\n  "greeting": "Hallo {name}"\n}\n`,
  };
  for (const [file, text] of Object.entries(files))
    writeFileSync(path.join(repo, file), text);
  const { buildSnapshotReport } = await import("./build");
  const { loadConfig } = await import("./config");
  const report = await buildSnapshotReport(await loadConfig(repo), repo);
  expect(report.snapshot.seedTranslations?.pt).toEqual({
    greeting: "Oi {name}",
  });
  expect(report.notes.join("\n")).toMatch(
    /shared\/\{lang\}\.json: 1 translation\(s\) differ from an earlier pattern's/,
  );
  const v = ctx();
  await run(["validate"], v);
  expect(v.output.join("\n")).toMatch(
    /shared\/pt\.json:greeting: reads otherwise in i18n\/pt\.json, which the app never shows/,
  );
  expect(v.output.join("\n")).not.toMatch(/de\.json:greeting: reads/);
  const payload = {
    ...PAYLOAD,
    types: { "app.title": "chrome", greeting: "chrome" },
    translations: {
      en: { "app.title": "Corpus", greeting: "Hello {name}" },
      ...report.snapshot.seedTranslations,
    },
  };
  await serve(200, payload);
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  active?.close();
  await serve(200, {
    ...payload,
    translations: {
      ...payload.translations,
      pt: { greeting: "Oi, {name}!" },
      de: { greeting: "Servus {name}" },
      fr: { greeting: "Salut {name}" },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  // The earlier pt file, which the app never shows, keeps its text.
  expect(read("i18n/pt.json")).toBe(files["i18n/pt.json"]);
  expect(JSON.parse(read("shared/pt.json")).greeting).toBe("Oi, {name}!");
  expect(JSON.parse(read("i18n/de.json")).greeting).toBe("Servus {name}");
  expect(JSON.parse(read("shared/de.json")).greeting).toBe("Servus {name}");
  expect(JSON.parse(read("shared/fr.json")).greeting).toBe("Salut {name}");
  expect(existsSync(path.join(repo, "i18n", "fr.json"))).toBe(false);
});

test("under merge: last-wins a later file's plural object without other is the one that holds it, and an empty value is no disagreement (#953 review)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [
    { adapter: "messages", type: "chrome", library: "counterpart", path: ["a/{lang}.json", "c/{lang}.json"], merge: "last-wins" },
  ],
});
`,
  );
  const en = `{\n  "n": {\n    "one": "%(count)s item",\n    "other": "%(count)s items"\n  },\n  "e": "Empty"\n}\n`;
  const files = {
    "a/en.json": en,
    "c/en.json": en,
    "a/pt.json": `{\n  "n": {\n    "one": "%(count)s item A",\n    "other": "%(count)s itens A"\n  },\n  "e": "Vazio"\n}\n`,
    "c/pt.json": `{\n  "n": {\n    "zero": "nada C",\n    "one": "%(count)s item C"\n  },\n  "e": ""\n}\n`,
  };
  for (const dir of ["a", "c"]) mkdirSync(path.join(repo, dir));
  for (const [file, text] of Object.entries(files))
    writeFileSync(path.join(repo, file), text);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations?.pt?.n).toBe(
    "{count, plural, zero {nada C} one {%(count)s item C}}",
  );
  const v = ctx();
  await run(["validate"], v);
  expect(v.output.join("\n")).toMatch(/c\/pt\.json:n: reads otherwise/);
  expect(v.output.join("\n")).not.toMatch(/:e: reads otherwise/);
  const payload = {
    ...PAYLOAD,
    types: { n: "chrome", e: "chrome" },
    translations: { en: {}, ...snapshot.seedTranslations },
  };
  await serve(200, payload);
  const check = ctx();
  expect(await run(["pull", "--check"], check)).toBe(0);
  expect(check.output.join("\n")).not.toMatch(/not written/);
  active?.close();
  await serve(200, {
    ...payload,
    translations: {
      en: {},
      pt: {
        n: "{count, plural, one {%(count)s item} other {%(count)s itens}}",
      },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("a/pt.json")).toBe(files["a/pt.json"]);
  expect(JSON.parse(read("c/pt.json")).n).toEqual({
    one: "%(count)s item",
    other: "%(count)s itens",
  });
});

test("a shared string's empty value in one target file is a key it lacks: a pull of what was pushed changes nothing (#970)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["i18n/{lang}.json", "shared/{lang}.json"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "shared"));
  writeFileSync(
    path.join(repo, "shared", "en.json"),
    `{\n  "greeting": "Hello {name}"\n}\n`,
  );
  const files = {
    "i18n/pt.json": `{\n  "greeting": ""\n}\n`,
    "shared/pt.json": `{\n  "greeting": "Olá {name}"\n}\n`,
  };
  for (const [file, text] of Object.entries(files))
    writeFileSync(path.join(repo, file), text);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations?.pt).toEqual({ greeting: "Olá {name}" });
  await serve(200, {
    ...PAYLOAD,
    types: { "app.title": "chrome", greeting: "chrome" },
    translations: {
      en: { "app.title": "Corpus", greeting: "Hello {name}" },
      ...snapshot.seedTranslations,
    },
  });
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  expect(await run(["pull"], ctx())).toBe(0);
  for (const [file, text] of Object.entries(files))
    expect(read(file), file).toBe(text);
});

test("a shared string no target file translates goes into each that has its key, a table's and an all-empty plural's included (#970 review)", async () => {
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const configure = (sources: string, languages = '["en", "pt"]') =>
    writeFileSync(
      path.join(repo, "corpus.config.ts"),
      `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ${languages},
  sources: [${sources}],
});
`,
    );
  const write = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), text);
    }
  };
  const pullWith = async (
    translations: Record<string, Record<string, string>>,
  ) => {
    active?.close();
    await serve(200, {
      ...PAYLOAD,
      types: {
        "app.title": "chrome",
        greeting: "chrome",
        save: "chrome",
        n: "chrome",
      },
      translations: { en: {}, ...translations },
    });
    expect(await run(["pull"], ctx())).toBe(0);
  };
  // Both targets hold "" under strict: the app may read either.
  configure(
    `{ adapter: "messages", type: "chrome", path: ["i18n/{lang}.json", "shared/{lang}.json"] }`,
  );
  write({
    "shared/en.json": `{\n  "greeting": "Hello {name}"\n}\n`,
    "i18n/pt.json": `{\n  "greeting": ""\n}\n`,
    "shared/pt.json": `{\n  "greeting": ""\n}\n`,
  });
  await pullWith({ pt: { greeting: "Olá {name}" } });
  expect(JSON.parse(read("i18n/pt.json")).greeting).toBe("Olá {name}");
  expect(JSON.parse(read("shared/pt.json")).greeting).toBe("Olá {name}");

  // A table list: an empty text is a key the file lacks.
  configure(
    `{ adapter: "table", type: "chrome", path: ["t/a/{lang}.json", "t/b/{lang}.json"], map: { id: "id", text: "text" } }`,
  );
  const row = (text: string) =>
    `${JSON.stringify([{ id: "save", text }], null, 2)}\n`;
  const table = {
    "t/a/en.json": row("Save"),
    "t/b/en.json": row("Save"),
    "t/a/pt.json": row(""),
    "t/b/pt.json": row("Salvar"),
  };
  write(table);
  const tableSeeds = (await buildSnapshot(await loadConfig(repo), repo))
    .seedTranslations;
  await pullWith(tableSeeds ?? {});
  for (const [file, text] of Object.entries(table))
    expect(read(file), file).toBe(text);

  // A plural object whose every form is empty holds nothing: no build
  // error beside a translated one, and nothing rewritten.
  configure(
    `{ adapter: "messages", type: "chrome", library: "counterpart", path: ["p/a/{lang}.json", "p/b/{lang}.json"] }`,
  );
  const plural = {
    "p/a/en.json": `{\n  "n": { "one": "%(count)s item", "other": "%(count)s items" }\n}\n`,
    "p/b/en.json": `{\n  "n": { "one": "%(count)s item", "other": "%(count)s items" }\n}\n`,
    "p/a/pt.json": `{\n  "n": { "one": "", "other": "" }\n}\n`,
    "p/b/pt.json": `{\n  "n": { "one": "%(count)s item", "other": "%(count)s itens" }\n}\n`,
  };
  write(plural);
  const pluralSeeds = (await buildSnapshot(await loadConfig(repo), repo))
    .seedTranslations;
  expect(pluralSeeds?.pt?.n).toBe(
    "{count, plural, one {%(count)s item} other {%(count)s itens}}",
  );
  await pullWith(pluralSeeds ?? {});
  for (const [file, text] of Object.entries(plural))
    expect(read(file), file).toBe(text);
});

test("a removal of an i18next plural takes a target's object with it, however few its forms (#984)", async () => {
  const configFile = readdirSync(repo).find((f) =>
    f.startsWith("corpus.config"),
  )!;
  writeFileSync(
    path.join(repo, configFile),
    `export default { project: "pull-fixture", server: process.env.CORPUS_SERVER, sourceLanguage: "en", languages: ["en", "ja"], sources: [{ adapter: "messages", type: "ui", library: "i18next", path: "i18n/{lang}.json" }] };\n`,
  );
  writeFileSync(
    path.join(repo, "i18n/en.json"),
    `{\n  "calls": {\n    "one": "{{count}} call",\n    "other": "{{count}} calls"\n  },\n  "x": "X"\n}\n`,
  );
  writeFileSync(
    path.join(repo, "i18n/ja.json"),
    `{\n  "calls": {\n    "other": "{{count}} 件"\n  },\n  "x": "エックス"\n}\n`,
  );
  await serve(200, {
    ...PAYLOAD,
    types: { calls: "ui", x: "ui" },
    translations: { en: {}, ja: {} },
    minState: "untranslated",
    sourceChanges: [
      { kind: "delete", id: "calls", type: "ui", file: "i18n/en.json" },
    ],
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(JSON.parse(read("i18n/en.json"))).toEqual({ x: "X" });
  expect(JSON.parse(read("i18n/ja.json"))).toEqual({ x: "エックス" });
});

test("an android app's modules are one catalogue under a list of res directories, and a {ns} module's ids are its own (#989)", async () => {
  const res = (dir: string, body: string) => {
    mkdirSync(path.join(repo, dir), { recursive: true });
    writeFileSync(
      path.join(repo, dir, "strings.xml"),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}</resources>\n`,
    );
  };
  const config = (merge: string) =>
    writeFileSync(
      path.join(repo, "corpus.config.ts"),
      `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "android", type: "ui", path: ["core/src/main/res", "app/src/main/res"], merge: "${merge}" },
    { adapter: "android", type: "ui", path: "feature/{ns}/src/commonMain/composeResources" },
  ],
});
`,
    );
  res(
    "core/src/main/res/values",
    '    <string name="app_name">Mail</string>\n    <string name="sort_by">Sort by</string>\n    <string name="title">Core</string>\n',
  );
  res(
    "app/src/main/res/values",
    '    <string name="app_name">Mail</string>\n    <string name="title">App</string>\n',
  );
  res(
    "core/src/main/res/values-de",
    '    <string name="app_name">Post</string>\n',
  );
  res(
    "app/src/main/res/values-de",
    '    <string name="app_name">Post</string>\n',
  );
  res(
    "feature/notification/api/src/commonMain/composeResources/values",
    '    <string name="title">New mail</string>\n',
  );
  config("strict");
  const strict = ctx();
  expect(await run(["build", "--out", path.join(repo, "s.json")], strict)).toBe(
    1,
  );
  expect(strict.output.join("\n")).toMatch(
    /duplicate id title in core\/src\/main\/res\/values\/strings.xml and app\/src\/main\/res\/values\/strings.xml, with different text/,
  );
  config("last-wins");
  const built = ctx();
  expect(await run(["build", "--out", path.join(repo, "s.json")], built)).toBe(
    0,
  );
  const snapshot = JSON.parse(read("s.json")) as {
    strings: { id: string; source: string }[];
  };
  expect(snapshot.strings.map((s) => [s.id, s.source])).toEqual(
    expect.arrayContaining([
      ["app_name", "Mail"],
      ["sort_by", "Sort by"],
      ["title", "App"],
      ["notification/api:title", "New mail"],
    ]),
  );
  expect(snapshot.strings.filter((s) => s.id === "app_name")).toHaveLength(1);
  await serve(200, {
    ...PAYLOAD,
    types: {
      app_name: "ui",
      sort_by: "ui",
      title: "ui",
      "notification/api:title": "ui",
    },
    translations: {
      de: {
        app_name: "E-Post",
        sort_by: "Sortieren nach",
        "notification/api:title": "Neue Post",
      },
    },
  });
  expect(await run(["pull"], ctx())).toBe(0);
  // A shared id lands in every module that holds it; one alone, in its own.
  expect(read("core/src/main/res/values-de/strings.xml")).toContain(
    '<string name="app_name">E-Post</string>',
  );
  expect(read("app/src/main/res/values-de/strings.xml")).toContain(
    '<string name="app_name">E-Post</string>',
  );
  expect(read("core/src/main/res/values-de/strings.xml")).toContain(
    '<string name="sort_by">Sortieren nach</string>',
  );
  expect(read("app/src/main/res/values-de/strings.xml")).not.toContain(
    "sort_by",
  );
  expect(
    read(
      "feature/notification/api/src/commonMain/composeResources/values-de/strings.xml",
    ),
  ).toContain('<string name="title">Neue Post</string>');
});

test("an Android regional language pulls into each module's directory for it, or its language's, and a new one into its own (#1007)", async () => {
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}</resources>\n`;
  const res = (dir: string, body: string) => {
    mkdirSync(path.join(repo, dir), { recursive: true });
    writeFileSync(path.join(repo, dir, "strings.xml"), xml(body));
  };
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "ta-IN"],
  sources: [{ adapter: "android", type: "ui", path: ["a/res", "b/res", "c/res"], merge: "last-wins" }],
});
`,
  );
  res("a/res/values", '    <string name="a">A</string>\n');
  res("a/res/values-ta", '    <string name="a">அ</string>\n');
  res("b/res/values", '    <string name="b">B</string>\n');
  res("b/res/values-ta-rIN", '    <string name="b">ப</string>\n');
  res("c/res/values", '    <string name="c">C</string>\n');
  const before = {
    a: read("a/res/values-ta/strings.xml"),
    b: read("b/res/values-ta-rIN/strings.xml"),
  };
  const pull = async (ta: Record<string, string>) => {
    await serve(200, {
      ...PAYLOAD,
      types: { a: "ui", b: "ui", c: "ui" },
      translations: { "ta-IN": ta },
    });
    expect(await run(["pull"], ctx())).toBe(0);
    active?.close();
  };
  // The text each module holds comes back as it was.
  await pull({ a: "அ", b: "ப" });
  expect(read("a/res/values-ta/strings.xml")).toBe(before.a);
  expect(read("b/res/values-ta-rIN/strings.xml")).toBe(before.b);
  expect(existsSync(path.join(repo, "a/res/values-ta-rIN"))).toBe(false);
  await pull({ a: "அஅ", b: "பப", c: "க" });
  expect(read("a/res/values-ta/strings.xml")).toContain(
    '<string name="a">அஅ</string>',
  );
  expect(read("b/res/values-ta-rIN/strings.xml")).toContain(
    '<string name="b">பப</string>',
  );
  expect(read("c/res/values-ta-rIN/strings.xml")).toContain(
    '<string name="c">க</string>',
  );
  expect(existsSync(path.join(repo, "a/res/values-ta-rIN"))).toBe(false);
});

test("a yaml source of several patterns pulls each id into the files that hold it, a shared one into each (#1024)", async () => {
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    writeFileSync(path.join(repo, rel), text);
  };
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [{ adapter: "yaml", type: "ui", path: ["config/locales/{lang}.yml", "config/locales/devise.{lang}.yml"] }],
});
`,
  );
  put("config/locales/en.yml", "en:\n  hello: Hello\n  shared: Same\n");
  put(
    "config/locales/devise.en.yml",
    "en:\n  devise:\n    ok: OK\n  shared: Same\n",
  );
  put("config/locales/de.yml", "de:\n  hello: Hallo\n  shared: Gleich\n");
  put(
    "config/locales/devise.de.yml",
    "de:\n  devise:\n    ok: OK\n  shared: Gleich\n",
  );
  const before = {
    main: read("config/locales/de.yml"),
    devise: read("config/locales/devise.de.yml"),
  };
  const serveDe = async (de: Record<string, string>) => {
    await serve(200, {
      ...PAYLOAD,
      types: { hello: "ui", shared: "ui", "devise.ok": "ui" },
      translations: { de },
    });
    expect(await run(["pull"], ctx())).toBe(0);
    active?.close();
  };
  await serveDe({ hello: "Hallo", shared: "Gleich", "devise.ok": "OK" });
  expect(read("config/locales/de.yml")).toBe(before.main);
  expect(read("config/locales/devise.de.yml")).toBe(before.devise);
  await serveDe({ hello: "Hallo", shared: "Dasselbe", "devise.ok": "Gut" });
  expect(read("config/locales/de.yml")).toBe(
    "de:\n  hello: Hallo\n  shared: Dasselbe\n",
  );
  expect(read("config/locales/devise.de.yml")).toBe(
    "de:\n  devise:\n    ok: Gut\n  shared: Dasselbe\n",
  );
});

test("a yaml source whose source language languageFiles maps pulls into the mapped root, proposals too (#994)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en-US",
  languages: ["en-US", "de"],
  sources: [{ adapter: "yaml", type: "ui", path: "config/locales/{lang}.yml", languageFiles: { "en-US": "en" } }],
});
`,
  );
  mkdirSync(path.join(repo, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(repo, "config", "locales", "en.yml"),
    "en:\n  hi: Hello\n",
  );
  writeFileSync(
    path.join(repo, "config", "locales", "de.yml"),
    "de:\n  hi: Hallo\n",
  );
  await serve(200, {
    ...PAYLOAD,
    sourceLanguage: "en-US",
    types: { hi: "ui" },
    translations: { de: { hi: "Hallo!" } },
    minState: "untranslated",
    sourceChanges: [
      {
        kind: "add",
        id: "bye",
        type: "ui",
        file: "config/locales/en.yml",
        text: "Bye",
      },
    ],
  });
  const c = ctx();
  expect(await run(["pull", "--min-state", "untranslated"], c)).toBe(0);
  expect(read("config/locales/de.yml")).toBe("de:\n  hi: Hallo!\n");
  // A new key is written double-quoted, as yaml's writer does (#1021).
  expect(read("config/locales/en.yml")).toBe("en:\n  hi: Hello\n  bye: Bye\n");
});

test("a yaml target rooted at the tag languageFiles maps to its file seeds, pulls and takes a removal under that root, as Rails reads it (#1048)", async () => {
  // Chatwoot: sr.yml is rooted at sr-Latn.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "sr-Latn", "de"],
  sources: [{ adapter: "yaml", type: "ui", path: "config/locales/{lang}.yml", languageFiles: { "sr-Latn": "sr" } }],
});
`,
  );
  mkdirSync(path.join(repo, "config", "locales"), { recursive: true });
  writeFileSync(
    path.join(repo, "config", "locales", "en.yml"),
    "en:\n  hi: Hello\n  bye: Bye\n",
  );
  const sr = "# Serbian, Latin script\nsr-Latn:\n  hi: Zdravo\n  bye: Ćao\n";
  writeFileSync(path.join(repo, "config", "locales", "sr.yml"), sr);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations?.["sr-Latn"]).toEqual({
    hi: "Zdravo",
    bye: "Ćao",
  });
  await serve(200, {
    ...PAYLOAD,
    types: { hi: "ui", bye: "ui" },
    translations: {
      "sr-Latn": { hi: "Zdravo!", bye: "Ćao" },
      de: { hi: "Hallo" },
    },
    minState: "untranslated",
    sourceChanges: [
      { kind: "delete", id: "bye", type: "ui", file: "config/locales/en.yml" },
    ],
  });
  expect(await run(["pull", "--min-state", "untranslated"], ctx())).toBe(0);
  expect(read("config/locales/sr.yml")).toBe(
    "# Serbian, Latin script\nsr-Latn:\n  hi: Zdravo!\n",
  );
  expect(read("config/locales/en.yml")).toBe("en:\n  hi: Hello\n");
  // A missing file starts at its code, as before.
  expect(read("config/locales/de.yml")).toBe("de:\n  hi: Hallo\n");
  // Rooted at its code, it still reads.
  writeFileSync(
    path.join(repo, "config", "locales", "sr.yml"),
    "sr:\n  hi: Zdravo\n",
  );
  const again = await buildSnapshot(await loadConfig(repo), repo);
  expect(again.seedTranslations?.["sr-Latn"]).toEqual({ hi: "Zdravo" });
});

test("one messages value or xliff unit Corpus cannot read is refused by itself: the rest build and seed, and a pull leaves it alone (#1026)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "l/{lang}.json" },
    { adapter: "xliff", type: "ui", path: "x/messages.{lang}.xlf" },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "l"), { recursive: true });
  mkdirSync(path.join(repo, "x"), { recursive: true });
  writeFileSync(
    path.join(repo, "l", "en.json"),
    `{ "a": "A", "b": "B", "c": "C", "d": "D", "version": 2 }\n`,
  );
  const de = `{ "a": "A-de", "b": 3, "c": "C-de", "d": ["x"] }\n`;
  writeFileSync(path.join(repo, "l", "de.json"), de);
  const xlf = (lang: string, units: string) =>
    `<?xml version="1.0"?>\n<xliff version="2.0" srcLang="en"${lang === "en" ? "" : ` trgLang="${lang}"`}><file id="f">\n${units}\n</file></xliff>\n`;
  writeFileSync(
    path.join(repo, "x", "messages.en.xlf"),
    xlf(
      "en",
      `<unit id="u1"><segment><source>One</source></segment></unit>\n<unit id="u2"><segment><source>Two</source></segment></unit>`,
    ),
  );
  const xde = xlf(
    "de",
    `<unit id="u1"><segment state="translated"><source>One</source><target>Eins</target></segment></unit>\n<unit id="u2"><segment><source>T</source><target>Z</target></segment><segment><source>wo</source></segment></unit>`,
  );
  writeFileSync(path.join(repo, "x", "messages.de.xlf"), xde);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const said = built.output.join("\n");
  // A list is read by index (#1053): de's `d` list is an item d.0 the
  // source has no string for, an orphan, not an entry left unread.
  expect(said).not.toContain("l/de.json: 1 translation(s) not seeded");
  expect(said).toContain(
    "x/messages.de.xlf: 1 translation(s) not seeded: an entry Corpus cannot read, left as the file has it (u2)",
  );
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => s.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
    "u1",
    "u2",
  ]);
  expect(snapshot.seedTranslations).toEqual({
    de: { a: "A-de", c: "C-de", u1: "Eins" },
  });
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  const found = checked.output.join("\n");
  expect(found).toContain("l/de.json:d.0: the source no longer has this key");
  expect(found).toContain(
    "x/messages.de.xlf:u2: Corpus cannot read this entry",
  );
  await serve(200, {
    ...PAYLOAD,
    types: { a: "ui", b: "ui", c: "ui", d: "ui", u1: "ui", u2: "ui" },
    translations: { de: { a: "A-de", c: "C-de", u1: "Eins" } },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("l/de.json")).toBe(de);
  expect(read("x/messages.de.xlf")).toBe(xde);
  // A translation for one is named and not written.
  await serve(200, {
    ...PAYLOAD,
    types: { a: "ui", b: "ui", c: "ui", d: "ui", u1: "ui", u2: "ui" },
    translations: {
      de: { a: "A-de", c: "C-de", d: "D-de", u1: "Eins", u2: "Zwei" },
    },
    minState: "untranslated",
  });
  // Saved translations a file cannot hold fail the pull (#1051).
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(1);
  expect(read("l/de.json")).toBe(de);
  expect(read("x/messages.de.xlf")).toBe(xde);
  expect(pulled.output.join("\n")).toContain(
    "l/de.json: d is held in the file in another shape than the source's; not written",
  );
  expect(pulled.output.join("\n")).toContain(
    "x/messages.de.xlf: u2 is a unit of the file Corpus cannot read; not written",
  );
  // The source's ids hold every other string: none is taken for an orphan.
  expect(pulled.output.join("\n")).not.toContain(
    "no source-language file holds",
  );
  // A source's own: refused by name, the build goes on, and exits 1.
  writeFileSync(
    path.join(repo, "l", "en.json"),
    `{ "a": "A", "b": ["B"], "c": "C" }\n`,
  );
  writeFileSync(
    path.join(repo, "x", "messages.en.xlf"),
    xlf(
      "en",
      `<unit id="u1"><segment><source>One</source></segment></unit>\n<unit id="u2"><segment><source>T</source></segment><segment><source>wo</source></segment></unit>`,
    ),
  );
  const refused = ctx();
  expect(await run(["build", "--out", out], refused)).toBe(1);
  const named = refused.output.join("\n");
  // A source's list is read by index (#1053): only the xliff unit is
  // refused.
  expect(named).not.toContain("l/en.json [b]");
  expect(named).toContain(
    "x/messages.en.xlf [u2]: invalid entry: xliff: unit u2 has 2 segments; a unit is read as one text",
  );
  // A pull still finds each string's own file.
  await serve(200, {
    ...PAYLOAD,
    types: { a: "ui", c: "ui", u1: "ui" },
    translations: { de: { a: "A-de!", c: "C-de", u1: "Eins!" } },
    minState: "untranslated",
  });
  const after = ctx();
  expect(await run(["pull"], after)).toBe(0);
  expect(after.output.join("\n")).not.toContain(
    "no source-language file holds",
  );
  expect(read("l/de.json")).toContain('"a": "A-de!"');
  expect(read("x/messages.de.xlf")).toContain("Eins!");
  // A value that is no string is skipped, and in a source said once.
  writeFileSync(
    path.join(repo, "l", "en.json"),
    `{ "a": "A", "v": null, "n": 2, "c": "C" }\n`,
  );
  const skipped = ctx();
  await run(["build", "--out", out], skipped);
  expect(skipped.output.join("\n")).toContain(
    "l/en.json: 2 value(s) are no string (a number, true, false or null) and are not read (v, n)",
  );
});

test("a target file that does not read is skipped with a note: build seeds the rest, validate fails naming it, pull leaves it as it is (#1028)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr"],
  sources: [{ adapter: "messages", type: "ui", path: "l/{lang}.json" }],
});
`,
  );
  mkdirSync(path.join(repo, "l"), { recursive: true });
  writeFileSync(path.join(repo, "l", "en.json"), `{ "a": "A", "b": "B" }\n`);
  const de = `{ "a": "A-de", "b": \n`;
  writeFileSync(path.join(repo, "l", "de.json"), de);
  writeFileSync(path.join(repo, "l", "fr.json"), `{ "a": "A-fr" }\n`);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const notes = built.output.join("\n");
  expect(notes).toMatch(
    /l\/de\.json: does not read, so none of its translations are seeded; corpus validate names it, and pull leaves it as it is \(/,
  );
  expect(notes.match(/l\/de\.json/g)).toHaveLength(1);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.seedTranslations).toEqual({ fr: { a: "A-fr" } });
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(1);
  expect(checked.output.join("\n")).toMatch(/l\/de\.json: does not read: /);
  expect(checked.output.join("\n")).toContain(
    "1 target file(s) that do not read",
  );
  await serve(200, {
    ...PAYLOAD,
    types: { a: "ui", b: "ui" },
    translations: { de: { a: "A-de!" }, fr: { a: "A-fr", b: "B-fr" } },
    minState: "untranslated",
  });
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(0);
  expect(read("l/de.json")).toBe(de);
  expect(read("l/fr.json")).toContain('"b": "B-fr"');
  expect(pulled.output.join("\n")).toMatch(
    /l\/de\.json: does not read, so pull leaves it as it is \(/,
  );
  // A proposed removal goes into the source and fr, not de.
  await serve(200, {
    ...PAYLOAD,
    types: { a: "ui", b: "ui" },
    translations: {},
    minState: "untranslated",
    sourceChanges: [{ kind: "delete", id: "b", type: "ui", file: "l/en.json" }],
  });
  const removed = ctx();
  expect(await run(["pull"], removed)).toBe(0);
  expect(read("l/de.json")).toBe(de);
  expect(read("l/en.json")).not.toContain('"b"');
  expect(read("l/fr.json")).not.toContain('"b"');
});

test("pull checks a target reads before it writes: a source that does not read fails it, an unreadable target is left whatever the writer would do, an empty one is filled (#1028)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr"],
  sources: [{ adapter: "messages", type: "ui", path: "l/{lang}.json" }],
});
`,
  );
  mkdirSync(path.join(repo, "l"), { recursive: true });
  writeFileSync(
    path.join(repo, "l", "en.json"),
    `{ "a": { "b": "AB" }, "c": "C" }\n`,
  );
  // A key written twice reads as no file, though the writer takes it.
  const de = `{ "a": { "b": "AB-de" }, "a.b": "AB2-de" }\n`;
  writeFileSync(path.join(repo, "l", "de.json"), de);
  writeFileSync(path.join(repo, "l", "fr.json"), "");
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  // An empty file is one with no translations yet, never unreadable.
  expect(built.output.join("\n")).not.toContain("l/fr.json");
  expect(built.output.join("\n")).toContain("l/de.json: does not read");
  const server = ctx();
  await serve(200, {
    ...PAYLOAD,
    types: { "a.b": "ui", c: "ui" },
    translations: { de: { c: "C-de" }, fr: { c: "C-fr" } },
    minState: "translated",
  });
  expect(await run(["validate", "--server"], server)).toBe(1);
  expect(server.output.join("\n")).toMatch(/l\/de\.json: does not read: /);
  await serve(200, {
    ...PAYLOAD,
    types: { "a.b": "ui", c: "ui" },
    translations: { de: { c: "C-de" }, fr: { c: "C-fr" } },
    minState: "untranslated",
  });
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(0);
  expect(read("l/de.json")).toBe(de);
  expect(read("l/fr.json")).toContain('"c": "C-fr"');
  // A source file that does not read fails the pull.
  writeFileSync(path.join(repo, "l", "en.json"), "{ broken");
  const failed = ctx();
  expect(await run(["pull"], failed)).toBe(1);
  expect(failed.output.join("\n")).toContain("l/en.json");
});

test("two catalogues whose keys overlap share a project when one takes a namespace: ids, seeds, validate and pull all keep them apart (#998)", async () => {
  const config = (namespaced: boolean) =>
    writeFileSync(
      path.join(repo, "corpus.config.ts"),
      `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "web/{lang}.json" },
    { adapter: "yaml", type: "server", path: "config/locales/{lang}.yml"${namespaced ? ', namespace: "server"' : ""} },
  ],
});
`,
    );
  mkdirSync(path.join(repo, "web"), { recursive: true });
  mkdirSync(path.join(repo, "config", "locales"), { recursive: true });
  writeFileSync(path.join(repo, "web", "en.json"), `{ "title": "Terms" }\n`);
  writeFileSync(
    path.join(repo, "web", "de.json"),
    `{ "title": "Bedingungen" }\n`,
  );
  writeFileSync(
    path.join(repo, "config", "locales", "en.yml"),
    "en:\n  title: Terms of service\n",
  );
  const deYml = "de:\n  title: Nutzungsbedingungen\n";
  writeFileSync(path.join(repo, "config", "locales", "de.yml"), deYml);
  config(false);
  const out = path.join(repo, "snapshot.json");
  const refused = ctx();
  expect(await run(["build", "--out", out], refused)).toBe(1);
  const said = refused.output.join("\n");
  expect(said).toContain(
    'duplicate id title in web/en.json and config/locales/en.yml; give one source a namespace, such as namespace: "web", to keep their keys apart',
  );
  // Two sources' seeds are two strings' rows, never one string's.
  expect(said).not.toContain("translated otherwise");
  config(true);
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => s.id).sort()).toEqual([
    "server:title",
    "title",
  ]);
  expect(snapshot.seedTranslations.de).toEqual({
    title: "Bedingungen",
    "server:title": "Nutzungsbedingungen",
  });
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  expect(checked.output.join("\n")).not.toContain("orphan");
  await serve(200, {
    ...PAYLOAD,
    types: { title: "ui", "server:title": "server" },
    translations: { de: { title: "Bedingungen", "server:title": "AGB" } },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("config/locales/de.yml")).toBe("de:\n  title: AGB\n");
  expect(read("web/de.json")).toBe(`{ "title": "Bedingungen" }\n`);
  // Two files' `title` are two proposals, counted so.
  await serve(200, {
    ...PAYLOAD,
    types: { title: "ui", "server:title": "server" },
    translations: { de: {} },
    minState: "untranslated",
    sourceChanges: [
      {
        kind: "edit",
        id: "title",
        type: "ui",
        file: "web/en.json",
        text: "Terms of use",
      },
      {
        kind: "edit",
        id: "server:title",
        type: "server",
        file: "config/locales/en.yml",
        text: "Terms of use",
      },
    ],
  });
  const proposed = ctx();
  expect(await run(["pull"], proposed)).toBe(0);
  expect(proposed.output.join("\n")).toContain("2 proposal(s) written");
  expect(read("config/locales/en.yml")).toBe("en:\n  title: Terms of use\n");
});

test("a source's languages bound its strings: the snapshot carries them, a file outside is not read, and pull creates none outside (#1006)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr", "ja"],
  sources: [
    { adapter: "messages", type: "ui", path: "web/{lang}.json" },
    { adapter: "messages", type: "app", path: "app/{lang}.json", namespace: "app", languages: ["ja", "de"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "web"), { recursive: true });
  mkdirSync(path.join(repo, "app"), { recursive: true });
  writeFileSync(path.join(repo, "web", "en.json"), `{ "save": "Save" }\n`);
  writeFileSync(path.join(repo, "app", "en.json"), `{ "quit": "Quit" }\n`);
  writeFileSync(path.join(repo, "app", "de.json"), `{ "quit": "Beenden" }\n`);
  // A file the set leaves out is not the source's: nothing seeds from it.
  writeFileSync(path.join(repo, "app", "fr.json"), `{ "quit": "Quitter" }\n`);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; languages?: string[] }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => [s.id, s.languages])).toEqual([
    ["save", undefined],
    ["app:quit", ["de", "ja"]],
  ]);
  expect(snapshot.seedTranslations).toEqual({ de: { "app:quit": "Beenden" } });
  expect(built.output.join("\n")).toContain(
    "1 file(s) of languages their source does not take are not read, since it takes de, ja: app/fr.json",
  );
  rmSync(path.join(repo, "app", "fr.json"));
  await serve(200, {
    ...PAYLOAD,
    types: { save: "ui", "app:quit": "app" },
    translations: {
      de: { save: "Speichern", "app:quit": "Beenden" },
      fr: { save: "Enregistrer", "app:quit": "Quitter" },
      ja: { "app:quit": "終了" },
    },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("web/fr.json")).toBe(`{ "save": "Enregistrer" }\n`);
  expect(read("app/ja.json")).toBe(`{ "quit": "終了" }\n`);
  expect(existsSync(path.join(repo, "app", "fr.json"))).toBe(false);
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  expect(checked.output.join("\n")).not.toContain("app/fr.json");
});

test("a messages source whose sourcePath is a committed target reads its keys as the text: no source file needed, no proposal, and a new language takes none of the template's text (#999)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr", "it"],
  sources: [
    { adapter: "messages", type: "ui", path: "locale/{lang}/translations.json", sourcePath: "locale/de/translations.json", keyIsText: true },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "locale", "de"), { recursive: true });
  mkdirSync(path.join(repo, "locale", "fr"), { recursive: true });
  const de = `{\n    "Save changes": "Änderungen speichern",\n    "{count} unread": "",\n    "Log out": "Abmelden"\n}\n`;
  const fr = `{\n    "Save changes": "",\n    "{count} unread": "{count} non lus",\n    "Log out": ""\n}\n`;
  writeFileSync(path.join(repo, "locale", "de", "translations.json"), de);
  writeFileSync(path.join(repo, "locale", "fr", "translations.json"), fr);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  expect(built.output.join("\n")).toContain(
    "locale/de/translations.json: its 3 key(s) are the source text, as keyIsText says, and its values are read as the translations they are",
  );
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: {
      id: string;
      source: string;
      keyIsText?: boolean;
      file?: string;
    }[];
    seedTranslations: Record<string, Record<string, string>>;
    sources?: unknown[];
  };
  // Its keys are the code's: no file takes a new string either.
  expect(snapshot.sources).toEqual([]);
  expect(
    snapshot.strings.map((s) => [s.id, s.source, s.keyIsText, s.file]),
  ).toEqual([
    ["Save changes", "Save changes", true, undefined],
    ["{count} unread", "{count} unread", true, undefined],
    ["Log out", "Log out", true, undefined],
  ]);
  expect(snapshot.seedTranslations).toEqual({
    de: { "Save changes": "Änderungen speichern", "Log out": "Abmelden" },
    fr: { "{count} unread": "{count} non lus" },
  });
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  await serve(200, {
    ...PAYLOAD,
    types: { "Save changes": "ui", "{count} unread": "ui", "Log out": "ui" },
    translations: {
      de: { "Save changes": "Änderungen speichern", "Log out": "Abmelden" },
      fr: { "{count} unread": "{count} non lus" },
      it: { "Log out": "Esci" },
    },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  // The template is written only as the target it is.
  expect(read("locale/de/translations.json")).toBe(de);
  expect(read("locale/fr/translations.json")).toBe(fr);
  expect(existsSync(path.join(repo, "locale", "en"))).toBe(false);
  // A new language takes its translations alone, none of the template's.
  expect(read("locale/it/translations.json")).toBe(
    `{\n    "Log out": "Esci"\n}\n`,
  );
});

test("a generated source takes no proposal, its strings say so, and its top-level _comment is no string; another source still takes them (#1000)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "public/locales/{lang}/grafana.json", generated: true },
    { adapter: "yaml", type: "server", path: "config/locales/{lang}.yml" },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "public", "locales", "en"), { recursive: true });
  mkdirSync(path.join(repo, "public", "locales", "de"), { recursive: true });
  mkdirSync(path.join(repo, "config", "locales"), { recursive: true });
  const enJson = `{\n  "_comment": "The code is the source of truth for English phrases.",\n  "admin": { "orgs": { "id-header": "ID" } }\n}\n`;
  const deJson = `{\n  "_comment": "Der Code ist die Quelle.",\n  "admin": { "orgs": { "id-header": "Kennung" } }\n}\n`;
  writeFileSync(
    path.join(repo, "public", "locales", "en", "grafana.json"),
    enJson,
  );
  writeFileSync(
    path.join(repo, "public", "locales", "de", "grafana.json"),
    deJson,
  );
  writeFileSync(
    path.join(repo, "config", "locales", "en.yml"),
    "en:\n  title: Terms\n",
  );
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; file?: string; generated?: string }[];
    seedTranslations: Record<string, Record<string, string>>;
    sources: { path: string }[];
  };
  expect(snapshot.strings.map((s) => [s.id, s.file, s.generated])).toEqual([
    ["admin.orgs.id-header", undefined, "public/locales/en/grafana.json"],
    ["title", "config/locales/en.yml", undefined],
  ]);
  expect(snapshot.seedTranslations).toEqual({
    de: { "admin.orgs.id-header": "Kennung" },
  });
  expect(snapshot.sources.map((s) => s.path)).toEqual([
    "config/locales/{lang}.yml",
  ]);
  const said = built.output.join("\n");
  expect(said).toContain(
    "public/locales/en/grafana.json: generated, as the config says, so its text is the code's: a proposal on its strings is refused; its top-level _comment is the extractor's note, not a string",
  );
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  expect(checked.output.join("\n")).not.toContain("_comment");
  // A proposal pending from before is not written into the generated file.
  await serve(200, {
    ...PAYLOAD,
    types: { "admin.orgs.id-header": "ui", title: "server" },
    translations: { de: { "admin.orgs.id-header": "Kennung" } },
    minState: "untranslated",
    sourceChanges: [
      {
        kind: "edit",
        id: "admin.orgs.id-header",
        type: "ui",
        file: "public/locales/en/grafana.json",
        text: "Org ID",
      },
      {
        kind: "edit",
        id: "title",
        type: "server",
        file: "config/locales/en.yml",
        text: "Terms of use",
      },
    ],
  });
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(0);
  expect(pulled.output.join("\n")).toContain(
    "public/locales/en/grafana.json is generated from the code; not written",
  );
  expect(read("public/locales/en/grafana.json")).toBe(enJson);
  expect(read("public/locales/de/grafana.json")).toBe(deJson);
  expect(read("config/locales/en.yml")).toBe("en:\n  title: Terms of use\n");
});

test("a source is generated where its file says so: values that echo their keys, Angular's computed XLIFF ids (#1000)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "locale/{lang}/translations.json" },
    { adapter: "xliff", type: "ng", path: "src/locale/messages.{lang}.xlf", sourcePath: "src/locale/messages.xlf" },
    { adapter: "messages", type: "plain", path: "plain/{lang}.json" },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "locale", "en"), { recursive: true });
  mkdirSync(path.join(repo, "src", "locale"), { recursive: true });
  mkdirSync(path.join(repo, "plain"), { recursive: true });
  writeFileSync(
    path.join(repo, "locale", "en", "translations.json"),
    JSON.stringify({
      "Editing {file_name}": "Editing {file_name}",
      "Save changes": "Save changes",
      "Log out": "Log out",
    }),
  );
  writeFileSync(
    path.join(repo, "src", "locale", "messages.xlf"),
    `<?xml version="1.0" encoding="UTF-8" ?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file source-language="en" datatype="plaintext" original="ng2.template">\n    <body>\n      <trans-unit id="4361788493219889364" datatype="html">\n        <source>Save</source>\n      </trans-unit>\n      <trans-unit id="a3b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7" datatype="html">\n        <source>Cancel</source>\n      </trans-unit>\n    </body>\n  </file>\n</xliff>\n`,
  );
  writeFileSync(
    path.join(repo, "plain", "en.json"),
    JSON.stringify({ "sign.in": "Sign in" }),
  );
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; file?: string; generated?: string }[];
    sources: { path: string }[];
  };
  expect(
    Object.fromEntries(
      snapshot.strings.map((s) => [s.id, s.generated ?? s.file]),
    ),
  ).toEqual({
    "Editing {file_name}": "locale/en/translations.json",
    "Log out": "locale/en/translations.json",
    "Save changes": "locale/en/translations.json",
    "sign.in": "plain/en.json",
    "4361788493219889364": "src/locale/messages.xlf",
    a3b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7: "src/locale/messages.xlf",
  });
  expect(
    snapshot.strings.find((s) => s.id === "Editing {file_name}"),
  ).toHaveProperty("generated");
  expect(snapshot.sources.map((s) => s.path)).toEqual(["plain/{lang}.json"]);
  const said = built.output.join("\n");
  expect(said).toContain(
    "locale/en/translations.json: generated, since every value is its key, so its text is the code's",
  );
  expect(said).toContain(
    "src/locale/messages.xlf: generated, since Angular's extract-i18n wrote it, so its text is the code's",
  );
});

test("an XLIFF is Angular's extract-i18n output by most of its ids, whatever its header; a few computed ids are not (#1000)", async () => {
  const xlf = (ids: string[], original = "app") =>
    `<?xml version="1.0" encoding="UTF-8" ?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file source-language="en" datatype="plaintext" original="${original}">\n    <body>\n${ids.map((id, i) => `      <trans-unit id="${id}">\n        <source>Text ${i}</source>\n      </trans-unit>`).join("\n")}\n    </body>\n  </file>\n</xliff>\n`;
  for (const [ids, generated, original] of [
    [["4361788493219889364", "5206857922697139278", "ngb.alert.close"], true],
    [["4361788493219889364", "routes.about", "ngb.alert.close"], false],
    // Angular's header alone says so, custom ids or not.
    [["routes.about", "ngb.alert.close"], true, "ng2.template"],
  ] as const) {
    writeFileSync(
      path.join(repo, "corpus.config.ts"),
      `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "xliff", type: "ng", path: "src/locale/messages.{lang}.xlf", sourcePath: "src/locale/messages.xlf" },
  ],
});
`,
    );
    mkdirSync(path.join(repo, "src", "locale"), { recursive: true });
    writeFileSync(
      path.join(repo, "src", "locale", "messages.xlf"),
      xlf([...ids], original),
    );
    const out = path.join(repo, "snapshot.json");
    expect(await run(["build", "--out", out], ctx())).toBe(0);
    const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
      strings: { generated?: string }[];
    };
    expect(snapshot.strings.every((s) => s.generated !== undefined)).toBe(
      generated,
    );
  }
});

test("an entry-object catalogue reads its text field as the string and its note field as the note, and pull and proposals write the text field alone (#1001)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "_locales/{lang}/messages.json", entries: { text: "messageformat", note: "description" } },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "_locales", "en"), { recursive: true });
  mkdirSync(path.join(repo, "_locales", "de"), { recursive: true });
  const en = `{
  "smartling": {
    "placeholder_format_custom": "(\\\\{\\\\w+\\\\})",
    "translate_paths": [{ "path": "*/messageformat", "instruction": "*/description" }]
  },
  "icu:Greeting": {
    "messageformat": "Hello {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  },
  "icu:Chats": {
    "messageformat": "{count, plural, one {# chat} other {# chats}}",
    "description": "The chat list's count",
    "limit": 20
  }
}
`;
  const de = `{
  "icu:Greeting": {
    "messageformat": "Hallo {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  }
}
`;
  writeFileSync(path.join(repo, "_locales", "en", "messages.json"), en);
  writeFileSync(path.join(repo, "_locales", "de", "messages.json"), de);
  const out = path.join(repo, "snapshot.json");
  const built = ctx();
  expect(await run(["build", "--out", out], built)).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; source: string; note?: string }[];
    seedTranslations: Record<string, Record<string, string>>;
  };
  expect(snapshot.strings.map((s) => [s.id, s.source, s.note])).toEqual([
    ["icu:Greeting", "Hello {name}", "Shown on the home screen"],
    [
      "icu:Chats",
      "{count, plural, one {# chat} other {# chats}}",
      "The chat list's count",
    ],
  ]);
  expect(snapshot.seedTranslations).toEqual({
    de: { "icu:Greeting": "Hallo {name}" },
  });
  expect(built.output.join("\n")).toContain(
    "_locales/en/messages.json: 1 top-level value(s) are no entry with a string messageformat and are not read (smartling)",
  );
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  // Nothing new: nothing written.
  await serve(200, {
    ...PAYLOAD,
    types: { "icu:Greeting": "ui", "icu:Chats": "ui" },
    translations: { de: { "icu:Greeting": "Hallo {name}" } },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("_locales/de/messages.json")).toBe(de);
  // A draft and a proposal each change the text field alone.
  await serve(200, {
    ...PAYLOAD,
    types: { "icu:Greeting": "ui", "icu:Chats": "ui" },
    translations: {
      de: {
        "icu:Greeting": "Servus {name}",
        "icu:Chats": "{count, plural, one {# Chat} other {# Chats}}",
      },
    },
    minState: "untranslated",
    sourceChanges: [
      {
        kind: "edit",
        id: "icu:Greeting",
        type: "ui",
        file: "_locales/en/messages.json",
        text: "Hi {name}",
      },
    ],
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("_locales/de/messages.json")).toBe(`{
  "icu:Greeting": {
    "messageformat": "Servus {name}",
    "description": "Shown on the home screen",
    "ignoreUnused": true
  },
  "icu:Chats": {
    "messageformat": "{count, plural, one {# Chat} other {# Chats}}"
  }
}
`);
  expect(read("_locales/en/messages.json")).toBe(
    en.replace('"Hello {name}"', '"Hi {name}"'),
  ); // A target value that is no entry is named and left, never mangled.
  const odd = `{\n  "icu:Greeting": "Hallo {name}"\n}\n`;
  writeFileSync(path.join(repo, "_locales", "de", "messages.json"), odd);
  const rebuilt = ctx();
  expect(await run(["build", "--out", out], rebuilt)).toBe(0);
  expect(rebuilt.output.join("\n")).toContain(
    "_locales/de/messages.json: 1 translation(s) not seeded",
  );
  await serve(200, {
    ...PAYLOAD,
    types: { "icu:Greeting": "ui", "icu:Chats": "ui" },
    translations: { de: { "icu:Greeting": "Servus {name}" } },
    minState: "untranslated",
  });
  const left = ctx();
  // A saved translation it cannot hold fails the pull (#1051).
  expect(await run(["pull"], left)).toBe(1);
  expect(left.output.join("\n")).toContain(
    "is no entry with a string messageformat in the file, which pull leaves as it is",
  );
  expect(read("_locales/de/messages.json")).toBe(odd);
});

test("a strings source reads Apple's Localizable.strings: notes, printf, seeds, a pull that changes one value, a new language, a proposal, and UTF-16 kept (#1037)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr", "ja"],
  sources: [
    { adapter: "strings", type: "ui", path: "App/{lang}.lproj/Localizable.strings" },
  ],
});
`,
  );
  for (const lang of ["en", "de", "ja"])
    mkdirSync(path.join(repo, "App", `${lang}.lproj`), { recursive: true });
  const en = `// Modules\n"CPU" = "CPU";\n/* The used part of a disk */\n"Used disk memory" = "%1$@ of %2$@ used";\n`;
  const de = `// Modules\n"CPU" = "CPU";\n"Used disk memory" = "%1$@ von %2$@ belegt";\n`;
  const ja = `"CPU" = "CPU";\n"Used disk memory" = "%2$@ 中 %1$@ 使用";\n`;
  writeFileSync(path.join(repo, "App", "en.lproj", "Localizable.strings"), en);
  writeFileSync(path.join(repo, "App", "de.lproj", "Localizable.strings"), de);
  // Xcode may write UTF-16 with a byte-order mark.
  writeFileSync(
    path.join(repo, "App", "ja.lproj", "Localizable.strings"),
    Buffer.from(`\uFEFF${ja}`, "utf16le"),
  );
  const out = path.join(repo, "snapshot.json");
  expect(await run(["build", "--out", out], ctx())).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: {
      id: string;
      source: string;
      note?: string;
      library?: string;
      file?: string;
    }[];
    seedTranslations: Record<string, Record<string, string>>;
    sources: { path: string; adapter: string }[];
  };
  expect(
    snapshot.strings.map((s) => [s.id, s.source, s.note, s.library, s.file]),
  ).toEqual([
    ["CPU", "CPU", "Modules", "printf", "App/en.lproj/Localizable.strings"],
    [
      "Used disk memory",
      "%1$@ of %2$@ used",
      "The used part of a disk",
      "printf",
      "App/en.lproj/Localizable.strings",
    ],
  ]);
  // A value left as the source's travels too; the server keeps it
  // untranslated.
  expect(snapshot.seedTranslations).toEqual({
    de: { CPU: "CPU", "Used disk memory": "%1$@ von %2$@ belegt" },
    ja: { CPU: "CPU", "Used disk memory": "%2$@ 中 %1$@ 使用" },
  });
  expect(snapshot.sources).toEqual([
    {
      path: "App/{lang}.lproj/Localizable.strings",
      adapter: "strings",
      type: "ui",
      library: "printf",
      syntax: "printf",
    },
  ]);
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(0);
  await serve(200, {
    ...PAYLOAD,
    types: { CPU: "ui", "Used disk memory": "ui" },
    translations: {
      de: { CPU: "Prozessor", "Used disk memory": "%1$@ von %2$@ belegt" },
      fr: { CPU: "Processeur" },
      ja: { CPU: "プロセッサ", "Used disk memory": "%2$@ 中 %1$@ 使用" },
    },
    minState: "untranslated",
    sourceChanges: [
      {
        kind: "edit",
        id: "Used disk memory",
        type: "ui",
        file: "App/en.lproj/Localizable.strings",
        text: "%1$@ of %2$@ in use",
      },
    ],
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("App/de.lproj/Localizable.strings")).toBe(
    de.replace('"CPU" = "CPU";', '"CPU" = "Prozessor";'),
  );
  // A new language starts as the source, every key in it.
  expect(read("App/fr.lproj/Localizable.strings")).toBe(
    en.replace('"CPU" = "CPU";', '"CPU" = "Processeur";'),
  );
  const jaBytes = readFileSync(
    path.join(repo, "App", "ja.lproj", "Localizable.strings"),
  );
  expect([...jaBytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
  expect(jaBytes.toString("utf16le")).toBe(
    `\uFEFF${ja.replace('"CPU" = "CPU";', '"CPU" = "プロセッサ";')}`,
  );
  expect(read("App/en.lproj/Localizable.strings")).toBe(
    en.replace("%1$@ of %2$@ used", "%1$@ of %2$@ in use"),
  );
});

test("a UTF-8 target stays UTF-8 beside a UTF-16 source, and only a new file takes the source's encoding (#1037)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "fr", "de"],
  sources: [
    { adapter: "strings", type: "ui", path: "App/{lang}.lproj/Localizable.strings" },
  ],
});
`,
  );
  for (const lang of ["en", "fr"])
    mkdirSync(path.join(repo, "App", `${lang}.lproj`), { recursive: true });
  writeFileSync(
    path.join(repo, "App", "en.lproj", "Localizable.strings"),
    Buffer.from(`\uFEFF"Done" = "Done";\n`, "utf16le"),
  );
  writeFileSync(
    path.join(repo, "App", "fr.lproj", "Localizable.strings"),
    `"Done" = "Fini";\n`,
  );
  await serve(200, {
    ...PAYLOAD,
    types: { Done: "ui" },
    translations: { fr: { Done: "Terminé" }, de: { Done: "Fertig" } },
    minState: "untranslated",
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("App/fr.lproj/Localizable.strings")).toBe(
    `"Done" = "Terminé";\n`,
  );
  const de = readFileSync(
    path.join(repo, "App", "de.lproj", "Localizable.strings"),
  );
  expect(de.toString("utf16le")).toBe(`\uFEFF"Done" = "Fertig";\n`);
});

test("a source's placeholders travel with its strings, and validate checks them: uBlock's {{name}} on chrome, Rocket.Chat's %s on i18next (#1049)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "cv"],
  sources: [
    { adapter: "messages", type: "ext", path: "_locales/{lang}/messages.json", library: "chrome", placeholders: ["i18next"] },
    { adapter: "messages", type: "app", path: "i18n/{lang}.json", library: "i18next", placeholders: ["printf"] },
  ],
});
`,
  );
  for (const dir of ["_locales/en", "_locales/cv", "i18n"])
    mkdirSync(path.join(repo, dir), { recursive: true });
  writeFileSync(
    path.join(repo, "_locales", "en", "messages.json"),
    JSON.stringify({
      stats: {
        message: "{{used}} used out of {{total}}",
        description: "Stats",
      },
      hello: {
        message: "Hello $USER$",
        placeholders: { user: { content: "$1" } },
      },
    }),
  );
  writeFileSync(
    path.join(repo, "_locales", "cv", "messages.json"),
    JSON.stringify({ stats: { message: "{{used}} усă курăнать" } }),
  );
  writeFileSync(
    path.join(repo, "i18n", "en.json"),
    JSON.stringify({
      push: "Your push was sent to %s devices",
      hi: "Hi {{name}}",
    }),
  );
  writeFileSync(
    path.join(repo, "i18n", "cv.json"),
    JSON.stringify({ push: "Тĕкĕм ярса панă", hi: "Салам {{name}}" }),
  );
  const out = path.join(repo, "snapshot.json");
  expect(await run(["build", "--out", out], ctx())).toBe(0);
  const snapshot = JSON.parse(readFileSync(out, "utf8")) as {
    strings: { id: string; library?: string; placeholders?: string[] }[];
  };
  expect(
    snapshot.strings.map((s) => [s.id, s.library, s.placeholders]),
  ).toEqual([
    ["stats", "chrome", ["i18next"]],
    ["hello", "chrome", ["i18next"]],
    ["push", "i18next", ["printf"]],
    ["hi", "i18next", ["printf"]],
  ]);
  const checked = ctx();
  expect(await run(["validate"], checked)).toBe(1);
  const said = checked.output.join("\n");
  expect(said).toContain("_locales/cv/messages.json:stats: missing {{total}}");
  expect(said).toContain("i18n/cv.json:push: missing %s");
  expect(said).not.toContain(":hi:");
});

test("a translation a writer refuses is named, the rest are written, and pull and --check exit 1 (#1051)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de", "fr"],
  sources: [{ adapter: "gettext", type: "ui", path: "po/{lang}.po", sourcePath: "po/app.pot" }],
});
`,
  );
  mkdirSync(path.join(repo, "po"), { recursive: true });
  const po = (language: string, plural: string) =>
    `msgid ""\nmsgstr ""\n"Language: ${language}\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "Open"\nmsgstr ""\n\nmsgid "%d file"\nmsgid_plural "%d files"\n${plural}`;
  writeFileSync(
    path.join(repo, "po", "app.pot"),
    po("", 'msgstr[0] ""\nmsgstr[1] ""\n'),
  );
  const de = po("de", 'msgstr[0] ""\nmsgstr[1] ""\n');
  writeFileSync(path.join(repo, "po", "de.po"), de);
  writeFileSync(
    path.join(repo, "po", "fr.po"),
    po("fr", 'msgstr[0] ""\nmsgstr[1] ""\n'),
  );
  const payload = {
    ...PAYLOAD,
    types: { Open: "ui", "%d file": "ui" },
    minState: "translated",
    translations: {
      // Text beside the plural: gettext cannot hold it.
      de: {
        Open: "Öffnen",
        "%d file": "Frei: {count, plural, one {%d Datei} other {%d Dateien}}",
      },
      fr: { Open: "Ouvrir" },
    },
  };
  await serve(200, payload);
  const check = ctx();
  expect(await run(["pull", "--check"], check)).toBe(1);
  expect(check.output.join("\n")).toContain(
    "corpus: 1 translation(s) could not be written, each named above with why",
  );
  const c = ctx();
  expect(await run(["pull", "--min-state", "translated"], c)).toBe(1);
  const said = c.output.join("\n");
  expect(said).toMatch(/po\/de\.po: %d file is a plural .*; not written/);
  expect(said).toContain(
    "corpus: 1 translation(s) could not be written, each named above with why",
  );
  // The rest are written: de's Open, and fr.
  expect(read("po/de.po")).toContain('msgid "Open"\nmsgstr "Öffnen"');
  expect(read("po/fr.po")).toContain('msgid "Open"\nmsgstr "Ouvrir"');
  // With every file current, the refusal alone fails the check.
  const again = ctx();
  expect(await run(["pull", "--check"], again)).toBe(1);
  expect(again.output.join("\n")).toContain("0 file(s) would change");
  // Nothing refused, exit 0.
  await serve(200, {
    ...payload,
    translations: { de: { Open: "Öffnen" }, fr: { Open: "Ouvrir" } },
  });
  expect(await run(["pull", "--min-state", "translated"], ctx())).toBe(0);
});

test("an android plural with an =N branch is named and not written, and fails the pull (#1055)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [{ adapter: "android", type: "ui", path: "res" }],
});
`,
  );
  mkdirSync(path.join(repo, "res", "values"), { recursive: true });
  mkdirSync(path.join(repo, "res", "values-de"), { recursive: true });
  writeFileSync(
    path.join(repo, "res", "values", "strings.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="title">Rooms</string>
    <plurals name="rooms">
        <item quantity="one">%d room</item>
        <item quantity="other">%d rooms</item>
    </plurals>
</resources>
`,
  );
  const de = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="title">Räume</string>
    <plurals name="rooms">
        <item quantity="one">%d Raum</item>
        <item quantity="other">%d Räume</item>
    </plurals>
</resources>
`;
  writeFileSync(path.join(repo, "res", "values-de", "strings.xml"), de);
  await serve(200, {
    ...PAYLOAD,
    types: { title: "ui", rooms: "ui" },
    translations: {
      de: {
        title: "Zimmer",
        rooms: "{quantity, plural, =0 {keine} one {%d Raum} other {%d Räume}}",
      },
    },
  });
  const pulled = ctx();
  expect(await run(["pull"], pulled)).toBe(1);
  const said = pulled.output.join("\n");
  expect(said).toContain(
    "corpus: res/values-de/strings.xml: rooms is a plural a <plurals> cannot hold (an =N branch, or a key that is no plural category); not written",
  );
  expect(said).toContain(
    "corpus: 1 translation(s) could not be written, each named above with why",
  );
  expect(read("res/values-de/strings.xml")).toBe(
    de.replace(">Räume</string>", ">Zimmer</string>"),
  );
});

test("a target's id only another pattern's source holds is not seeded, and a pull leaves every file as it was (#1071)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["a/{lang}.json", "b/{lang}.json"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "a"));
  mkdirSync(path.join(repo, "b"));
  writeFileSync(path.join(repo, "a", "en.json"), `{\n  "stay": "Stay"\n}\n`);
  writeFileSync(path.join(repo, "b", "en.json"), `{\n  "moved": "Moved"\n}\n`);
  // a's German still translates the id that moved to b.
  const aDe = `{\n  "stay": "Bleiben",\n  "moved": "Verschoben"\n}\n`;
  const bDe = `{}\n`;
  writeFileSync(path.join(repo, "a", "de.json"), aDe);
  writeFileSync(path.join(repo, "b", "de.json"), bDe);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations).toEqual({ de: { stay: "Bleiben" } });
  await serve(200, {
    ...PAYLOAD,
    types: { stay: "chrome", moved: "chrome" },
    translations: snapshot.seedTranslations,
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("a/de.json")).toBe(aDe);
  expect(read("b/de.json")).toBe(bDe);
  // validate calls a's copy what it is.
  const v = ctx();
  await run(["validate"], v);
  expect(v.output.join("\n")).toMatch(/a\/de\.json.*moved/);
});

test("a target's id only another source holds is not seeded either (#1071)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "chrome", path: "a/{lang}.json" },
    { adapter: "messages", type: "chrome", path: "b/{lang}.json" },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "a"));
  mkdirSync(path.join(repo, "b"));
  writeFileSync(path.join(repo, "a", "en.json"), `{\n  "stay": "Stay"\n}\n`);
  writeFileSync(path.join(repo, "b", "en.json"), `{\n  "moved": "Moved"\n}\n`);
  const aDe = `{\n  "stay": "Bleiben",\n  "moved": "Verschoben"\n}\n`;
  writeFileSync(path.join(repo, "a", "de.json"), aDe);
  writeFileSync(path.join(repo, "b", "de.json"), `{}\n`);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations).toEqual({ de: { stay: "Bleiben" } });
  await serve(200, {
    ...PAYLOAD,
    types: { stay: "chrome", moved: "chrome" },
    translations: snapshot.seedTranslations,
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("a/de.json")).toBe(aDe);
  expect(read("b/de.json")).toBe(`{}\n`);
});

test("a pattern whose source file holds no string seeds nothing (#1071 review)", async () => {
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    `import { defineCorpus } from "@corpus/contract";
export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "chrome", path: ["a/{lang}.json", "b/{lang}.json"] },
  ],
});
`,
  );
  mkdirSync(path.join(repo, "a"));
  mkdirSync(path.join(repo, "b"));
  // Every string of a moved to b.
  writeFileSync(path.join(repo, "a", "en.json"), `{}\n`);
  writeFileSync(path.join(repo, "b", "en.json"), `{\n  "moved": "Moved"\n}\n`);
  writeFileSync(
    path.join(repo, "a", "de.json"),
    `{\n  "moved": "Verschoben"\n}\n`,
  );
  writeFileSync(path.join(repo, "b", "de.json"), `{}\n`);
  const { buildSnapshot } = await import("./build");
  const { loadConfig } = await import("./config");
  const snapshot = await buildSnapshot(await loadConfig(repo), repo);
  expect(snapshot.seedTranslations ?? {}).toEqual({});
  await serve(200, {
    ...PAYLOAD,
    types: { moved: "chrome" },
    translations: snapshot.seedTranslations ?? {},
  });
  expect(await run(["pull"], ctx())).toBe(0);
  expect(read("b/de.json")).toBe(`{}\n`);
});
