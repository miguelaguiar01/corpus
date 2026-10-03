import { expect, test } from "vitest";
import { corpusConfigSchema, defineCorpus } from "./config";
import { localeOf, posixTag } from "./strings";

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

test("an android source names its res directory and nothing else (#596)", () => {
  const parsed = corpusConfigSchema.safeParse({
    project: "x",
    server: "https://corpus.example",
    sourceLanguage: "en",
    languages: ["en", "pt-BR"],
    sources: [{ adapter: "android", type: "ui", path: "app/src/main/res" }],
  });
  expect(parsed.success).toBe(true);
});

test("a language code that is not a tag is refused by name; a POSIX one is told its tag and the mapping (#657)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }],
  };
  const messages = (languages: string[]) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, languages });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  expect(messages(["en", "sr@latin"])).toEqual([
    '"sr@latin" is not a language tag; write sr-Latn, and map its files with languageFiles: { "sr-Latn": "sr@latin" } on the source',
  ]);
  expect(messages(["en", "e n"])).toEqual([
    '"e n" is not a language tag such as en, pt-PT or en_US',
  ]);
  expect(messages(["en", "ca@valencia"])).toEqual([
    '"ca@valencia" is not a language tag; write ca-valencia, and map its files with languageFiles: { "ca-valencia": "ca@valencia" } on the source',
  ]);
});

test("a POSIX modifier that is a registered variant names its tag, after any region; one that is not names none (#1015)", () => {
  expect(posixTag("ca@valencia")).toBe("ca-valencia");
  expect(posixTag("ca_ES@valencia")).toBe("ca-ES-valencia");
  expect(posixTag("sr_RS@latin")).toBe("sr-Latn-RS");
  expect(posixTag("de_DE@euro")).toBeUndefined();
  expect(posixTag("aa_ER@saaho")).toBeUndefined();
});

test("a messages or fluent source may name the file code of a language (#657)", () => {
  const config = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "zh-CN", "sr-Latn"],
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "i18n/{lang}.json",
        languageFiles: { "zh-CN": "cn", "sr-Latn": "sr@latin" },
      },
    ],
  };
  expect(corpusConfigSchema.safeParse(config).success).toBe(true);
  expect(
    corpusConfigSchema.safeParse({
      ...config,
      sources: [{ ...config.sources[0], languageFiles: { "zh-CN": "a/b" } }],
    }).success,
  ).toBe(false);
  const refused = (
    languageFiles: Record<string, string>,
    adapter = "messages",
  ) => {
    const parsed = corpusConfigSchema.safeParse({
      ...config,
      languages: ["en", "zh-CN", "sr-Latn", "pt", "pt-BR"],
      sources: [
        {
          ...config.sources[0],
          adapter,
          languageFiles,
          ...(adapter === "table" && { map: { id: "id", text: "text" } }),
        },
      ],
    });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  // Two languages in one file would overwrite each other on a pull.
  expect(refused({ "pt-BR": "pt" })).toEqual([
    "pt and pt-BR would share the file of pt",
  ]);
  // The source language may keep its strings under another name, as
  // Anki's `templates` (#994), but not in a target's file.
  expect(refused({ en: "english" })).toEqual([]);
  expect(refused({ en: "pt" })).toEqual([
    "en and pt would share the file of pt",
  ]);
  expect(refused({ "zh-cn": "cn" })).toEqual([
    "languageFiles names zh-cn, which languages does not list",
  ]);
  expect(refused({ "zh-CN": "cn" }, "table")).toEqual([
    "languageFiles is for messages, fluent, xliff, gettext, qt-ts and yaml sources",
  ]);
});

test("sourceVariants names target languages only (#658)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "en-GB"],
    sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }],
  };
  const messages = (sourceVariants: string[]) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sourceVariants });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  expect(messages(["en-GB"])).toEqual([]);
  expect(messages(["en"])).toEqual([
    "sourceVariants names en, which is not a target language of languages",
  ]);
  expect(messages(["en-AU"])).toEqual([
    "sourceVariants names en-AU, which is not a target language of languages",
  ]);
});

