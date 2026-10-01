import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  corpusConfigSchema,
  defineCorpus,
  snapshotSchema,
  type CorpusConfig,
} from "@corpus/contract";
import { expect, test } from "vitest";
import {
  buildSnapshot,
  describeExecFailure,
  EXEC_MAX_BUFFER,
  buildSnapshotReport,
  deprecations,
  describeRefused,
  pushOnlyNotes,
  writableSources,
  fileOf,
  type FileSource,
} from "./build";
import { expandSources } from "./config";

const REPO = fileURLToPath(new URL("../test/fixtures/repo", import.meta.url));

function config(
  overrides: Partial<Parameters<typeof defineCorpus>[0]> = {},
): CorpusConfig {
  return expandSources(
    defineCorpus({
      project: "fixture-project",
      server: "https://corpus.example",
      sourceLanguage: "en",
      languages: ["en", "pt-PT"],
      sources: [
        { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
        {
          adapter: "table",
          type: "tutorial-step",
          path: "steps.ts",
          map: { id: "id", text: "text" },
        },
      ],
      ...overrides,
    }),
    REPO,
  );
}

test("builds a valid snapshot from messages + table sources", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot.project).toBe("fixture-project");
  const ids = snapshot.strings.map((s) => s.id);
  expect(ids).toEqual(["app.title", "greeting", "step-1", "step-2"]);
});

test("messages resolve {lang} to the source language", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  const greeting = snapshot.strings.find((s) => s.id === "greeting");
  expect(greeting?.source).toBe("Olá {name}");
  expect(greeting?.type).toBe("chrome");
});

test("table unmapped fields become metadata", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  const step = snapshot.strings.find((s) => s.id === "step-1");
  expect(step?.metadata).toEqual({ scene: "intro" });
});

test("a duplicate id across sources errors naming both sources", async () => {
  const dup = config({
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
      {
        adapter: "table",
        type: "t",
        path: "collide.ts",
        map: { id: "id", text: "text" },
      },
    ],
  });
  await expect(buildSnapshot(dup, REPO)).rejects.toThrow(
    /duplicate id.*app\.title/s,
  );
});

test("invalid ICU in a source errors with the file path and key", async () => {
  const bad = config({
    sources: [{ adapter: "messages", type: "chrome", path: "bad/{lang}.json" }],
  });
  await expect(buildSnapshot(bad, REPO)).rejects.toThrow(
    /bad\/en\.json.*broken/s,
  );
});

test("a source that does not parse is refused by entry and the rest is built", async () => {
  const bad = config({
    sources: [{ adapter: "messages", type: "chrome", path: "bad/{lang}.json" }],
  });
  const { snapshot, refused } = await buildSnapshotReport(bad, REPO);
  expect(snapshot.strings.map((s) => s.id)).toEqual(["fine"]);
  expect(refused).toEqual([
    {
      file: "bad/en.json",
      id: "broken",
      hint: expect.any(String),
      message: expect.stringMatching(/^invalid ICU: /),
    },
  ]);
  const good = await buildSnapshotReport(config(), REPO);
  expect(good.refused).toEqual([]);
});

test("a tag that does not close is refused with a hint at what a tag is", async () => {
  const { refused, snapshot } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "chrome", path: "tags/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(refused.map((r) => `${r.id}: ${r.message}`)).toEqual([
    "prose: invalid ICU: unclosed <baseurl>; a <name> is a rich-text tag: close it with </baseurl>, or write the brackets so they do not open a tag",
    "mismatched: invalid ICU: unexpected </b>; <a> is open; a <name> is a rich-text tag: <a> is open here, so write </a>, or remove both tags",
    "plural: invalid ICU: unclosed <b>; a <name> is a rich-text tag: close it with </b>, or write the brackets so they do not open a tag",
    "stray: invalid ICU: unexpected </em>; a <name> is a rich-text tag: remove it, or open a matching <em>",
  ]);
  // The good entries outnumber the bad, so the file is four typos
  // rather than a file read the wrong way (#491).
  expect(snapshot.strings.map((s) => s.id)).toEqual([
    "fine",
    "ok-one",
    "ok-two",
    "ok-three",
    "ok-four",
  ]);
});

test("an i18next catalogue read as ICU is refused with a hint at the library", async () => {
  // Two refusals is a typo's shape, so the build goes on and the hint
  // rides on the entries; it takes five of one cause to stop it (#491).
  const { refused } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "ui", path: "i18next/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(refused).toHaveLength(2);
  expect(refused[0]?.message).toMatch(/declare library: "i18next"/);
});

test("a file whose every entry is refused fails the build, with no snapshot", async () => {
  // #491: pushing the rest would archive every refused id, and a
  // pending proposal on an archived string is superseded for good.
  await expect(
    buildSnapshotReport(
      config({
        sources: [
          { adapter: "messages", type: "chrome", path: "allbad/{lang}.json" },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(
    /allbad\/en\.json: every string in the file was refused \(2\)/,
  );
});

test("one bad entry among four still pushes the three", async () => {
  const { snapshot, refused } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "chrome", path: "onebad/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(snapshot.strings.map((s) => s.id)).toEqual(["one", "two", "three"]);
  expect(refused.map((r) => r.id)).toEqual(["bad"]);
});

test("many refusals with one cause stop the build, at any share of the file", async () => {
  // The shape that catches a real project: Outline read as ICU refuses
  // a fifth of its catalogue, which no per-file share would notice,
  // while nearly every refusal gives the same advice. This fixture is
  // 5 of 60, so it fails for the cause and not for the proportion.
  const building = buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "ui", path: "manyi18next/{lang}.json" },
      ],
    }),
    REPO,
  );
  await expect(building).rejects.toThrow(
    '5 strings were refused for the library they were read under, at or past the 5 that stops a build: one cause — {{ }} is i18next\'s interpolation: declare library: "i18next" on the source',
  );
});

test("an ICU catalogue read as i18next is told which library it is", async () => {
  // The mirror of the i18next hint, which had no test and has been
  // wrong twice: an ICU select or plural whose branch opens with a
  // placeholder holds `{{`, which the i18next reader refuses, so those
  // strings drop and every other one pushes.
  const building = buildSnapshotReport(
    config({
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "manyicu/{lang}.json",
          library: "i18next",
        },
      ],
    }),
    REPO,
  );
  await expect(building).rejects.toThrow(/declare library: "icu"/);
  await expect(building).rejects.toThrow(/5 strings were refused/);
});

test("refusals are counted per cause: two library advices are one cause, five tags are one, four and one are two (#549)", async () => {
  // A catalogue read as vue holding four ICU plurals and one i18next
  // interpolation: two advices, one cause, and the summary names it.
  const split = buildSnapshotReport(
    config({
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "splithint/{lang}.json",
          library: "vue",
        },
      ],
    }),
    REPO,
  );
  await expect(split).rejects.toThrow(
    /5 strings were refused for the library they were read under, at or past the 5 that stops a build: one cause, whichever advice each drew; each refusal above says which library to declare/,
  );
  // Five different tags left open in five strings are one cause.
  const tags = buildSnapshotReport(
    config({
      sources: [{ adapter: "messages", type: "ui", path: "tags5/{lang}.json" }],
    }),
    REPO,
  );
  await expect(tags).rejects.toThrow(
    /5 strings were refused for a rich-text tag written as prose, at or past the 5 that stops a build: one cause; each refusal above says how to write it/,
  );
  // Four i18next interpolations under ICU and one tag are two causes:
  // the build goes on, with the five refused. (vue has no tags, #644.)
  const mixed = await buildSnapshotReport(
    config({
      sources: [{ adapter: "messages", type: "ui", path: "mixed/{lang}.json" }],
    }),
    REPO,
  );
  expect(mixed.refused).toHaveLength(5);
  expect(mixed.snapshot.strings).toHaveLength(3);
});

