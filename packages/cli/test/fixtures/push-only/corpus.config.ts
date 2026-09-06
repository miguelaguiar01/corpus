import { defineCorpus } from "@corpus/contract";

export default defineCorpus({
  project: "push-only",
  server: "https://corpus.example",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  entityTypes: { room: { label: "Room" } },
  sources: [
    { adapter: "messages", type: "chrome", path: "i18n/{lang}.json" },
    {
      adapter: "table",
      type: "step",
      path: "steps.json",
      map: { id: "id", text: "text" },
    },
    { adapter: "exec", command: "node export.mjs" },
  ],
});