test("{ns} is refused by name on an adapter that does not read it (#854)", () => {
  const config = (source: Record<string, unknown>) =>
    corpusConfigSchema.safeParse({
      project: "demo",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [source],
    });
  for (const source of [
    { adapter: "messages", type: "ui", path: "locales/{lang}/{ns}.json" },
    {
      adapter: "table",
      type: "ui",
      path: "data/{ns}.{lang}.json",
      map: { id: "id", text: "text" },
    },
    { adapter: "fluent", type: "ui", path: "i18n/{lang}/{ns}.ftl" },
    // A Compose Multiplatform module's resources (#989).
    {
      adapter: "android",
      type: "ui",
      path: "feature/{ns}/src/commonMain/composeResources",
    },
  ])
    expect(config(source).success).toBe(true);
  for (const source of [
    { adapter: "yaml", type: "ui", path: "config/locales/{ns}.{lang}.yml" },
    { adapter: "gettext", type: "ui", path: "po/{ns}.{lang}.po" },
    { adapter: "xliff", type: "ui", path: "locale/{ns}.{lang}.xlf" },
    { adapter: "qt-ts", type: "ui", path: "lang/{ns}_{lang}.ts" },
    { adapter: "xcstrings", type: "ui", path: "{ns}/Localizable.xcstrings" },
    {
      adapter: "gettext",
      type: "ui",
      path: "po/{lang}.po",
      sourcePath: "po/{ns}.pot",
    },
  ]) {
    const result = config(source);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(
      `${source.adapter} does not read {ns}: only messages, table, fluent and android do`,
    );
  }
});

test("a library field the build does not read is refused by name (#860)", () => {
  const config = (source: Record<string, unknown>) =>
    corpusConfigSchema.safeParse({
      project: "demo",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [source],
    });
  const issues = (source: Record<string, unknown>) => {
    const result = config(source);
    expect(result.success).toBe(false);
    return JSON.stringify(result.error?.issues);
  };
  // syntax is the old name on messages and table alone.
  expect(
    config({
      adapter: "messages",
      type: "ui",
      path: "i/{lang}.json",
      syntax: "i18next",
    }).success,
  ).toBe(true);
  for (const adapter of ["gettext", "qt-ts", "yaml"])
    expect(
      issues({ adapter, type: "ui", path: `l/{lang}.x`, syntax: "icu" }),
    ).toContain(`${adapter} reads library, not syntax`);
  expect(
    issues({
      adapter: "xcstrings",
      type: "ui",
      path: "L.xcstrings",
      syntax: "bogus",
    }),
  ).toContain("xcstrings reads library, not syntax");
  // xliff's text is ICU, fluent's its own, android's its own: no library.
  for (const [adapter, path] of [
    ["xliff", "l/{lang}.xlf"],
    ["fluent", "l/{lang}.ftl"],
    ["android", "res"],
  ] as const) {
    for (const field of ["library", "syntax"])
      expect(issues({ adapter, type: "ui", path, [field]: "icu" })).toContain(
        `${adapter} sets its own library; ${field} does not apply`,
      );
  }
  // An exec source's entries carry their own library.
  for (const field of ["library", "syntax"])
    expect(
      issues({ adapter: "exec", command: "x", [field]: "i18next" }),
    ).toContain(
      `an exec source's entries carry their own library; ${field} does not apply`,
    );
  // The not-both message speaks of messages and table only.
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "i/{lang}.json",
      library: "icu",
      syntax: "icu",
    }),
  ).toContain("syntax is the old name for library");
});

