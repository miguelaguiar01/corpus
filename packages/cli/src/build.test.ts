import { fileURLToPath } from "node:url";
import {
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
  writableSources,
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
  // Four ICU arguments under vue and one tag are two causes: the build
  // goes on, with the five refused.
  const mixed = await buildSnapshotReport(
    config({
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: "mixed/{lang}.json",
          library: "vue",
        },
      ],
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
  expect(writableSources(ns).map((s) => s.path)).toEqual([
    "ns/{lang}/admin.json",
    "ns/{lang}/common.json",
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
