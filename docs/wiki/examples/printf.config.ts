import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en-US",
  languages: ["en-US", "de-DE", "pt-BR"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "options/locale/locale_{lang}.json",
      library: "printf",
    },
  ],
});
