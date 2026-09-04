import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "fixture-project",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }],
});
