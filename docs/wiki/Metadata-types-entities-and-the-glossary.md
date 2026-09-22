Everything on this page is optional. A project with none of it works: strings go up, translations come back. What it buys is a translator who does not have to guess, and the guessing is where bad translations come from.

Add it when a string is ambiguous, not before.

## Types

Every `messages` and `table` source names a `type`, and a type is the unit everything else attaches to. It groups strings in the catalogue, carries a note on how they should read, and decides what metadata a string may have.

Group by how the text behaves, not by where it lives. `ui` for buttons and labels, `email` for text that must survive a mail client, `tour-step` for a sequence someone should read in order. A single `ui` is a fine start, and splitting later costs nothing but a config edit and a push.

## Type notes

One sentence per type on how it should read:

```ts
typeNotes: {
  ui: "Terse, sentence case, no exclamation marks.",
  "tour-step": "Second person, warm, one instruction per step.",
}
```

It is shown beside every string of that type, to people and to agents alike. This is the cheapest thing on the page and the one most worth doing: the difference between a translator who knows the register and one who invents it per string is visible in the result.

The repository owns them. A push replaces them whole, so deleting one here deletes it there.

## Metadata

A string can carry fields beside its text. A `table` source takes them from the record's other columns; `map.metadata` names which, or omits the key to take them all.

What a field means is declared per type, and `description` is mandatory on every declaration, because the description is the tooltip the translator reads. An undeclared field is a value nobody can interpret.

Six kinds:

| Kind | What it holds |
|---|---|
| `enum` | One of `values` |
| `flag` | True or false |
| `text` | Free text, for what the other five do not fit |
| `placeholders` | A description per placeholder, and an optional `role` |
| `ref` | One entity |
| `list<ref>` | Several |

`placeholders` is the one that repays the effort fastest. A translator looking at `{count}` cannot tell whether it is a number of documents or of days, and the two take different phrasing in most languages.

A slot's `role` is a short grammatical tag shown in the chip's tooltip after the description, for languages where the surrounding words have to agree with what is substituted: `np-def` for a noun phrase that arrives with its article, `de-contraction` for a value a preposition must contract with. Leave it out until a translator asks.

## Entities

An entity is a thing the strings talk about: a character, a place, a product. It has an id, a type, a name and free-form attributes, and a string refers to it through a `ref` or `list<ref>` field.

The point is consistency across strings that a translator meets weeks apart. The entity browser is one page per project, grouped by type, with a filter per type and a search by name, so a name, a gender or a form of address can be looked up rather than guessed again.

`entityTypes` gives each type its label in the interface. Entities themselves come from an `exec` source's `entities`, since a catalogue has nowhere to put them.

## The glossary

Terms that must be rendered the same way everywhere, one file per target language:

<!-- from: examples/glossary.pt-PT.json -->
```json
[
  {
    "term": "workspace",
    "forms": ["workspaces"],
    "target": "espaço de trabalho",
    "note": "Never \"área de trabalho\", which is the desktop."
  },
  { "term": "draft", "forms": ["drafts", "drafted"], "target": "rascunho" },
  {
    "term": "Acme",
    "target": "Acme",
    "note": "The product name never translates."
  }
]
```

`term` is matched in the source text, along with any `forms` you list, and the matching is case- and accent-insensitive on whole words: `Vítima` in a source matches the term `vitima`. The editor shows the matched terms with their `target` and `note` while the string is being translated, and `get_string` returns them, so an agent sees the same list.

The repository owns these files and `corpus pull` never writes them. An absent file for a language is an empty glossary; a malformed one is a build error.

A glossary is worth starting the first time two translations of the same term disagree, which on a real project is usually within the first week.

## All of it together

<!-- from: examples/metadata.config.ts -->
```ts
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
```

## What it costs when you get it wrong

Nothing validates metadata against its declarations, in either direction.

A declared field a string does not carry is simply absent, and its tooltip never shows. A field a string carries that no type declares is not an error either — and not shown: the editor renders the declarations, so an undeclared field travels all the way to the instance and nobody ever sees it. That is the failure worth knowing about, because from the translator's side it is indistinguishable from the metadata not arriving at all.

`enum` values are not checked against what the strings hold, so a value outside the list arrives as itself and reads as a mistake in the editor rather than a refusal at build time.

So a field is worth declaring the moment it is worth showing, and a typo in a field name costs you silence rather than an error.