test("an exporter past 1 MiB builds, and one past the cap or killed is named (#554)", async () => {
  const { snapshot } = await buildSnapshotReport(
    config({
      sources: [{ adapter: "exec", command: "node export-big.mjs" }],
    }),
    REPO,
  );
  expect(snapshot.strings.map((s) => s.id)).toEqual(["big.one"]);
  expect(
    describeExecFailure("node x.mjs", {
      // Node sets SIGTERM beside ENOBUFS, so the cap must be named first.
      status: null,
      signal: "SIGTERM",
      stderr: "",
      error: Object.assign(new Error("spawnSync ENOBUFS"), { code: "ENOBUFS" }),
    }),
  ).toBe(
    `exec "node x.mjs" printed more than ${EXEC_MAX_BUFFER / 1048576} MiB; the build reads an exporter's whole output at once`,
  );
  expect(
    describeExecFailure("node x.mjs", {
      status: null,
      signal: "SIGKILL",
      stderr: "",
    }),
  ).toBe('exec "node x.mjs" was killed by SIGKILL');
  expect(
    describeExecFailure("node x.mjs", {
      status: 2,
      signal: null,
      stderr: "boom\n",
    }),
  ).toBe('exec "node x.mjs" exited 2: boom');
});

test("a Chrome i18n file reads as Chrome under library chrome, BOM and all, and as nesting without it (#595)", async () => {
  const source = (library?: "chrome") =>
    config({
      languages: ["en"],
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "_locales/{lang}/messages.json",
          ...(library && { library }),
        },
      ],
    });
  const chrome = await buildSnapshot(source("chrome"), REPO);
  expect(chrome.strings).toEqual([
    expect.objectContaining({
      id: "copied",
      source: "Copied $ITEM$",
      note: "After a copy.",
      library: "chrome",
      examples: [{ values: { item: "a login" }, rendered: "Copied a login" }],
    }),
  ]);
  const plain = await buildSnapshot(source(), REPO);
  expect(plain.strings.map((s) => s.id)).toContain("copied.message");
});

test("an empty value under a sentence key is the key as text: no file on the entry, a note in the report (#589)", async () => {
  const keyed = config({
    languages: ["en", "pt"],
    sources: [{ adapter: "messages", type: "ui", path: "keyed/{lang}.json" }],
  });
  const { snapshot, refused, notes } = await buildSnapshotReport(keyed, REPO);
  expect(refused).toEqual([]);
  const byId = new Map(snapshot.strings.map((s) => [s.id, s]));
  expect(byId.get("{amount} off")).toMatchObject({
    source: "{amount} off",
    keyIsText: true,
  });
  expect(byId.get("{amount} off")).not.toHaveProperty("file");
  expect(byId.get("{count} month_one")).toMatchObject({
    source: "{count} month",
    file: "keyed/en.json",
  });
  expect(byId.get("{count} month_one")).not.toHaveProperty("keyIsText");
  expect(byId.get("ui.empty")).toMatchObject({
    source: "",
    file: "keyed/en.json",
  });
  expect(notes).toEqual([
    "keyed/en.json: 2 string(s) have an empty value and take the key as the text; a proposal on them is refused, since the text is the key",
  ]);
  // The Portuguese file seeds against the key: nothing is identical.
  expect(snapshot.seedTranslations?.pt).toMatchObject({
    "{amount} off": "{amount} de desconto",
    "Sign in": "Entrar",
  });
  // Through a {ns} pattern the prefixed entry keeps the mark: still no file.
  const namespaced = config({
    languages: ["en", "pt"],
    sources: [
      { adapter: "messages", type: "ui", path: "keyedns/{ns}/{lang}.json" },
    ],
  });
  const ns = await buildSnapshotReport(namespaced, REPO);
  const keyedNs = ns.snapshot.strings.find(
    (s) => s.id === "portal:{amount} off",
  );
  expect(keyedNs).toMatchObject({ source: "{amount} off", keyIsText: true });
  expect(keyedNs).not.toHaveProperty("file");
});

test("an .arb catalogue reads as JSON, its @ entries as metadata, and writes back (#558)", async () => {
  const arb = config({
    sources: [
      { adapter: "messages", type: "ui", path: "arb/strings_{lang}.arb" },
    ],
  });
  const { snapshot, refused } = await buildSnapshotReport(arb, REPO);
  expect(refused).toEqual([]);
  expect(snapshot.strings.map((s) => s.id)).toEqual([
    "wallpaper",
    "photosCount",
  ]);
  expect(snapshot.strings[1]?.source).toBe(
    "{count, plural, one {# photo} other {# photos}}",
  );
  expect(writableSources(arb).map((s) => s.path)).toEqual([
    "arb/strings_{lang}.arb",
  ]);
});

test("a {ns} pattern is one source per namespace, its ids prefixed ns:, and an array is one source per pattern (#513)", async () => {
  const ns = config({
    sources: [{ adapter: "messages", type: "ui", path: "ns/{lang}/{ns}.json" }],
  });
  expect(ns.sources.map((s) => (s.adapter === "exec" ? "" : s.path))).toEqual([
    "ns/{lang}/admin.json",
    "ns/{lang}/common.json",
  ]);
  const { snapshot, refused } = await buildSnapshotReport(ns, REPO);
  expect(refused).toEqual([]);
  // `title` in both files is two strings, not a collision.
  expect(snapshot.strings.map((s) => s.id).sort()).toEqual([
    "admin:title",
    "admin:users",
    "common:greeting",
    "common:title",
  ]);
  expect(snapshot.strings.find((s) => s.id === "admin:title")?.file).toBe(
    "ns/en/admin.json",
  );
  expect(writableSources(ns).map((s) => [s.path, s.namespace])).toEqual([
    ["ns/{lang}/admin.json", "admin"],
    ["ns/{lang}/common.json", "common"],
  ]);

  // Two patterns share the source's type and library; a duplicate id
  // across them is the existing error naming both files.
  const both = config({
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: ["i18n/{lang}.json", "ns/{lang}/admin.json"],
        library: "icu",
      },
    ],
  });
  expect(both.sources).toHaveLength(2);
  const built = await buildSnapshotReport(both, REPO);
  expect(built.snapshot.strings.some((s) => s.id === "users")).toBe(true);
  expect(built.snapshot.strings.some((s) => s.id === "greeting")).toBe(true);
  const clash = config({
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: ["ns/{lang}/common.json", "ns/{lang}/admin.json"],
      },
    ],
  });
  await expect(buildSnapshotReport(clash, REPO)).rejects.toThrow(
    /duplicate id title in ns\/en\/common\.json and ns\/en\/admin\.json/,
  );
  // The owner's case: a file per component, sometimes nested. {ns} spans
  // the segments between the literals and never past them.
  const comp = config({
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "comp/src/{ns}/i18n/{lang}.json",
      },
    ],
  });
  expect(
    comp.sources.map((s) => (s.adapter === "exec" ? "" : s.namespace)),
  ).toEqual(["Button", "Card/Header"]);
  const built2 = await buildSnapshotReport(comp, REPO);
  expect(built2.snapshot.strings.map((s) => s.id).sort()).toEqual([
    "Button:save",
    "Card/Header:save",
  ]);
  // The same file through two patterns is named once.
  expect(() =>
    config({
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: ["ns/{lang}/{ns}.json", "ns/{lang}/common.json"],
        },
      ],
    }),
  ).toThrow(/ns\/en\/common\.json is named twice/);
  // A {ns} pattern that nothing fills is named.
  expect(() =>
    config({
      sources: [
        { adapter: "messages", type: "ui", path: "nowhere/{lang}/{ns}.json" },
      ],
    }),
  ).toThrow(/matches no file for en: nothing fills \{ns\}/);
});

