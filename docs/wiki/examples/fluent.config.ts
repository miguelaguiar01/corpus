import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt"],
  sources: [{ adapter: "fluent", type: "ui", path: "i18n/{lang}/app.ftl" }],
});
