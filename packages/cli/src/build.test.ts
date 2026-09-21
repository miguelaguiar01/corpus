import { fileURLToPath } from "node:url";
import {
  defineCorpus,
  snapshotSchema,
  type CorpusConfig,
} from "@corpus/contract";
import { expect, test } from "vitest";
import { buildSnapshot, buildSnapshotReport, writableSources } from "./build";

const REPO = fileURLToPath(new URL("../test/fixtures/repo", import.meta.url));

function config(
  overrides: Partial<Parameters<typeof defineCorpus>[0]> = {},
): CorpusConfig {
  return defineCorpus({
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
  });
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
      message: expect.stringMatching(/^invalid ICU: /),
    },
  ]);
  const good = await buildSnapshotReport(config(), REPO);
  expect(good.refused).toEqual([]);
});

test("a tag that does not close is refused with a hint at what a tag is", async () => {
  const { refused } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "chrome", path: "tags/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(refused.map((r) => `${r.id}: ${r.message}`)).toEqual([
    "prose: invalid ICU: unclosed <baseurl>; a <name> is a rich-text tag: close it with </baseurl>, or write the brackets so they do not open a tag",
    "mismatched: invalid ICU: unexpected </b>; <a> is open; a <name> is a rich-text tag: it closes <a>, so write </a> here, or remove it",
    "plural: invalid ICU: unclosed <b>; a <name> is a rich-text tag: close it with </b>, or write the brackets so they do not open a tag",
    "stray: invalid ICU: unexpected </em>; a <name> is a rich-text tag: remove it, or open a matching <em>",
  ]);
  const { snapshot } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "chrome", path: "tags/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(snapshot.strings.map((s) => s.id)).toEqual(["fine"]);
});

test("an i18next catalogue read as ICU is refused with a hint at the syntax declaration", async () => {
  const { refused } = await buildSnapshotReport(
    config({
      sources: [
        { adapter: "messages", type: "ui", path: "i18next/{lang}.json" },
      ],
    }),
    REPO,
  );
  expect(refused.length).toBeGreaterThan(0);
  expect(refused[0]?.message).toMatch(/declare syntax: "i18next"/);
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
