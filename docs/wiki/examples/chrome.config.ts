import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-extension",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt_BR"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/_locales/{lang}/messages.json",
      library: "chrome",
    },
  ],
});
