import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  sources: [
    { adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" },
    {
      adapter: "table",
      type: "tour-step",
      path: "src/tour/steps.ts",
      map: { id: "id", text: "text", metadata: ["screen", "beta", "mentions"] },
    },
    // A `ref` points at an entity, and entities only arrive through an
    // exec source's `entities`: a catalogue has nowhere to put them, so
    // without this the push refuses every `mentions` value.
    { adapter: "exec", command: "node scripts/corpus-entities.mjs" },
  ],

  // What a string of each type may carry, one declaration per field.
  // `description` is mandatory on every one: it is the tooltip the
  // translator reads, and it is the only thing that makes a field worth
  // declaring rather than guessing.
  stringTypes: {
    "tour-step": {
      screen: {
        type: "enum",
        description: "Where the step appears.",
        values: ["inbox", "editor", "settings"],
      },
      beta: {
        type: "flag",
        description: "Only shown to accounts in the beta programme.",
      },
      caption: {
        type: "text",
        description: "The screenshot's caption, if the step has one.",
      },
      slots: {
        type: "placeholders",
        description: "What each placeholder in this step stands for.",
        slots: {
          count: { description: "How many documents are in the inbox." },
          name: { description: "The person's display name.", role: "person" },
        },
      },
      mentions: {
        type: "list<ref>",
        description: "The people or places this step names.",
        entityType: "character",
      },
    },
  },

  // One sentence per type on how it should read. Shown beside every
  // string of that type, to people and to agents alike.
  typeNotes: {
    ui: "Terse, sentence case, no exclamation marks.",
    "tour-step": "Second person, warm, one instruction per step.",
  },

  // What an entity of each type is called in the interface.
  entityTypes: {
    character: { label: "Character" },
    place: { label: "Place" },
  },

  // Terms that must be rendered the same way everywhere, one file per
  // target language. The repository owns these; pull never writes them.
  glossary: { path: "src/i18n/glossary.{lang}.json" },
});