test("a file that does not read still fails the whole build", async () => {
  const missing = config({
    sources: [
      { adapter: "messages", type: "chrome", path: "nowhere/{lang}.json" },
    ],
  });
  await expect(buildSnapshotReport(missing, REPO)).rejects.toThrow(
    /nowhere\/en\.json/,
  );
});

test("the config's string and entity type declarations travel in the snapshot", async () => {
  const declared = config({
    stringTypes: {
      chrome: {
        tone: {
          type: "enum",
          description: "How the line reads.",
          values: ["plain", "urgent"],
        },
      },
    },
    entityTypes: { room: { label: "Room" } },
  });
  const snapshot = await buildSnapshot(declared, REPO);
  expect(snapshot.stringTypes).toEqual(declared.stringTypes);
  expect(snapshot.entityTypes).toEqual(declared.entityTypes);
  const bare = await buildSnapshot(config(), REPO);
  expect("stringTypes" in bare).toBe(false);
  // Type notes travel too, and are always sent so a push replaces them.
  const noted = await buildSnapshot(
    config({ typeNotes: { chrome: "Short and plain." } }),
    REPO,
  );
  expect(noted.typeNotes).toEqual({ chrome: "Short and plain." });
  expect(bare.typeNotes).toEqual({});
  // As are the types read as HTML (#622), always sent so a push clears one.
  const html = await buildSnapshot(
    config({ richText: { chrome: "html" } }),
    REPO,
  );
  expect(html.richText).toEqual({ chrome: "html" });
  expect(bare.richText).toEqual({});
  expect(bare.glossary).toEqual({});
});

test("a table source reads a named export and carries only the listed metadata", async () => {
  const snapshot = await buildSnapshot(
    config({
      sources: [
        {
          adapter: "table",
          type: "tutorial-step",
          path: "steps-named.ts",
          export: "TUTORIAL_STEPS",
          map: { id: "id", text: "text", metadata: ["scene"] },
        },
      ],
    }),
    REPO,
  );
  expect(snapshot.strings.map((s) => s.metadata)).toEqual([
    { scene: "intro" },
    { scene: "intro" },
  ]);
});

