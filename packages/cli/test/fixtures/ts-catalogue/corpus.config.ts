import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "ts-catalogue",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.ts" }],
});
