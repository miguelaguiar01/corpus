import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "broken",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en"],
  sources: [
    { adapter: "messages", type: "chrome", path: "missing/{lang}.json" },
  ],
});