test("table errors name the file and the export", async () => {
  await expect(
    buildSnapshot(
      config({
        sources: [
          {
            adapter: "table",
            type: "tutorial-step",
            path: "steps-named.ts",
            map: { id: "id", text: "text" },
          },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(/steps-named\.ts: table: expected an array of records/);
  await expect(
    buildSnapshot(
      config({
        sources: [
          {
            adapter: "table",
            type: "tutorial-step",
            path: "steps-named.ts",
            export: "STEPS",
            map: { id: "id", text: "text" },
          },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(/steps-named\.ts: the module has no export named "STEPS"/);
});

test("a JSON table cannot name an export", async () => {
  await expect(
    buildSnapshot(
      config({
        sources: [
          {
            adapter: "table",
            type: "step",
            path: "i18n/en.json",
            export: "STEPS",
            map: { id: "id", text: "text" },
          },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(
    /i18n\/en\.json: a JSON file has no exports; drop export "STEPS"/,
  );
});

test("entries carry the file they were read from and the snapshot its writable sources", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  const byId = Object.fromEntries(snapshot.strings.map((s) => [s.id, s.file]));
  expect(byId["app.title"]).toBe("i18n/en.json");
  // steps.ts is not JSON: pull cannot write it, so its entries carry no
  // file and a proposal on them is refused up front (§4).
  expect(byId["step-1"]).toBeUndefined();
  expect("file" in snapshot.strings.find((s) => s.id === "step-1")!).toBe(
    false,
  );
  expect(snapshot.sources).toEqual([
    { path: "i18n/{lang}.json", adapter: "messages", type: "chrome" },
  ]);
});

test("writableSources: not exec, a .json path, {lang} not required", () => {
  const sources = writableSources(
    config({
      sources: [
        { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
        {
          adapter: "table",
          type: "step",
          path: "steps.json",
          map: { id: "id", text: "text" },
        },
        {
          adapter: "table",
          type: "row",
          path: "data/rows.{lang}.JSON",
          map: { id: "id", text: "text" },
        },
        {
          adapter: "table",
          type: "ts",
          path: "steps.ts",
          map: { id: "id", text: "text" },
        },
        { adapter: "messages", type: "js", path: "i18n/{lang}.js" },
        { adapter: "exec", command: "node x.mjs" },
      ],
    }),
  );
  expect(sources).toEqual([
    { path: "i18n/{lang}.json", adapter: "messages", type: "chrome" },
    { path: "steps.json", adapter: "table", type: "step" },
    { path: "data/rows.{lang}.JSON", adapter: "table", type: "row" },
  ]);
});

test("a snapshot with nothing writable carries an empty sources list", async () => {
  const snapshot = await buildSnapshot(
    config({
      sources: [
        {
          adapter: "table",
          type: "tutorial-step",
          path: "steps.ts",
          map: { id: "id", text: "text" },
        },
      ],
    }),
    REPO,
  );
  expect(snapshot.sources).toEqual([]);
});

test("the glossary file of every target language travels; absent is empty, malformed is a build error", async () => {
  const withFiles = await buildSnapshot(
    config({
      languages: ["en", "pt-PT", "fr"],
      glossary: { path: "i18n/glossary.{lang}.json" },
    }),
    REPO,
  );
  expect(withFiles.glossary).toEqual({
    "pt-PT": [{ term: "greeting", target: "saudação", note: "the noun" }],
    fr: [],
  });
  await expect(
    buildSnapshot(
      config({
        languages: ["en", "de"],
        glossary: { path: "i18n/glossary.{lang}.json" },
      }),
      REPO,
    ),
  ).rejects.toThrow(/i18n\/glossary\.de\.json: not a glossary: 0\.target/);
  expect(() => config({ glossary: { path: "i18n/glossary.json" } })).toThrow(
    /\{lang\}/,
  );
});

test("existing target-language catalogues travel as seeds; a missing one is nothing, a broken one an error", async () => {
  const snapshot = await buildSnapshot(config(), REPO);
  // An empty value (greeting) and a key the source lacks (gone.key) do
  // not travel.
  expect(snapshot.seedTranslations).toEqual({
    "pt-PT": { "app.title": "Corpus" },
  });
  const none = await buildSnapshot(config({ languages: ["en", "fr"] }), REPO);
  expect("seedTranslations" in none).toBe(false);
  await expect(
    buildSnapshot(
      config({
        sources: [
          { adapter: "messages", type: "chrome", path: "seeded/{lang}.json" },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(
    /seeded\/pt-PT\.json: messages: value at a must be a string/,
  );
});

test("a source with the i18next syntax pushes {{name}} strings, each entry carrying the syntax", async () => {
  const snapshot = await buildSnapshot(
    config({
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "i18next/{lang}.json",
          syntax: "i18next",
        },
      ],
    }),
    REPO,
  );
  expect(snapshot.strings.map((s) => s.syntax)).toEqual([
    "i18next",
    "i18next",
    "i18next",
  ]);
  expect(snapshot.sources).toEqual([
    {
      path: "i18next/{lang}.json",
      adapter: "messages",
      type: "ui",
      // Both names until 1.0 (§4): an older server reads `syntax`.
      library: "i18next",
      syntax: "i18next",
    },
  ]);
  // The same file read as ICU is refused, so the syntax is what admits it.
  await expect(
    buildSnapshot(
      config({
        sources: [
          { adapter: "messages", type: "ui", path: "i18next/{lang}.json" },
        ],
      }),
      REPO,
    ),
  ).rejects.toThrow(/invalid ICU/);
});

test("a config that still says syntax builds the same and is named once", async () => {
  const old = config({
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "i18next/{lang}.json",
        syntax: "i18next",
      },
    ],
  });
  const { snapshot } = await buildSnapshotReport(old, REPO);
  expect(snapshot.strings[0]).toMatchObject({
    library: "i18next",
    syntax: "i18next",
  });
  expect(deprecations(old)).toEqual([
    "syntax is the old name for library, on i18next/{lang}.json; it goes at 1.0",
  ]);
  expect(
    deprecations(
      config({
        sources: [
          {
            adapter: "messages",
            type: "ui",
            path: "i18next/{lang}.json",
            library: "i18next",
          },
        ],
      }),
    ),
  ).toEqual([]);
});

test("a <br></br> pair builds under icu, a lone <br> is refused there, and an HTML type takes either (#643)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-br-"));
  mkdirSync(path.join(dir, "i18n"));
  writeFileSync(
    path.join(dir, "i18n", "en.json"),
    JSON.stringify({
      pair: "Scroll<br></br>to zoom",
      lone: "Scroll<br>to zoom",
    }),
  );
  const at = (richText?: Record<string, "html">) =>
    config({
      languages: ["en"],
      sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }],
      ...(richText && { richText }),
    });
  const plain = await buildSnapshotReport(at(), dir);
  expect(plain.snapshot.strings.map((s) => s.id)).toEqual(["pair"]);
  expect(plain.refused).toEqual([
    expect.objectContaining({
      id: "lone",
      message: expect.stringContaining("unclosed <br>"),
    }),
  ]);
  const html = await buildSnapshotReport(at({ ui: "html" }), dir);
  expect(html.snapshot.strings.map((s) => s.id).sort()).toEqual([
    "lone",
    "pair",
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("a catalogue no adapter reads is refused by its format, a Qt .ts told from TypeScript (#647)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-format-"));
  mkdirSync(path.join(dir, "i18n"));
  writeFileSync(path.join(dir, "i18n", "en.po"), 'msgid "a"\nmsgstr "A"\n');
  writeFileSync(
    path.join(dir, "i18n", "app_en.ts"),
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"></TS>\n',
  );
  const at = (file: string) =>
    config({
      languages: ["en"],
      sources: [{ adapter: "messages", type: "ui", path: `i18n/${file}` }],
    });
  await expect(buildSnapshot(at("{lang}.po"), dir)).rejects.toThrow(
    /i18n\/en\.po: a gettext catalogue: declare it \{ adapter: "gettext"/,
  );
  await expect(buildSnapshot(at("app_{lang}.ts"), dir)).rejects.toThrow(
    /i18n\/app_en\.ts: a Qt Linguist catalogue/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("a refused id with a newline prints on one line (#648)", () => {
  expect(
    describeRefused({
      file: "po.json",
      id: "Line one\nline two",
      message: "m",
      hint: "",
    }),
  ).toBe("po.json [Line one\\nline two]: m");
});

test("an id in two files of one source is one string when its text is the same; otherwise an error (#661)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-merged-"));
  mkdirSync(path.join(dir, "app"));
  mkdirSync(path.join(dir, "shared"));
  writeFileSync(
    path.join(dir, "app", "en.json"),
    JSON.stringify({ save: "Save", title: "Element" }),
  );
  writeFileSync(
    path.join(dir, "shared", "en.json"),
    JSON.stringify({ save: "Save", close: "Close" }),
  );
  const merged = config({
    languages: ["en"],
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: ["app/{lang}.json", "shared/{lang}.json"],
      },
    ],
  });
  const snapshot = await buildSnapshot(merged, dir);
  expect(snapshot.strings.map((s) => s.id).sort()).toEqual([
    "close",
    "save",
    "title",
  ]);
  // Two target files that disagree on a shared string fail the build:
  // a pull could keep only one.
  writeFileSync(
    path.join(dir, "app", "pt.json"),
    JSON.stringify({ save: "Guardar" }),
  );
  writeFileSync(
    path.join(dir, "shared", "pt.json"),
    JSON.stringify({ save: "Salvar" }),
  );
  await expect(
    buildSnapshot(config({ ...merged, languages: ["en", "pt"] }), dir),
  ).rejects.toThrow(
    /shared\/pt\.json: save is translated otherwise in app\/pt\.json/,
  );
  // A group written in the config merges nothing.
  await expect(
    buildSnapshot(
      config({
        languages: ["en"],
        sources: [
          {
            adapter: "messages",
            type: "ui",
            path: "app/{lang}.json",
            group: 0,
          },
          {
            adapter: "messages",
            type: "ui",
            path: "shared/{lang}.json",
            group: 0,
          },
        ] as never,
      }),
      dir,
    ),
  ).rejects.toThrow(
    /duplicate id save in app\/en\.json and shared\/en\.json$/m,
  );
  writeFileSync(
    path.join(dir, "shared", "en.json"),
    JSON.stringify({ save: "Save changes" }),
  );
  await expect(buildSnapshot(merged, dir)).rejects.toThrow(
    /duplicate id save in app\/en\.json and shared\/en\.json, with different text/,
  );
  // Two sources are two catalogues: a shared id is still an error.
  writeFileSync(
    path.join(dir, "shared", "en.json"),
    JSON.stringify({ save: "Save" }),
  );
  await expect(
    buildSnapshot(
      config({
        languages: ["en"],
        sources: [
          { adapter: "messages", type: "ui", path: "app/{lang}.json" },
          { adapter: "messages", type: "ui", path: "shared/{lang}.json" },
        ],
      }),
      dir,
    ),
  ).rejects.toThrow(
    /duplicate id save in app\/en\.json and shared\/en\.json$/m,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("an Element-shaped catalogue builds under counterpart with nothing refused (#663)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-counterpart-"));
  mkdirSync(path.join(dir, "i18n"));
  writeFileSync(
    path.join(dir, "i18n", "en.json"),
    JSON.stringify({
      invite: "Invite <pill> to %(roomName)s",
      bold: "You are <b>admin</b>",
      empty: "Replace <empty string> with {text}",
      rooms: { one: "%(count)s room", other: "%(count)s rooms" },
    }),
  );
  const report = await buildSnapshotReport(
    config({
      languages: ["en"],
      sources: [
        {
          adapter: "messages",
          type: "ui",
          library: "counterpart",
          path: "i18n/{lang}.json",
        },
      ],
    }),
    dir,
  );
  expect(report.refused).toEqual([]);
  expect(report.snapshot.strings.map((s) => s.id).sort()).toEqual([
    "bold",
    "empty",
    "invite",
    "rooms",
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("an xliff source reads Angular's files: units, states, the source file apart (#710)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-xliff-"));
  mkdirSync(path.join(dir, "locale"));
  const unit = (id: string, source: string, target?: string) =>
    `      <trans-unit id="${id}" datatype="html">
        <source>${source}</source>${target ?? ""}
      </trans-unit>`;
  const file = (units: string[], target?: string) =>
    `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en"${target ? ` target-language="${target}"` : ""} datatype="plaintext" original="ng2.template">
    <body>
${units.join("\n")}
    </body>
  </file>
</xliff>
`;
  const link = (text: string) =>
    `<x id="START_LINK" ctype="x-a" equiv-text="&lt;a&gt;"/>${text}<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/>`;
  writeFileSync(
    path.join(dir, "locale", "messages.xlf"),
    file([
      unit("signIn", `Sign in with ${link("Google")}`),
      unit("status", "Status"),
      unit("later", "Later"),
    ]),
  );
  writeFileSync(
    path.join(dir, "locale", "messages.de.xlf"),
    file(
      [
        unit(
          "signIn",
          `Sign in with ${link("Google")}`,
          `\n        <target state="translated">Mit ${link("Google")} anmelden</target>`,
        ),
        unit(
          "status",
          "Status",
          `\n        <target state="final">Status</target>`,
        ),
        unit("later", "Later", `\n        <target state="new">Later</target>`),
      ],
      "de",
    ),
  );
  const cfg = config({
    languages: ["en", "de"],
    sources: [
      {
        adapter: "xliff",
        type: "ui",
        path: "locale/messages.{lang}.xlf",
        sourcePath: "locale/messages.xlf",
      },
    ],
  });
  const report = await buildSnapshotReport(cfg, dir);
  expect(report.refused).toEqual([]);
  expect(report.snapshot.strings.map((s) => [s.id, s.source])).toEqual([
    ["signIn", "Sign in with <LINK>Google</LINK>"],
    ["status", "Status"],
    ["later", "Later"],
  ]);
  expect(report.snapshot.seedTranslations).toEqual({
    de: { signIn: "Mit <LINK>Google</LINK> anmelden", status: "Status" },
  });
  // Status in German is a loanword the file marks final: translated.
  expect(report.snapshot.seedTranslated).toEqual({ de: ["status"] });
  expect(pushOnlyNotes(cfg)).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("a gettext source reads a .pot and its .po files: msgids, fuzzy rows, plural forms (#718)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-gettext-"));
  mkdirSync(path.join(dir, "locales"));
  writeFileSync(
    path.join(dir, "locales", "app.pot"),
    `msgid ""\nmsgstr ""\n\nmsgid "Joplin"\nmsgstr ""\n\nmsgid "Delete %s?"\nmsgstr ""\n\nmsgid "Blank"\nmsgstr ""\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] ""\nmsgstr[1] ""\n`,
  );
  writeFileSync(
    path.join(dir, "locales", "ru.po"),
    `msgid ""\nmsgstr ""\n"Language: ru\\n"\n"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"\n\nmsgid "Joplin"\nmsgstr "Joplin"\n\n#, fuzzy\nmsgid "Delete %s?"\nmsgstr "Удалить?"\n\n#, fuzzy\nmsgid "Blank"\nmsgstr "   "\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d заметка"\nmsgstr[1] "%d заметки"\nmsgstr[2] "%d заметок"\n`,
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "ru"],
      sources: [
        {
          adapter: "gettext",
          type: "ui",
          path: "locales/{lang}.po",
          sourcePath: "locales/app.pot",
        },
      ],
    }),
    dir,
  );
  expect(report.refused).toEqual([]);
  expect(
    report.snapshot.strings.map((s) => [s.id, s.source, s.library]),
  ).toEqual([
    ["Joplin", "Joplin", "printf"],
    ["Delete %s?", "Delete %s?", "printf"],
    ["Blank", "Blank", "printf"],
    ["%d note", "{count, plural, one {%d note} other {%d notes}}", "printf"],
  ]);
  // The fuzzy row is not seeded; the identical translation is marked.
  expect(report.snapshot.seedTranslations).toEqual({
    ru: {
      Joplin: "Joplin",
      "%d note":
        "{count, plural, one {%d заметка} few {%d заметки} many {%d заметок} other {%d заметок}}",
    },
  });
  expect(report.snapshot.seedTranslated).toEqual({ ru: ["Joplin"] });
  // The fuzzy row travels as a suggestion, and the build says so (#721).
  expect(report.snapshot.seedSuggestions).toEqual({
    ru: { "Delete %s?": "Удалить?" },
  });
  expect(report.notes).toContain(
    "ru 1 fuzzy row(s) carried as suggestions, not translations",
  );
  rmSync(dir, { recursive: true, force: true });
});

test("an xcstrings source reads one String Catalog for every language; only translated units seed (#727)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-xcstrings-"));
  const unit = (value: string, state = "translated") => ({
    stringUnit: { state, value },
  });
  writeFileSync(
    path.join(dir, "Localizable.xcstrings"),
    JSON.stringify({
      sourceLanguage: "en",
      strings: {
        OK: { localizations: { de: unit("OK"), fr: unit("D'accord") } },
        "timeline.new-posts %lld": {
          localizations: {
            en: {
              variations: {
                plural: {
                  one: unit("%lld new post"),
                  other: unit("%lld new posts"),
                },
              },
            },
            de: {
              variations: {
                plural: {
                  one: unit("%lld neuer Beitrag"),
                  other: unit("%lld neue Beiträge"),
                },
              },
            },
            fr: unit("%lld nouveaux", "needs_review"),
          },
        },
      },
      version: "1.0",
    }),
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "de", "fr"],
      sources: [
        { adapter: "xcstrings", type: "ui", path: "Localizable.xcstrings" },
      ],
    }),
    dir,
  );
  expect(report.refused).toEqual([]);
  expect(report.notes.join("\n")).not.toMatch(/empty value/);
  expect(
    report.snapshot.strings.map((s) => [
      s.id,
      s.source,
      s.library,
      s.keyIsText,
    ]),
  ).toEqual([
    ["OK", "OK", "printf", true],
    [
      "timeline.new-posts %lld",
      "{count, plural, one {%lld new post} other {%lld new posts}}",
      "printf",
      undefined,
    ],
  ]);
  expect(report.snapshot.seedTranslations).toEqual({
    de: {
      OK: "OK",
      "timeline.new-posts %lld":
        "{count, plural, one {%lld neuer Beitrag} other {%lld neue Beiträge}}",
    },
    fr: { OK: "D'accord" },
  });
  expect(report.snapshot.seedTranslated).toEqual({ de: ["OK"] });
  const xc = config({
    sources: [
      { adapter: "xcstrings", type: "ui", path: "Localizable.xcstrings" },
    ],
  });
  // Pull writes it back (#728), and no proposal reaches it.
  expect(pushOnlyNotes(xc)).toEqual([]);
  expect(writableSources(xc)).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("a qt-ts source reads the template and each language's finished translations under qt (#740)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-qtts-"));
  mkdirSync(path.join(dir, "lang"));
  const file = (language: string, translation: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1"${language ? ` language="${language}"` : ""}>\n<context>\n    <name>MainWindow</name>\n    <message>\n        <source>OK</source>\n        ${translation.replace("%", "OK")}\n    </message>\n    <message>\n        <source>Transfers (%1)</source>\n        ${translation.replace("%", "Transferências (%1)")}\n    </message>\n</context>\n</TS>\n`;
  writeFileSync(
    path.join(dir, "lang", "app_en.ts"),
    file("", '<translation type="unfinished"></translation>'),
  );
  writeFileSync(
    path.join(dir, "lang", "app_sr@latin.ts"),
    file("sr@latin", "<translation>%</translation>"),
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "sr-Latn"],
      sources: [
        {
          adapter: "qt-ts",
          type: "ui",
          path: "lang/app_{lang}.ts",
          languageFiles: { "sr-Latn": "sr@latin" },
        },
      ],
    }),
    dir,
  );
  expect(report.refused).toEqual([]);
  expect(
    report.snapshot.strings.map((s) => [s.id, s.source, s.library]),
  ).toEqual([
    ["MainWindow | OK", "OK", "qt"],
    ["MainWindow | Transfers (%1)", "Transfers (%1)", "qt"],
  ]);
  expect(report.snapshot.seedTranslations).toEqual({
    "sr-Latn": {
      "MainWindow | OK": "OK",
      "MainWindow | Transfers (%1)": "Transferências (%1)",
    },
  });
  expect(report.snapshot.seedTranslated).toEqual({
    "sr-Latn": ["MainWindow | OK"],
  });
  // Qt's source text is the code's tr() literal: no proposal on it.
  expect(report.snapshot.strings.every((s) => s.file === undefined)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("a yaml source reads Rails catalogues: the root key is the file's code, _MF keys stay ICU (#752)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-yaml-"));
  mkdirSync(path.join(dir, "locales"));
  writeFileSync(
    path.join(dir, "locales", "client.en.yml"),
    'en:\n  js:\n    deny: "Cancel"\n    hello: "Hello %{name}"\n    count_MF: "{n, plural, one {# item} other {# items}}"\n',
  );
  writeFileSync(
    path.join(dir, "locales", "client.pt_BR.yml"),
    'pt_BR:\n  js:\n    deny: "Cancelar"\n    hello: "Olá %{nome}"\n',
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "pt-BR"],
      sources: [
        {
          adapter: "yaml",
          type: "ui",
          path: "locales/client.{lang}.yml",
          languageFiles: { "pt-BR": "pt_BR" },
        },
      ],
    }),
    dir,
  );
  expect(report.refused).toEqual([]);
  expect(report.snapshot.strings.map((s) => [s.id, s.library])).toEqual([
    ["js.deny", "rails"],
    ["js.hello", "rails"],
    ["js.count_MF", "icu"],
  ]);
  expect(report.snapshot.seedTranslations).toEqual({
    "pt-BR": { "js.deny": "Cancelar", "js.hello": "Olá %{nome}" },
  });
  expect(
    pushOnlyNotes(
      config({
        sources: [{ adapter: "yaml", type: "ui", path: "l/{lang}.yml" }],
      }),
    ),
  ).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("a {ns} pattern with no {lang} builds, each file's ids prefixed (#930)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-nsonly-"));
  mkdirSync(path.join(dir, "strings"));
  writeFileSync(
    path.join(dir, "strings", "app.json"),
    JSON.stringify([{ id: "hello", text: "Hello" }]),
  );
  writeFileSync(
    path.join(dir, "strings", "web.json"),
    JSON.stringify([{ id: "bye", text: "Bye" }]),
  );
  const cfg = expandSources(
    defineCorpus({
      project: "p",
      server: "https://corpus.example",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [
        {
          adapter: "table",
          type: "ui",
          path: "strings/{ns}.json",
          map: { id: "id", text: "text" },
        },
      ],
    }),
    dir,
  );
  const { snapshot, refused } = await buildSnapshotReport(cfg, dir);
  expect(refused).toEqual([]);
  expect(snapshot.strings.map((s) => s.id).sort()).toEqual([
    "app:hello",
    "web:bye",
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("a target object or hash without other is a plural only where the source file holds one, never at a source string that is an ICU plural (#950 review)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-950-"));
  mkdirSync(path.join(dir, "locales"));
  writeFileSync(
    path.join(dir, "locales", "en.yml"),
    'en:\n  files_MF: "{count, plural, one {# file} other {# files}}"\n  rooms:\n    one: "%{count} room"\n    other: "%{count} rooms"\n',
  );
  writeFileSync(
    path.join(dir, "locales", "pl.yml"),
    'pl:\n  files_MF:\n    one: "# plik"\n    few: "# pliki"\n  rooms:\n    one: "%{count} pokój"\n    few: "%{count} pokoje"\n',
  );
  mkdirSync(path.join(dir, "i18n"));
  writeFileSync(
    path.join(dir, "i18n", "en.json"),
    '{\n  "files": "{count, plural, one {# file} other {# files}}",\n  "rooms": { "one": "{count} room", "other": "{count} rooms" }\n}\n',
  );
  writeFileSync(
    path.join(dir, "i18n", "pl.json"),
    '{\n  "files": { "one": "# plik", "few": "# pliki" },\n  "rooms": { "one": "{count} pokój", "few": "{count} pokoje" }\n}\n',
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "pl"],
      sources: [
        { adapter: "yaml", type: "ui", path: "locales/{lang}.yml" },
        {
          adapter: "messages",
          type: "ui",
          library: "icu",
          path: "i18n/{lang}.json",
          namespace: "web",
        },
      ],
    }),
    dir,
  );
  expect(report.snapshot.seedTranslations?.pl).toEqual({
    rooms: "{count, plural, one {%{count} pokój} few {%{count} pokoje}}",
    "web:rooms": "{count, plural, one {{count} pokój} few {{count} pokoje}}",
  });
  rmSync(dir, { recursive: true, force: true });
});

