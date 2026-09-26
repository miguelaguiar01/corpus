import { expect, test } from "vitest";
import { corpusConfigSchema, defineCorpus } from "./config";
import { localeOf } from "./strings";

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

test("typeNotes is optional in the config and refuses an empty note", () => {
  const base = corpusConfigSchema.parse({
    project: "x",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en"],
    sources: [
      { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    ],
  });
  expect(base.typeNotes).toBeUndefined();
  expect(
    corpusConfigSchema.safeParse({ ...base, typeNotes: { chrome: "Plain." } })
      .success,
  ).toBe(true);
  expect(
    corpusConfigSchema.safeParse({ ...base, typeNotes: { chrome: "" } })
      .success,
  ).toBe(false);
});

test("richText names the string types an HTML renderer reads (#622)", () => {
  const base = corpusConfigSchema.parse({
    project: "x",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en"],
    sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }],
  });
  expect(base.richText).toBeUndefined();
  expect(
    corpusConfigSchema.safeParse({ ...base, richText: { ui: "html" } }).success,
  ).toBe(true);
  expect(
    corpusConfigSchema.safeParse({ ...base, richText: { ui: "markdown" } })
      .success,
  ).toBe(false);
});

test("a language code may use underscores, as i18next and Crowdin write it", () => {
  const config = defineCorpus({
    project: "outline",
    server: "https://corpus.example",
    sourceLanguage: "en_US",
    languages: ["en_US", "pt_PT", "zh_CN"],
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "locales/{lang}/translation.json",
      },
    ],
  });
  expect(config.languages).toEqual(["en_US", "pt_PT", "zh_CN"]);
  expect(localeOf("en_US")).toBe("en-US");
});

test("a source may declare its message syntax", () => {
  const config = defineCorpus({
    project: "kb",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en", "fr"],
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "locales/{lang}/translation.json",
        syntax: "i18next",
      },
    ],
  });
  expect(config.sources[0]).toMatchObject({ syntax: "i18next" });
  expect(
    corpusConfigSchema.safeParse({
      ...config,
      sources: [{ ...config.sources[0], syntax: "handlebars" }],
    }).success,
  ).toBe(false);
});

test("a source declares its library; syntax is the old name and both together is an error", () => {
  const source = (extra: Record<string, unknown>) => ({
    project: "p",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en", "pt-PT"],
    sources: [
      { adapter: "messages", type: "ui", path: "i18n/{lang}.json", ...extra },
    ],
  });
  expect(corpusConfigSchema.safeParse(source({})).success).toBe(true);
  expect(
    corpusConfigSchema.safeParse(source({ library: "i18next" })).success,
  ).toBe(true);
  expect(
    corpusConfigSchema.safeParse(source({ syntax: "i18next" })).success,
  ).toBe(true);
  expect(
    corpusConfigSchema.safeParse(source({ library: "gettext" })).success,
  ).toBe(false);
  const both = corpusConfigSchema.safeParse(
    source({ library: "i18next", syntax: "i18next" }),
  );
  expect(both.success).toBe(false);
  if (!both.success) {
    expect(both.error.issues[0]?.message).toMatch(
      /library or syntax, not both/,
    );
  }
});

test("a source may name several patterns, each with {lang}, or a {ns} pattern (#513)", () => {
  const base = {
    project: "app",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "de"],
  };
  expect(
    corpusConfigSchema.safeParse({
      ...base,
      sources: [
        {
          adapter: "messages",
          type: "ui",
          path: ["a/{lang}.json", "b/{lang}/{ns}.json"],
        },
      ],
    }).success,
  ).toBe(true);
  const bad = corpusConfigSchema.safeParse({
    ...base,
    sources: [
      { adapter: "messages", type: "ui", path: ["a/{lang}.json", "b.json"] },
    ],
  });
  expect(bad.success).toBe(false);
  expect(
    corpusConfigSchema.safeParse({
      ...base,
      sources: [{ adapter: "messages", type: "ui", path: [] }],
    }).success,
  ).toBe(false);
});
