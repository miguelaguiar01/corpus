import { defineCorpus } from "@corpus/contract";

// Corpus translates its own chrome (§12): the repo's own message catalog
// is a Corpus project, sourced through the standard `messages` adapter.
export default defineCorpus({
  project: "corpus-chrome",
  server: process.env.CORPUS_SERVER ?? "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  sources: [
    {
      adapter: "messages",
      type: "chrome",
      path: "apps/web/src/i18n/messages.{lang}.json",
    },
  ],
});
