import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [{ adapter: "messages", type: "ui", path: "messages/{lang}.json" }],
  check: { include: ["app", "components"] },
});