test("a source file that will not read is named once, never thrown from the seeds' read (#950 review)", async () => {
  for (const [adapter, file, body] of [
    ["messages", "en.json", '{\n  "r": {\n'],
    ["yaml", "en.yml", "en:\n  r: [\n"],
  ] as const) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-950b-"));
    writeFileSync(path.join(dir, file), body);
    writeFileSync(
      path.join(dir, file.replace("en", "pl")),
      adapter === "yaml" ? "pl:\n  r: R\n" : '{ "r": "R" }\n',
    );
    await expect(
      buildSnapshotReport(
        config({
          sourceLanguage: "en",
          languages: ["en", "pl"],
          sources: [
            adapter === "yaml"
              ? { adapter, type: "ui", path: "{lang}.yml" }
              : {
                  adapter,
                  type: "ui",
                  library: "counterpart",
                  path: "{lang}.json",
                },
          ],
        }),
        dir,
      ),
      adapter,
    ).rejects.toThrow(
      new RegExp(`^snapshot build failed:\n  ${file.replace(".", "\\.")}: `),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a gettext plural string carries the categories each target file's Plural-Forms picks, where they are not CLDR's (#951)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-951-"));
  mkdirSync(path.join(dir, "locales"));
  writeFileSync(
    path.join(dir, "locales", "app.pot"),
    `msgid ""\nmsgstr ""\n\nmsgid "Joplin"\nmsgstr ""\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] ""\nmsgstr[1] ""\n`,
  );
  writeFileSync(
    path.join(dir, "locales", "it.po"),
    `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d nota"\nmsgstr[1] "%d note"\n`,
  );
  writeFileSync(
    path.join(dir, "locales", "de.po"),
    `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n`,
  );
  // A Czech file with no Plural-Forms is read in CLDR's order.
  writeFileSync(
    path.join(dir, "locales", "cs.po"),
    `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d poznámka"\nmsgstr[1] "%d poznámky"\nmsgstr[2] "%d poznámky"\nmsgstr[3] "%d poznámek"\n`,
  );
  writeFileSync(
    path.join(dir, "locales", "oc.po"),
    `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n`,
  );
  const report = await buildSnapshotReport(
    config({
      sourceLanguage: "en",
      languages: ["en", "it", "de", "fr", "oc", "cs"],
      sources: [
        {
          adapter: "gettext",
          type: "ui",
          path: "locales/{lang}.po",
          sourcePath: "locales/app.pot",
        },
      ],
    }),
    dir,
  );
  // German's file is CLDR's; French has none yet, and pull writes its
  // table's, CLDR's too; Occitan has no plural data in the runtime, so
  // nothing is enforced; Italian's leaves out many.
  expect(report.snapshot.strings.map((s) => [s.id, s.pluralForms])).toEqual([
    ["Joplin", undefined],
    ["%d note", { it: ["one", "other"] }],
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test("a refused string a type read as HTML would take names the declaration, once per type (#952)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-952-"));
  writeFileSync(
    path.join(dir, "en.json"),
    '{ "a": "One<br>two", "b": "<p>Welcome", "c": "fine", "d": "{broken" }\n',
  );
  const at = (richText?: Record<string, "html">) =>
    config({
      languages: ["en"],
      sources: [{ adapter: "messages", type: "ui", path: "{lang}.json" }],
      ...(richText && { richText }),
    });
  const plain = await buildSnapshotReport(at(), dir);
  expect(plain.refused.map((r) => r.id).sort()).toEqual(["a", "b", "d"]);
  expect(plain.notes.filter((n) => /richText/.test(n))).toEqual([
    '2 refused ui string(s) hold tags a type read as HTML takes as text, an unclosed tag or a lone <br>: if the app renders ui as HTML, declare richText: { ui: "html" } in the config',
  ]);
  const html = await buildSnapshotReport(at({ ui: "html" }), dir);
  expect(html.refused.map((r) => r.id)).toEqual(["d"]);
  expect(html.notes.filter((n) => /richText/.test(n))).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

test("under merge: last-wins a source text two files hold otherwise is the later file's, and said (#953)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-953-"));
  mkdirSync(path.join(dir, "app"));
  mkdirSync(path.join(dir, "shared"));
  writeFileSync(path.join(dir, "app", "en.json"), '{ "save": "Save" }');
  writeFileSync(path.join(dir, "shared", "en.json"), '{ "save": "Save it" }');
  const at = (merge?: "last-wins") =>
    config({
      languages: ["en"],
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: ["app/{lang}.json", "shared/{lang}.json"],
          ...(merge && { merge }),
        },
      ],
    });
  await expect(buildSnapshot(at(), dir)).rejects.toThrow(
    /duplicate id save in app\/en\.json and shared\/en\.json, with different text/,
  );
  const report = await buildSnapshotReport(at("last-wins"), dir);
  expect(report.snapshot.strings.map((s) => [s.id, s.source, s.file])).toEqual([
    ["save", "Save it", "shared/en.json"],
  ]);
  expect(report.notes.join("\n")).toMatch(
    /save reads otherwise in app\/en\.json and shared\/en\.json: the later file's is the source/,
  );
  rmSync(dir, { recursive: true, force: true });
});

