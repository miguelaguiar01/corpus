import { defineCorpus } from "@corpus/contract";

// Corpus translates its own chrome (§12): the repo's own message catalog
// is a Corpus project, sourced through the standard `messages` adapter.
export default defineCorpus({
  project: "corpus-chrome",
  server: process.env.CORPUS_SERVER ?? "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  // `corpus check` (§3, §12): every chrome string must come from the
  // catalog above. Allowed: the product name, language-code examples in
  // placeholders ("en", "en, pt-PT"), and the CLI's own commands.
  check: {
    include: ["apps/web/src"],
    allow: [
      "^Corpus$",
      "^[a-z]{2}(-[A-Z]{2})?(, [a-z]{2}(-[A-Z]{2})?)*$",
      "^corpus [a-z]+$",
    ],
  },
  sources: [
    {
      adapter: "messages",
      type: "chrome",
      path: "apps/web/src/i18n/messages.{lang}.json",
    },
  ],
});
