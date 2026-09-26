import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-BR", "sr-Latn"],
  sources: [{ adapter: "android", type: "ui", path: "app/src/main/res" }],
});