test("a Rails catalogue's plurals take rails-i18n's keys where Gemfile.lock lists the gem, CLDR's without it or where the app rules its own (#983)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-983-"));
  mkdirSync(path.join(dir, "config", "locales"), { recursive: true });
  const yml = (code: string) =>
    `${code}:\n  files:\n    one: "%{count} file"\n    other: "%{count} files"\n  hello: Hello\n  hello_MF: "{n, plural, one {# x} other {# y}}"\n`;
  for (const code of ["en", "fr", "cs", "ja", "pt-BR", "pt-PT", "zh_CN"])
    writeFileSync(
      path.join(dir, "config", "locales", `${code}.yml`),
      yml(code),
    );
  const build = () =>
    buildSnapshotReport(
      config({
        sourceLanguage: "en",
        languages: ["en", "fr", "cs", "ja", "pt-BR", "pt-PT", "zh-CN"],
        sources: [
          {
            adapter: "yaml",
            type: "ui",
            path: "config/locales/{lang}.yml",
            languageFiles: { "zh-CN": "zh_CN" },
          },
        ],
      }),
      dir,
    );
  const formsOf = async () => {
    const report = await build();
    const byId = new Map(report.snapshot.strings.map((s) => [s.id, s]));
    return {
      report,
      files: byId.get("files")?.pluralForms,
      mf: byId.get("hello_MF")?.pluralForms,
    };
  };
  // No Gemfile.lock: CLDR, as before.
  expect((await formsOf()).files).toBeUndefined();
  writeFileSync(
    path.join(dir, "Gemfile.lock"),
    "GEM\n  remote: https://rubygems.org/\n  specs:\n    i18n (1.15.2)\n    rails-i18n (8.1.0)\n      i18n (>= 0.7, < 2)\n\nDEPENDENCIES\n  rails-i18n (~> 8.0)\n",
  );
  const { report, files, mf } = await formsOf();
  // ja's keys are CLDR's, so it carries none; zh_CN, which the gem
  // spells zh-CN, takes I18n's own one and other.
  expect(files).toEqual({
    fr: ["one", "other"],
    cs: ["one", "few", "other"],
    "pt-BR": ["one", "other"],
    // The gem has no pt-PT: its parent pt's rule.
    "pt-PT": ["one", "other"],
    "zh-CN": ["one", "other"],
  });
  // A `*_MF` key is ICU, read by CLDR's rule.
  expect(mf).toBeUndefined();
  expect(report.notes).toContain(
    "plural rules: rails-i18n 8.1.0 (Gemfile.lock), read from Corpus's table of 8.1.0",
  );
  // An initializer's rule of its own: CLDR's stands in, and build says so.
  mkdirSync(path.join(dir, "config", "initializers"));
  writeFileSync(
    path.join(dir, "config", "initializers", "i18n_pluralization.rb"),
    "rule = ->(_count) { :other }\nI18n.backend.store_translations(:zh_CN, i18n: { plural: { rule: rule } })\n",
  );
  const ruled = await formsOf();
  expect(ruled.files?.["zh-CN"]).toBeUndefined();
  expect(ruled.report.notes.join("\n")).toContain(
    "zh_CN takes a rule the app stores (config/initializers/i18n_pluralization.rb), which Corpus cannot run, so CLDR's stands in",
  );
  // Without parentheses over several lines, and in config/locales/*.rb.
  writeFileSync(
    path.join(dir, "config", "initializers", "i18n_pluralization.rb"),
    'I18n.backend.store_translations :"pt-BR",\n  i18n: {\n    plural: { rule: ->(n) { :other } }\n  }\n',
  );
  writeFileSync(
    path.join(dir, "config", "locales", "plurals.rb"),
    "{ :fr => { :i18n => { :plural => { :keys => [:one, :other], :rule => lambda { |n| :other } } } } }\n",
  );
  // A call with no rule beside one with: the rule is the second's.
  writeFileSync(
    path.join(dir, "config", "initializers", "greetings.rb"),
    'I18n.backend.store_translations(:cs, greeting: "Ahoj")\nI18n.backend.store_translations(:ja, i18n: { plural: { rule: r } })\n',
  );
  // A parent's rule reaches a locale with none of its own, never one the
  // gem rules: pt's leaves pt-BR at rails-i18n's.
  const parent = path.join(dir, "config", "initializers", "pt.rb");
  writeFileSync(
    parent,
    "I18n.backend.store_translations(:pt, i18n: { plural: { rule: r } })\n",
  );
  const more = await formsOf();
  expect(more.files?.cs).toEqual(["one", "few", "other"]);
  // pt-BR's own rule, the app's, above; pt-PT has none, so pt's.
  expect(more.files?.["pt-BR"]).toBeUndefined();
  expect(more.files?.["pt-PT"]).toBeUndefined();
  rmSync(path.join(dir, "config", "initializers", "i18n_pluralization.rb"));
  expect((await formsOf()).files?.["pt-BR"]).toEqual(["one", "other"]);
  rmSync(parent);
  expect(more.files?.fr).toBeUndefined();
  expect(more.files?.["zh-CN"]).toEqual(["one", "other"]);
  rmSync(dir, { recursive: true, force: true });
});