test("merge takes a list of patterns, strict or last-wins (#953)", () => {
  const base = {
    project: "p",
    server: "https://c.example",
    sourceLanguage: "en",
    languages: ["en", "pt"],
  };
  const parse = (source: object) =>
    corpusConfigSchema.safeParse({ ...base, sources: [source] });
  const list = ["a/{lang}.json", "b/{lang}.json"];
  expect(
    parse({ adapter: "messages", type: "ui", path: list, merge: "last-wins" })
      .success,
  ).toBe(true);
  expect(
    parse({ adapter: "messages", type: "ui", path: list, merge: "first" })
      .success,
  ).toBe(false);
  const single = parse({
    adapter: "messages",
    type: "ui",
    path: "a/{lang}.json",
    merge: "last-wins",
  });
  expect(single.success).toBe(false);
  expect(JSON.stringify(single.error?.issues)).toMatch(
    /merge applies to a source whose path is a list of patterns/,
  );
  expect(
    parse({
      adapter: "yaml",
      type: "ui",
      path: "c/{lang}.yml",
      merge: "last-wins",
    }).success,
  ).toBe(false);
});

test("an android source takes a list of res directories and merge, as messages does; merge on one path is refused (#989)", () => {
  const config = (source: Record<string, unknown>) =>
    corpusConfigSchema.safeParse({
      project: "demo",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [source],
    });
  expect(
    config({
      adapter: "android",
      type: "ui",
      path: ["core/src/main/res", "app/src/main/res"],
      merge: "last-wins",
    }).success,
  ).toBe(true);
  expect(
    config({
      adapter: "android",
      type: "ui",
      path: "app/src/main/res",
      merge: "strict",
    }).success,
  ).toBe(false);
});

test("a source that reads no sourcePath refuses one by name (#994)", () => {
  const config = (source: object) =>
    corpusConfigSchema.safeParse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [source],
    });
  const issues = (source: object) => {
    const parsed = config(source);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "core/{lang}/{ns}.ftl",
      sourcePath: "core/templates/{ns}.ftl",
    }),
  ).toEqual([
    'fluent reads no sourcePath; map the source language with languageFiles: { en: "templates" }',
  ]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "i18n/{lang}.json",
      sourcePath: "i18n/base.json",
    }),
  ).toEqual([
    'messages reads no sourcePath without keyIsText: true, which reads its keys as the text; map the source language with languageFiles: { en: "base" }',
  ]);
  expect(
    issues({
      adapter: "gettext",
      type: "ui",
      path: "po/{lang}.po",
      sourcePath: "po/app.pot",
    }),
  ).toEqual([]);
  // The pattern's own source file needs no mapping; a {ns} spans
  // directories; each pattern of a list is tried.
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      sourcePath: "l/en/main.ftl",
    }),
  ).toEqual([
    "fluent reads no sourcePath; this one is the pattern's own source file, so drop it",
  ]);
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "core/{lang}/{ns}.ftl",
      languageFiles: { en: "templates" },
      sourcePath: "core/templates/{ns}.ftl",
    }),
  ).toEqual([
    "fluent reads no sourcePath; this one is the pattern's own source file, so drop it",
  ]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "src/{ns}/i18n/{lang}.json",
      sourcePath: "src/Card/Header/i18n/base.json",
    }),
  ).toEqual([
    'messages reads no sourcePath without keyIsText: true, which reads its keys as the text; map the source language with languageFiles: { en: "base" }',
  ]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: ["a/{lang}.json", "b/{lang}.json"],
      sourcePath: "b/root.json",
    }),
  ).toEqual([
    'messages reads no sourcePath without keyIsText: true, which reads its keys as the text; map the source language with languageFiles: { en: "root" }',
  ]);
  expect(
    issues({
      adapter: "android",
      type: "ui",
      path: "res",
      sourcePath: "res/values/strings.xml",
    }),
  ).toEqual(["android reads no sourcePath"]);
});

