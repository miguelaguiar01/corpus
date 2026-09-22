import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  // The project's slug on the instance, and where to reach it.
  project: "acme-app",
  server: process.env.CORPUS_SERVER ?? "http://localhost:3000",

  // The language the repository is written in, then every language the
  // project has. A pull never writes a translation into the source
  // language's file; it does write proposals there.
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],

  // Where the text is. One entry per shape of file; see Sources and
  // adapters. `library` says which i18n library wrote the catalogue.
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/i18n/{lang}.json",
      library: "icu",
    },
    {
      adapter: "table",
      type: "tour-step",
      path: "src/tour/steps.ts",
      map: { id: "id", text: "text", metadata: ["screen"] },
    },
  ],

  // What a string of each type may carry beside its text, and how each
  // type should read. Both are optional and both are shown to whoever
  // translates the string.
  stringTypes: {
    "tour-step": {
      screen: {
        type: "enum",
        description: "Where the step appears.",
        values: ["inbox", "editor", "settings"],
      },
    },
  },
  typeNotes: {
    ui: "Terse, sentence case, no exclamation marks.",
    "tour-step": "Second person, warm, one instruction per step.",
  },

  // Terms that must be rendered the same way everywhere, one file per
  // target language.
  glossary: { path: "src/i18n/glossary.{lang}.json" },

  // What `corpus check` reads, what it skips, and what is not chrome.
  check: {
    include: ["src"],
    ignore: ["**/*.test.tsx", "src/generated"],
    allow: ["^Acme$", "^[0-9]+ ?(px|ms|MB)$"],
  },
});
