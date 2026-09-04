import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "pull-fixture",
  server: process.env.CORPUS_SERVER ?? "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt"],
  sources: [
    { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    {
      adapter: "exec",
      command: "node scripts/export.mjs",
      importCommand: "node scripts/import.mjs",
    },
  ],
});
