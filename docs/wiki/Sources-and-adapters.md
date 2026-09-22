A source says where text lives and how to read it. A config usually has more than one: catalogues are one source, a table of records another.

Three adapters cover what repositories actually hold.

## messages

One key-value catalogue per language.

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }
```

`{lang}` is required and is filled with each language in turn, so the source language's file is what push reads and every other file is a translation it already has. Nested objects flatten to dotted keys, so `{ "editor": { "save": "Save" } }` is the string `editor.save`.

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

The export command prints `{ strings, entities?, translations? }`. The import command receives, on stdin, only the rows a pull selected, for the languages that pull asked for. That last point is where these go wrong: an import command that rewrites its file from what it receives deletes everything the payload does not carry, which is every string nobody has translated yet. It must merge.

Without `importCommand` the source is push-only, and every command that reads it says so.

## What comes back

`corpus pull` rewrites files in place, and it writes JSON only. So:

| Source | Pushes | Takes translations back |
|---|---|---|
| `messages` with `{lang}`, `.json` | yes | yes |
| `table` with `{lang}`, `.json` | yes | yes |
| `.ts` or `.js` catalogue | yes | no |
| path without `{lang}` | yes | no |
| `exec` with `importCommand` | yes | yes |
| `exec` without it | yes | no |

`build` and `push` print one line per source that cannot take translations back, so you learn it before anyone translates into it rather than after.

## Types

Every `messages` and `table` source names a `type`. A type groups strings in the catalogue, carries a note on how they should read, and decides what metadata a string may have.

Pick types by how the text behaves rather than by where it lives: `ui` for buttons and labels, `email` for text that must survive a mail client, `tour-step` for a sequence a translator should read in order. A single `ui` is a fine start.

## More than one source

```ts
sources: [
  { adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" },
  { adapter: "messages", type: "email", path: "emails/i18n/{lang}.json" },
  { adapter: "table", type: "tour-step", path: "src/tour/steps.ts",
    map: { id: "id", text: "text" } },
]
```

Ids must be unique across all of them. Two sources holding the same id is a build error naming both files, which is what you want: it means one string has two homes and a pull would have to guess.
