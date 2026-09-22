import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "ru"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/i18n/lang/{lang}.json",
      library: "vue",
    },
  ],
  check: { include: ["src"], ignore: ["**/*.story.vue"] },
});
