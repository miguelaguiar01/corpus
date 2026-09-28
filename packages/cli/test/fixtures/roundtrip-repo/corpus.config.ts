import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "roundtrip",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "pt-PT",
  languages: ["pt-PT", "en"],
  stringTypes: {
    step: {
      kind: {
        type: "enum",
        description: "Step kind",
        values: ["hint", "task"],
      },
    },
  },
  sources: [
    { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    {
      adapter: "table",
      type: "step",
      path: "data/steps.{lang}.json",
      map: { id: "id", text: "text" },
    },
    { adapter: "android", type: "screen", path: "res" },
    { adapter: "fluent", type: "message", path: "ftl/{lang}/app.ftl" },
    {
      adapter: "xliff",
      type: "page",
      path: "locale/messages.{lang}.xlf",
      sourcePath: "locale/messages.xlf",
    },
    {
      adapter: "gettext",
      type: "menu",
      path: "po/{lang}.po",
      sourcePath: "po/messages.pot",
    },
    { adapter: "xcstrings", type: "screen", path: "ios/Localizable.xcstrings" },
    { adapter: "qt-ts", type: "menu", path: "qt/app_{lang}.ts" },
  ],
  richText: { screen: "html" },
});