test("a path array on a source that takes one pattern is refused by the rule's name (#1020)", () => {
  // yaml takes a list since #1024.
  for (const adapter of ["gettext", "xliff", "qt-ts"]) {
    const parsed = corpusConfigSchema.safeParse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [
        {
          adapter,
          type: "ui",
          path: [
            "config/locales/{lang}.yml",
            "config/locales/devise.{lang}.yml",
          ],
        },
      ],
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((i) => i.message)).toEqual([
        `${adapter} takes one path pattern per source; declare one source per pattern (only messages, table, fluent, android and yaml take an array)`,
      ]);
  }
  const issues = (source: Record<string, unknown>) => {
    const parsed = corpusConfigSchema.safeParse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [source],
    });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  expect(
    issues({
      adapter: "xcstrings",
      type: "ui",
      path: ["a.xcstrings", "b.xcstrings"],
    }),
  ).toEqual([
    "xcstrings takes one file per source; declare one source per file",
  ]);
  expect(
    issues({
      adapter: "gettext",
      type: "ui",
      path: "po/{lang}.po",
      sourcePath: ["po/a.pot", "po/b.pot"],
    }),
  ).toEqual(["gettext takes one sourcePath per source"]);
});

test("a yaml source may list its patterns; {ns} in one is refused at its index (#1024)", () => {
  const parse = (path: unknown) =>
    corpusConfigSchema.safeParse({
      project: "p",
      server: "http://localhost:3000",
      sourceLanguage: "en",
      languages: ["en", "de"],
      sources: [{ adapter: "yaml", type: "ui", path, merge: "last-wins" }],
    });
  expect(parse(["{lang}.yml", "devise.{lang}.yml"]).success).toBe(true);
  const ns = parse(["{lang}.yml", "{ns}.{lang}.yml"]);
  expect(ns.success).toBe(false);
  if (!ns.success)
    expect(ns.error.issues[0]?.path).toEqual(["sources", 0, "path", 1]);
});

test("a source's pluralRules names a target language's categories, other among them (#997)", () => {
  const config = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "he"],
    sources: [
      {
        adapter: "messages",
        type: "ui",
        path: "i18n/{lang}.json",
        pluralRules: { he: ["one", "two", "many", "other"] },
      },
    ],
  };
  expect(corpusConfigSchema.safeParse(config).success).toBe(true);
  const refused = (pluralRules: unknown) => {
    const parsed = corpusConfigSchema.safeParse({
      ...config,
      sources: [{ ...config.sources[0], pluralRules }],
    });
    return parsed.success
      ? ""
      : parsed.error.issues.map((i) => i.message).join("; ");
  };
  expect(refused({ he: ["one", "two"] })).toMatch(/other/);
  expect(refused({ he: ["one", "lots", "other"] })).not.toBe("");
  expect(refused({ fr: ["one", "other"] })).toMatch(
    /pluralRules names fr, which languages does not list/,
  );
});

test("pluralRules is checked on every file source and refused on an exec source (#997)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "fr"],
  };
  const parse = (source: object) =>
    corpusConfigSchema.safeParse({ ...base, sources: [source] });
  for (const source of [
    { adapter: "xcstrings", type: "ui", path: "L.xcstrings" },
    {
      adapter: "table",
      type: "ui",
      path: "t.json",
      map: { id: "id", text: "text" },
    },
  ]) {
    expect(
      parse({ ...source, pluralRules: { fr: ["one", "many", "other"] } })
        .success,
    ).toBe(true);
    expect(parse({ ...source, pluralRules: { fr: "cldr" } }).success).toBe(
      false,
    );
    expect(parse({ ...source, pluralRules: { fr: ["one"] } }).success).toBe(
      false,
    );
  }
  const exec = parse({
    adapter: "exec",
    command: "node x.mjs",
    pluralRules: { fr: ["one", "other"] },
  });
  expect(exec.success ? "" : exec.error.issues[0]!.message).toMatch(
    /an exec source's entries carry their own plural forms; pluralRules does not apply/,
  );
});

test('pluralRules: "default" declares vue-i18n\'s default rule on a vue source, and only there (#1018)', () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "pl"],
  };
  const parse = (source: object) =>
    corpusConfigSchema.safeParse({ ...base, sources: [source] });
  const vue = {
    adapter: "messages",
    type: "ui",
    path: "i18n/{lang}.json",
    library: "vue",
  };
  expect(parse({ ...vue, pluralRules: "default" }).success).toBe(true);
  const icu = parse({ ...vue, library: "icu", pluralRules: "default" });
  expect(icu.success ? [] : icu.error.issues.map((i) => i.message)).toEqual([
    "pluralRules: \"default\" is vue-i18n's default rule; this source's library is icu",
  ]);
  const exec = parse({
    adapter: "exec",
    command: "node x.mjs",
    pluralRules: "default",
  });
  expect(exec.success ? [] : exec.error.issues.map((i) => i.message)).toEqual([
    "an exec source's entries carry their own plural forms; pluralRules does not apply",
  ]);
});

