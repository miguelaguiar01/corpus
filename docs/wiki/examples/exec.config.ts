import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [
    { adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" },
    {
      adapter: "exec",
      command: "node scripts/tips-export.mjs",
      importCommand: "node scripts/tips-import.mjs",
      importCheck: true,
    },
  ],
});
