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
  ],
});