test("pluralRules' errors say where they are, and a refusal names the source's own library (#1018)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "pl"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success
      ? []
      : parsed.error.issues.map((i) => [i.path.join("."), i.message]);
  };
  const messages = { adapter: "messages", type: "ui", path: "i/{lang}.json" };
  expect(
    issues({ ...messages, pluralRules: { pl: ["One", "other"] } })[0]?.[0],
  ).toBe("sources.0.pluralRules.pl.0");
  expect(issues({ ...messages, pluralRules: "Default" })).toEqual([
    [
      "sources.0.pluralRules",
      'pluralRules is "default", vue-i18n\'s default rule, "cldr", easy_localization\'s ignorePluralRules: false, or a table of categories per language',
    ],
  ]);
  expect(
    issues({
      adapter: "gettext",
      type: "ui",
      path: "po/{lang}.po",
      pluralRules: "default",
    }),
  ).toEqual([
    [
      "sources.0.pluralRules",
      "pluralRules: \"default\" is vue-i18n's default rule; this source's library is printf",
    ],
  ]);
  expect(
    issues({ ...messages, syntax: "vue", pluralRules: "default" }),
  ).toEqual([]);
});

test('pluralRules: "cldr" is easy_localization\'s ignorePluralRules: false, refused elsewhere (#961)', () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "pl"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  const messages = { adapter: "messages", type: "ui", path: "i/{lang}.json" };
  expect(
    issues({ ...messages, library: "easy_localization", pluralRules: "cldr" }),
  ).toEqual([]);
  expect(issues({ ...messages, library: "vue", pluralRules: "cldr" })).toEqual([
    "pluralRules: \"cldr\" is easy_localization's ignorePluralRules: false; this source's library is vue",
  ]);
  expect(
    issues({
      ...messages,
      library: "easy_localization",
      pluralRules: "default",
    }),
  ).toEqual([
    "pluralRules: \"default\" is vue-i18n's default rule; this source's library is easy_localization",
  ]);
  // An array is no table.
  expect(issues({ ...messages, pluralRules: ["default"] })).toHaveLength(1);
});

test("a file source's namespace prefixes its ids; refused on exec and beside {ns}; an unknown source key is refused with the near miss (#998)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "de"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  for (const source of [
    { adapter: "messages", type: "ui", path: "l/{lang}.json" },
    { adapter: "yaml", type: "ui", path: "config/locales/{lang}.yml" },
    { adapter: "gettext", type: "ui", path: "po/{lang}.po" },
    { adapter: "xliff", type: "ui", path: "x/messages.{lang}.xlf" },
    { adapter: "android", type: "ui", path: "res" },
    { adapter: "fluent", type: "ui", path: "f/{lang}/app.ftl" },
    { adapter: "qt-ts", type: "ui", path: "ts/app_{lang}.ts" },
    { adapter: "xcstrings", type: "ui", path: "L.xcstrings" },
    {
      adapter: "table",
      type: "ui",
      path: "t.json",
      map: { id: "id", text: "text" },
    },
  ])
    expect(issues({ ...source, namespace: "server" })).toEqual([]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "l/{lang}.json",
      namespace: "a:b",
    }),
  ).toEqual([
    "a namespace holds no : or space, since : divides it from the key",
  ]);
  expect(
    issues({ adapter: "exec", command: "node x.mjs", namespace: "web" }),
  ).toEqual([
    "an exec source's entries carry their own ids; namespace does not apply",
  ]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "l/{lang}/{ns}.json",
      namespace: "web",
    }),
  ).toEqual([
    "namespace and a {ns} pattern each prefix the source's ids; a source takes one of them",
  ]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "l/{lang}.json",
      pluralRule: "default",
    }),
  ).toEqual([
    "pluralRule is no key of a messages source; did you mean pluralRules?",
  ]);
  expect(
    issues({
      adapter: "gettext",
      type: "ui",
      path: "po/{lang}.po",
      colour: "red",
    }),
  ).toEqual(["colour is no key of a gettext source"]);
  expect(
    issues({ adapter: "xliff", type: "ui", path: "x/{lang}.xlf", colour: 1 }),
  ).toEqual(["colour is no key of an xliff source"]);
  // A key spread in as undefined says nothing.
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "l/{lang}.json",
      colour: undefined,
    }),
  ).toEqual([]);
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: "l/{lang}.json",
      namespace: "",
    }),
  ).toHaveLength(1);
  expect(
    issues({ adapter: "yaml", type: "ui", path: "c/{lang}/{ns}.yml" }),
  ).toEqual([
    'yaml does not read {ns}: only messages, table, fluent and android do; namespace: "<name>" prefixes this source\'s ids instead',
  ]);
});

