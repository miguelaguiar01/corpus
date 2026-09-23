A source says where text lives and how to read it. A config usually has more than one: catalogues are one source, a table of records another.

Three adapters cover what repositories actually hold.

## messages

One key-value catalogue per language.

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }
```

`{lang}` is required and is filled with each language in turn, so the source language's file is what push reads, and every other file is a translation it already has when the path is `.json`. Nested objects flatten to dotted keys, so `{ "editor": { "save": "Save" } }` is the string `editor.save`.

The path may put the language anywhere, including in a directory:

```ts
{ adapter: "messages", type: "ui", path: "locales/{lang}/translation.json" }
```

## table

A module that exports records, where the text is one field among others.

```ts
{
  adapter: "table",
  type: "tour-step",
  path: "src/tour/steps.ts",
  map: { id: "id", text: "text", metadata: ["screen"] },
}
```

`map` says which field is the string's id, which is its text, and which of the rest travel as metadata: name them, or omit `metadata` to take them all. `export: "STEPS"` reads a named export instead of the default.

A table with `{lang}` in its path has translations per language like a catalogue. One without still pushes, and its translations have nowhere to go; `build` and `push` say so.

## exec

A command that prints the entries as JSON, for text that lives somewhere no adapter reads: a database, a spreadsheet, a game engine's own format.

```ts
{
  adapter: "exec",
  command: "node scripts/corpus-export.mjs",
  importCommand: "node scripts/corpus-import.mjs",
}
```

The export command prints `{ strings, entities?, translations? }`, up to 256 MiB, which no catalogue reaches. `strings` are the entries themselves; `entities` describe the people and places they refer to; `translations` is what the repository already holds, as language to id to text, which push imports as translated exactly as it does a catalogue file's. A language the config does not declare, or the source language, is an error rather than a silent skip.

The import command receives, on stdin, only the rows a pull selected, for the languages that pull asked for. That last point is where these go wrong: an import command that rewrites its file from what it receives deletes everything the payload does not carry, which is every string nobody has translated yet. It must merge.

Without `importCommand` the source is push-only, and every command that reads it says so. `corpus validate` runs the export command and validates the `translations` it hands over as it does a target file's, the command standing for the file; an exporter that emits none is named as not validated.

## What comes back

`corpus pull` rewrites files in place, and it writes JSON only. So:

| Source | Pushes | Takes translations back |
|---|---|---|
| `messages` with `{lang}`, `.json` or `.arb` | yes | yes |
| `table` with `{lang}`, `.json` | yes | yes |
| `.ts` or `.js` catalogue | yes | no |
| path without `{lang}` | yes | no |
| `exec` with `importCommand` | yes | yes |
| `exec` without it | yes | no |

A proposal is a separate matter: any writable `.json` source takes proposals back, `{lang}` or not, because a proposal is written into the source-language file.

`build` and `push` print one line per source that cannot take translations back, so you learn it before anyone translates into it rather than after.

## Types

Every `messages` and `table` source names a `type`. A type groups strings in the catalogue, carries a note on how they should read, and decides what metadata a string may have.

Pick types by how the text behaves rather than by where it lives: `ui` for buttons and labels, `email` for text that must survive a mail client, `tour-step` for a sequence a translator should read in order. A single `ui` is a fine start.

## One source, several files

A source's `path` may be an array of patterns, each with `{lang}`, all sharing the source's type and library: one source per pattern, and a duplicate id across them is the build error it is between any two sources, naming both files. A pattern may also carry `{ns}`, one path segment, for the layout i18next uses by default:

```ts
{ adapter: "messages", type: "ui", path: "public/locales/{lang}/{ns}.json" }
```

Every file that fills `{ns}` for the source language is a source of its own, and the ids it contributes are `ns:key`, with `:` as the separator (i18next's own, not configurable), so `common.json` and `admin.json` may both hold `title`. `pull` writes each string back to the file its id names, and a target file only ever takes the ids its source-language file holds. `init` reads the languages and the library through a `{ns}` pattern and writes it as given. A bare `*` is not a pattern: a wildcard alone cannot say which language a file holds.

## More than one source

<!-- from: examples/many-sources.config.ts -->
```ts
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
```

Ids must be unique across all of them. Two sources holding the same id is a build error naming both files, which is what you want: it means one string has two homes and a pull would have to guess.