test("a source language languageFiles maps is read from its file, and proposals are placed there (#994)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-994-"));
  mkdirSync(path.join(dir, "i18n"));
  writeFileSync(path.join(dir, "i18n", "english.json"), '{ "hi": "Hello" }\n');
  writeFileSync(path.join(dir, "i18n", "de.json"), '{ "hi": "Hallo" }\n');
  const config = expandSources(
    corpusConfigSchema.parse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "i18n/{lang}.json",
          languageFiles: { en: "english" },
        },
      ],
    }),
    dir,
  );
  const { snapshot } = await buildSnapshotReport(config, dir);
  expect(snapshot.strings).toEqual([
    expect.objectContaining({
      id: "hi",
      source: "Hello",
      file: "i18n/english.json",
    }),
  ]);
  expect(snapshot.seedTranslations).toEqual({ de: { hi: "Hallo" } });
  expect(snapshot.sources).toEqual([
    expect.objectContaining({ path: "i18n/english.json" }),
  ]);
});

test("an Android language with a region reads each module's directory for it, or its language's, as Android resolves them (#1007)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-1007-"));
  const strings = (text: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="hi">${text}</string>\n</resources>\n`;
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), strings(text));
  };
  put("a/res/values/strings.xml", "Hi");
  put("a/res/values-ta/strings.xml", "வணக்கம் a");
  put("a/res/values-nb-rNO/strings.xml", "Hei a");
  put("b/res/values/strings.xml", "Hi");
  put("b/res/values-ta-rIN/strings.xml", "வணக்கம் b");
  put("b/res/values-nb/strings.xml", "Hei b");
  const config = (languages: string[]) =>
    expandSources(
      corpusConfigSchema.parse({
        project: "p",
        server: "http://localhost:3000",
        sourceLanguage: "en",
        languages,
        sources: [
          {
            adapter: "android",
            type: "ui",
            path: ["a/res", "b/res"],
            merge: "last-wins",
          },
        ],
      }),
      dir,
    );
  const { snapshot } = await buildSnapshotReport(
    config(["en", "ta-IN", "nb-NO"]),
    dir,
  );
  expect(snapshot.seedTranslations).toEqual({
    "ta-IN": { hi: "வணக்கம் b" },
    "nb-NO": { hi: "Hei b" },
  });
  // Each module's own directory is where a pull writes.
  const [a, b] = config(["en", "ta-IN", "nb-NO"]).sources as FileSource[];
  expect(fileOf(a!, "ta-IN", "en")).toBe("a/res/values-ta/strings.xml");
  expect(fileOf(b!, "ta-IN", "en")).toBe("b/res/values-ta-rIN/strings.xml");
  expect(fileOf(b!, "nb-NO", "en")).toBe("b/res/values-nb/strings.xml");
  // Listing the language itself keeps the two apart.
  const [a2] = config(["en", "ta", "ta-IN"]).sources as FileSource[];
  expect(fileOf(a2!, "ta-IN", "en")).toBe("a/res/values-ta-rIN/strings.xml");
  expect(fileOf(a2!, "ta", "en")).toBe("a/res/values-ta/strings.xml");
});

test("an Android language falls back to its language's directory only where that is the same language, alone in the config (#1007)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-1007-"));
  for (const qualifier of ["", "-en", "-pt", "-zh", "-sr", "-pa", "-es"]) {
    mkdirSync(path.join(dir, `res/values${qualifier}`), { recursive: true });
    writeFileSync(
      path.join(dir, `res/values${qualifier}/strings.xml`),
      "<resources/>\n",
    );
  }
  const [source] = expandSources(
    corpusConfigSchema.parse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: [
        "en",
        "en-GB",
        "pt-BR",
        "pt-PT",
        "zh-CN",
        "zh-TW",
        "sr-Latn",
        "pa-PK",
        "es-419",
      ],
      sources: [
        {
          adapter: "android",
          type: "ui",
          path: "res",
          languageDirs: { "pt-BR": "values-pt" },
        },
      ],
    }),
    dir,
  ).sources as FileSource[];
  // Two variants of one language would share its file; a pull of one
  // would write over the other.
  expect(fileOf(source!, "pt-BR", "en")).toBe("res/values-pt-rBR/strings.xml");
  expect(fileOf(source!, "pt-PT", "en")).toBe("res/values-pt-rPT/strings.xml");
  // An English device reads `values-en` before `values`: it is the
  // source language's too.
  expect(fileOf(source!, "en-GB", "en")).toBe("res/values-en-rGB/strings.xml");
  // Android matches the script: `values-zh` is Simplified, `values-sr`
  // Cyrillic, `values-pa` Gurmukhi.
  expect(fileOf(source!, "zh-TW", "en")).toBe("res/values-zh-rTW/strings.xml");
  // zh-TW never reads `values-zh`, so zh-CN shares it with nothing.
  expect(fileOf(source!, "zh-CN", "en")).toBe("res/values-zh/strings.xml");
  expect(fileOf(source!, "sr-Latn", "en")).toBe(
    "res/values-b+sr+Latn/strings.xml",
  );
  expect(fileOf(source!, "pa-PK", "en")).toBe("res/values-pa-rPK/strings.xml");
  expect(fileOf(source!, "es-419", "en")).toBe("res/values-es/strings.xml");
});