test("a file source's languages are a subset of the project's; one it does not list is refused by name (#1006)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "de", "fr", "ja"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  for (const source of [
    { adapter: "messages", type: "ui", path: "l/{lang}.json" },
    { adapter: "yaml", type: "ui", path: "config/locales/{lang}.yml" },
    { adapter: "gettext", type: "ui", path: "po/{lang}.po" },
    { adapter: "xliff", type: "ui", path: "x/messages.{lang}.xlf" },
    { adapter: "android", type: "ui", path: "res" },
    { adapter: "fluent", type: "ui", path: "f/{lang}/app.ftl" },
    { adapter: "qt-ts", type: "ui", path: "ts/app_{lang}.ts" },
    { adapter: "xcstrings", type: "ui", path: "L.xcstrings" },
    {
      adapter: "table",
      type: "ui",
      path: "t.json",
      map: { id: "id", text: "text" },
    },
  ])
    expect(issues({ ...source, languages: ["de", "ja"] })).toEqual([]);
  // The source language may be listed; every string takes it anyway.
  expect(
    issues({
      adapter: "qt-ts",
      type: "ui",
      path: "ts/app_{lang}.ts",
      languages: ["en", "de"],
    }),
  ).toEqual([]);
  expect(
    issues({
      adapter: "qt-ts",
      type: "ui",
      path: "ts/app_{lang}.ts",
      languages: ["de", "pt-BR"],
    }),
  ).toEqual([
    "the source's languages name pt-BR, which the project's languages do not list",
  ]);
  expect(
    issues({
      adapter: "qt-ts",
      type: "ui",
      path: "ts/app_{lang}.ts",
      languages: [],
    }),
  ).toHaveLength(1);
  expect(
    issues({ adapter: "exec", command: "node x.mjs", languages: ["de"] }),
  ).toEqual(["languages is no key of an exec source"]);
});

