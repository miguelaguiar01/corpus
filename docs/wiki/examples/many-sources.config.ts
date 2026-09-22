import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    // The app's own chrome.
    { adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" },
    // Text that has to survive a mail client, kept apart so a
    // translator sees it as its own kind.
    { adapter: "messages", type: "email", path: "emails/i18n/{lang}.json" },
    // Records rather than a catalogue: `map` says which field is which.
    {
      adapter: "table",
      type: "tour-step",
      path: "src/tour/steps.{lang}.json",
      map: { id: "id", text: "text", metadata: ["screen"] },
    },
    // Anything no adapter reads. The import command merges what a pull
    // sends it; a command that rewrites its file loses every row the
    // payload does not carry.
    {
      adapter: "exec",
      command: "node scripts/corpus-export.mjs",
      importCommand: "node scripts/corpus-import.mjs",
    },
  ],
});
