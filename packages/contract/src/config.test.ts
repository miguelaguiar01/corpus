import { expect, test } from "vitest";
import { corpusConfigSchema, defineCorpus } from "./config";

test("the §3 example config validates and round-trips", () => {
  const config = defineCorpus({
    project: "moonlight-manor",
    server: "https://corpus.example",
    sourceLanguage: "pt-PT",
    languages: ["pt-PT", "en"],
    stringTypes: {
      "clue-skin": {
        kind: { type: "enum", description: "d", values: ["sighting"] },
      },
    },
    entityTypes: { trait: { label: "Trait" } },
    sources: [
      {
        adapter: "messages",
        type: "chrome",
        path: "src/i18n/messages.{lang}.json",
      },
      {
        adapter: "table",
        type: "tutorial-step",
        path: "src/tutorial/steps.ts",
        map: { id: "id", text: "text" },
      },
      { adapter: "exec", command: "npx tsx scripts/corpus-export.ts" },
    ],
  });
  expect(config.project).toBe("moonlight-manor");
  expect(config.sources).toHaveLength(3);
});

test("stringTypes and entityTypes are optional", () => {
  const config = defineCorpus({
    project: "p",
    server: "s",
    sourceLanguage: "en",
    languages: ["en"],
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    ],
  });
  expect(config.stringTypes).toBeUndefined();
});

test.each([
  ["unknown adapter kind", { adapter: "grep", type: "t", path: "x" }],
  ["table without a map", { adapter: "table", type: "t", path: "x.ts" }],
  [
    "table map missing text",
    { adapter: "table", type: "t", path: "x.ts", map: { id: "id" } },
  ],
  [
    "messages path without {lang}",
    { adapter: "messages", type: "t", path: "src/i18n/messages.json" },
  ],
  ["exec without a command", { adapter: "exec" }],
])("rejects a source with %s", (_label, source) => {
  expect(() =>
    defineCorpus({
      project: "p",
      server: "s",
      sourceLanguage: "en",
      languages: ["en"],
      sources: [source as never],
    }),
  ).toThrow();
});

test("rejects languages that do not include the source language", () => {
  expect(() =>
    defineCorpus({
      project: "p",
      server: "s",
      sourceLanguage: "pt-PT",
      languages: ["en"],
      sources: [{ adapter: "exec", command: "x" }],
    }),
  ).toThrow(/sourceLanguage/);
});

test("rejects a config with no sources", () => {
  expect(() =>
    defineCorpus({
      project: "p",
      server: "s",
      sourceLanguage: "en",
      languages: ["en"],
      sources: [],
    }),
  ).toThrow();
});

test("exec sources may name a companion import command (§3 pull)", () => {
  const config = defineCorpus({
    project: "p",
    server: "s",
    sourceLanguage: "en",
    languages: ["en"],
    sources: [{ adapter: "exec", command: "export", importCommand: "import" }],
  });
  const exec = config.sources[0];
  expect(exec?.adapter === "exec" && exec.importCommand).toBe("import");
});

test("language codes must be tags such as en or pt-PT", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "pt-PT"],
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    ],
  };
  expect(corpusConfigSchema.safeParse(base).success).toBe(true);
  expect(
    corpusConfigSchema.safeParse({ ...base, languages: ["en", "__proto__"] })
      .success,
  ).toBe(false);
  expect(
    corpusConfigSchema.safeParse({ ...base, project: "my project" }).success,
  ).toBe(false);
});
