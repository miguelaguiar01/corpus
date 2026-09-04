import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "push-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en"],
  sources: [{ adapter: "messages", type: "chrome", path: "i18n/{lang}.json" }],
});