test("a messages source's sourcePath names a committed target whose keys are the text, with keyIsText: true and not without (#999)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "de", "fr"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  const zulip = {
    adapter: "messages",
    type: "ui",
    path: "locale/{lang}/translations.json",
    sourcePath: "locale/de/translations.json",
    keyIsText: true,
  };
  expect(issues(zulip)).toEqual([]);
  expect(issues({ ...zulip, keyIsText: undefined })).toEqual([
    "messages reads no sourcePath without keyIsText: true, which reads its keys as the text; add it where the keys of de's file are the source text",
  ]);
  expect(issues({ ...zulip, sourcePath: undefined })).toEqual([
    "keyIsText reads the keys of the file sourcePath names as the text; name a committed target file with sourcePath",
  ]);
  expect(
    issues({
      ...zulip,
      path: ["locale/{lang}/a.json", "locale/{lang}/b.json"],
    }),
  ).toEqual([
    "keyIsText takes one path pattern with no {ns}: sourcePath is one file, and its keys are the text of every file the pattern names",
  ]);
  expect(issues({ ...zulip, path: "locale/{lang}/{ns}.json" })).toEqual([
    "keyIsText takes one path pattern with no {ns}: sourcePath is one file, and its keys are the text of every file the pattern names",
  ]);
  expect(issues({ ...zulip, library: "chrome" })).toEqual([
    "keyIsText reads a catalogue whose keys are the text; Chrome's keys are message names",
  ]);
  // The advice for a target language's file is never a mapping the
  // schema refuses.
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      sourcePath: "l/fr/main.ftl",
    }),
  ).toEqual([
    "fluent reads no sourcePath; it is fr's file, which cannot be the source's too",
  ]);
  // A source that cannot take keyIsText is not told to add it, and a file
  // outside the pattern is told no mapping helps.
  expect(
    issues({
      adapter: "messages",
      type: "ui",
      path: ["a/{lang}.json", "b/{lang}.json"],
      sourcePath: "a/fr.json",
    }),
  ).toEqual([
    "messages reads no sourcePath without keyIsText: true, which reads its keys as the text; it is fr's file, which cannot be the source's too",
  ]);
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      sourcePath: "elsewhere/main.ftl",
    }),
  ).toEqual([
    "fluent reads no sourcePath; elsewhere/main.ftl is no file the pattern names, so no languageFiles mapping makes it the source's",
  ]);
  // Through languageFiles: a mapped file is its language's, and an
  // existing mapping of the source language is named.
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      languageFiles: { fr: "fr_FR" },
      sourcePath: "l/fr_FR/main.ftl",
    }),
  ).toEqual([
    "fluent reads no sourcePath; it is fr's file, which cannot be the source's too",
  ]);
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      languageFiles: { fr: "fr_FR" },
      sourcePath: "l/fr/main.ftl",
    }),
  ).toEqual([
    'fluent reads no sourcePath; map the source language with languageFiles: { en: "fr" }',
  ]);
  expect(
    issues({
      adapter: "fluent",
      type: "ui",
      path: "l/{lang}/main.ftl",
      languageFiles: { en: "en-US" },
      sourcePath: "l/en/main.ftl",
    }),
  ).toEqual([
    'fluent reads no sourcePath; languageFiles maps en to "en-US"; map it to "en" instead',
  ]);
  expect(issues({ ...zulip, sourcePath: "locale/{lang}/x.json" })).toHaveLength(
    1,
  );
  expect(
    issues({
      adapter: "yaml",
      type: "ui",
      path: "c/{lang}.yml",
      keyIsText: true,
    }),
  ).toEqual(["keyIsText is no key of a yaml source"]);
});

test("a file source may say generated: true, its file an extractor's output (#1000)", () => {
  const base = {
    project: "p",
    server: "http://localhost:3000",
    sourceLanguage: "en",
    languages: ["en", "de"],
  };
  const issues = (source: object) => {
    const parsed = corpusConfigSchema.safeParse({ ...base, sources: [source] });
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };
  for (const source of [
    { adapter: "messages", type: "ui", path: "l/{lang}.json" },
    { adapter: "yaml", type: "ui", path: "config/locales/{lang}.yml" },
    { adapter: "gettext", type: "ui", path: "po/{lang}.po" },
    { adapter: "xliff", type: "ui", path: "x/messages.{lang}.xlf" },
    { adapter: "android", type: "ui", path: "res" },
    { adapter: "fluent", type: "ui", path: "f/{lang}/app.ftl" },
    { adapter: "qt-ts", type: "ui", path: "ts/app_{lang}.ts" },
    { adapter: "xcstrings", type: "ui", path: "L.xcstrings" },
    {
      adapter: "table",
      type: "ui",
      path: "t.json",
      map: { id: "id", text: "text" },
    },
  ])
    expect(issues({ ...source, generated: true })).toEqual([]);
  expect(
    issues({ adapter: "exec", command: "node x.mjs", generated: true }),
  ).toEqual(["generated is no key of an exec source"]);
});
