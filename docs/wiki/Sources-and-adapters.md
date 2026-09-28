A source says where text lives and how to read it. A config usually has more than one: catalogues are one source, a table of records another.

Three adapters cover what repositories actually hold.

## messages

One key-value catalogue per language.

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }
```

The files are JSON (`.json`, Flutter's `.arb`) or a JavaScript or TypeScript module that default-exports the object. Any other catalogue is refused by name: gettext `.po` and XLIFF have adapters of their own, [gettext](#gettext) and [xliff](#xliff), Apple's String Catalog has [xcstrings](#xcstrings), Qt Linguist's XML `.ts` has [qt-ts](#qt-ts), Rails' YAML has [yaml](#yaml), and an [exec](#exec) source converts anything else.

An object whose keys are all plural categories, `other` among them, is one string, not one per key: `"rooms": { "one": "{{count}} room", "other": "{{count}} rooms" }` reads as `{count, plural, one {{{count}} room} other {{{count}} rooms}}`, so the editor shows one plural and a Polish translation gains `few` and `many`, which a pull writes back into the object in CLDR's order. This holds under `icu`, `i18next`, `printf`, `counterpart`, `easy_localization`, `rails` and `qt`; under `vue` the forms stay keys of their own.

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

## android

An Android app's string resources.

```ts
{ adapter: "android", type: "ui", path: "app/src/main/res" }
```

`path` is the `res` directory; `values/strings.xml` is the source and each `values-<qualifier>/strings.xml` a language. See [Your i18n library](Your-i18n-library#android-string-resources) for what it reads and how it writes back.

## fluent

Project Fluent's `.ftl` catalogues.

```ts
{ adapter: "fluent", type: "ui", path: "i18n/{lang}/app.ftl" }
```

One file per language, `{lang}` in the path. See [Your i18n library](Your-i18n-library#fluent) for the subset it reads.

## xliff

XLIFF 1.2 and 2.0, as Angular's `ng extract-i18n` and most translation tools write it, one file per language:

```ts
{
  adapter: "xliff",
  type: "ui",
  path: "src/locale/messages.{lang}.xlf",
  sourcePath: "src/locale/messages.xlf",
}
```

`sourcePath` names the source-language file when its name holds no language, as Angular's does; `corpus init --messages src/locale/messages.{lang}.xlf` writes it when it finds that file. A unit's `<source>` is the string, its description and meaning its note; a target file's `<target>` is a translation already made, unless its state is `new`, `needs-translation` or `initial`, and one marked done whose text is the source's (German `Status`) is translated, not work. Inline elements are what the editor shows as chips: `<x id="INTERPOLATION"/>` a placeholder `{INTERPOLATION}`, `START_LINK`/`CLOSE_LINK` a tag pair `<LINK>…</LINK>`, `<g>` and `<pc>` tags too, so a translation keeps each one and cannot reverse a pair. A pull writes a changed translation into its unit's `<target>` with the unit's own elements put back, turns a `new` state to `translated`, adds a missing target after its `<source>` and a missing unit at the end, and leaves every other byte as it was; a proposal edits the source file's units. A file whose elements carry a namespace prefix (`<xlf:trans-unit>`) is refused by name.

## gettext

gettext's `.po` files, one per language, beside the `.pot` template xgettext writes:

```ts
{
  adapter: "gettext",
  type: "ui",
  path: "locales/{lang}.po",
  sourcePath: "locales/app.pot",
}
```

`sourcePath` names the template, whose msgids are the strings; without it the source language's own `.po` is read. `corpus init --messages locales/{lang}.po` writes it when it finds the template in the directory above the language, `locales/` for `locales/{lang}.po` and for GNU's `locales/{lang}/LC_MESSAGES/app.po` alike, preferring `app.pot` when the catalogues are `app.po`; it says so when it finds neither a template nor the source language's `.po`. A msgid is its string's key and its text, so the code that calls `gettext()` holds it and no proposal edits it; a `msgctxt` is joined before it with `␄`. A `msgid_plural` and its `msgstr[n]` are one ICU plural, each of the language's CLDR categories reading the form the file's `Plural-Forms` gives its integers, so the editor asks a Russian translator for `one`, `few` and `many`, and `other`, which only decimals reach, reads the last form. A `#, fuzzy` row is a guess, not a translation; `#.` comments and `#:` references are the string's note. The library is `printf`, so a translation that drops a `%s` is refused.

A pull writes a changed translation into its entry's `msgstr` and nothing else: the rewritten msgstr is wrapped as msgmerge wraps it, so msgmerge does not rewrap it, and the entry's `fuzzy` flag goes. An entry the `.po` lacks is appended from the template before the obsolete entries, where the next msgmerge moves it into the template's order, and a language with no `.po` yet gets one made from the template with its `Language:` set. A `.po` made that way keeps the template's placeholder `Plural-Forms`, which msginit would fill in; set it before shipping the language.

## xcstrings

Apple's String Catalog, the `.xcstrings` file Xcode keeps every language in:

```ts
{ adapter: "xcstrings", type: "ui", path: "App/Localizable.xcstrings" }
```

One file holds every language, so the path has no `{lang}`; its `sourceLanguage` must be the config's. `corpus init --messages App/Localizable.xcstrings` writes the source, taking the languages and the source language from the file. A key is the string, and the code's: no proposal reaches a String Catalog. A key with no unit in the source language is its own text, as SwiftUI's `Text("Bookmarks")` reads it. A plural's variations are one ICU plural of printf branches; a substitution, `%#@count_posts@`, is a plural on the argument it formats, `{arg1, plural, one {%arg post} other {%arg posts}}`, whatever each language names it; a unit that varies by device is one string per device, `settings.platform [device:iphone]`. A stale key and one marked not to translate are left out, and `comment` is the string's note. Only a unit translated in every form is a translation already made; one still `new` or `needs_review` is work.

A pull writes a changed translation into its unit, marked translated, in Xcode's own layout, and leaves every other byte as it was: a language keeps its own substitution names and device variants, and a key the file lacks is never added. A catalogue saved by another tool in another layout is refused rather than reformatted; open and save it in Xcode once.

## qt-ts

Qt Linguist's `.ts` files, one per language:

```ts
{ adapter: "qt-ts", type: "ui", path: "src/lang/app_{lang}.ts" }
```

The source is the source language's file, often `lupdate`'s template with every translation empty; `sourcePath` names another. `corpus init --messages src/lang/app_{lang}.ts` writes the source when the file is Qt's XML, and a POSIX code among the files, `sr@latin`, goes into `languageFiles` as its tag, `sr-Latn`. A message is a string named by Qt's own identity, `Context | source`, or `Context | source | comment` where a disambiguating comment tells two apart; its `<extracomment>`, comment and locations are the note. Only a finished translation is one already made: an `unfinished` one is work, and a vanished one is not read. The library is [qt](Your-i18n-library#qt). Qt's source text is the code's `tr()` literal, so no proposal reaches it.

A pull writes a changed translation into its `<translation>` and nothing else, drops its `unfinished` mark, and escapes as the file does: `&quot;` and `&#xa0;` where lupdate and Transifex wrote the file, raw quotes where it keeps them raw. A message the file lacks goes in where the source file has it, and a language with no file yet gets one made from the source file. A plural (`numerus`) message is one plural on `count`: its forms map to the language's CLDR categories through Qt's own rule for the language, so French has two forms and Polish three, and a pull writes them back in Qt's order. A form no CLDR category reads, Latvian's for zero or Filipino's for 0 and 1, is not shown in the editor: a pull keeps it as the file has it, and fills it only where it would otherwise be empty.

## yaml

Rails I18n's YAML catalogues, one file per language rooted at its code:

```ts
{ adapter: "yaml", type: "ui", path: "config/locales/client.{lang}.yml" }
```

`corpus init --messages config/locales/client.{lang}.yml` writes the source, and refuses a YAML file that is not rooted at its language, as Symfony's and Hugo's are, pointing at an exec source. A string is a scalar under the root key, named by its dotted path (`js.user_api_key.deny`); a hash of plural categories (`one:`, `other:`) is one plural; a key ending in `_MF` is ICU MessageFormat, as Discourse's messageFormat reads it; the comment above a key is its note. Anchors, aliases and `<<:` merges are read where they are written, so a merged key is not a second string. A file whose language code differs from the config's tag, `pt_BR` for `pt-BR`, maps through `languageFiles`. The library is [rails](Your-i18n-library#rails-i18n-and-i18njs).

A pull writes a changed translation into its scalar in the scalar's own style, plain, quoted or a `|` or `>` block, quoting what Rails' YAML 1.1 would read as another type (`yes`, `no`, `on`); a missing key goes in after its neighbour in the source file, its parents made as needed; comments, anchors and every other byte stay. A key under a hash written inline (`{a: A}`) that already holds keys is refused by name, and so is a plural with an `=N` branch.

## exec

A command that prints the entries as JSON, for text that lives somewhere no adapter reads: a database, a spreadsheet, a game engine's own format.

```ts
{
  adapter: "exec",
  command: "node scripts/corpus-export.mjs",
  importCommand: "node scripts/corpus-import.mjs",
}
```

The export command prints `{ strings, entities?, translations? }`, up to 256 MiB, which no catalogue reaches. `strings` are the entries themselves; `entities` describe the people and places they refer to; `translations` is what the repository already holds, as language to id to text, which push imports as translated exactly as it does a catalogue file's. A text equal to the source seeds as untranslated, as a catalogue's does; where the repository means it, a loanword such as German `Status`, write it `{ "text": "Status", "state": "translated" }` and it seeds as translated. A language the config does not declare, or the source language, is an error rather than a silent skip. `build` and `push` print what the export command writes to stderr, under an `exec "<command>":` line, and say how many translations it handed over were not seeded and why (an id it did not emit, an empty text).

The import command receives, on stdin, only the rows a pull selected, for the languages that pull asked for. That last point is where these go wrong: an import command that rewrites its file from what it receives deletes everything the payload does not carry, which is every string nobody has translated yet. It must merge.

`pull` prints `ran <import command>` and, under it, whatever the command wrote to stderr. To have its files counted, the import command prints, as the last line of its stdout, the files it changed:

```json
{"changed": ["po/de_DE.po"]}
```

Paths are relative to the repository; one outside it fails the pull.

`pull --check` does not run an import command unless the source says it may, `importCheck: true`: the check promises to write nothing, and an import command that writes regardless would break that. Declare it once your command, when the environment has `CORPUS_PULL_CHECK=1`, writes nothing and prints the same `{"changed": […]}` line for the files it would change; those count toward the check's exit code. The variable reaches the command through `npm run` and a chained command, where a flag would not. An import command without `importCheck` is named as not checked, and one that runs but prints no line is named the same way.

Without `importCommand` the source is push-only, and every command that reads it says so. `corpus validate` runs the export command and validates the `translations` it hands over as it does a target file's, the command standing for the file; an exporter that emits none is named as not validated.

## What comes back

`corpus pull` rewrites files in place, and it writes JSON only. So:

| Source | Pushes | Takes translations back |
|---|---|---|
| `messages` with `{lang}`, `.json` or `.arb` (an `@key.description` is the string's note) | yes | yes |
| `table` with `{lang}`, `.json` | yes | yes |
| `.ts` or `.js` catalogue | yes | no |
| path without `{lang}` | yes | no |
| `exec` with `importCommand` | yes | yes |
| `exec` without it | yes | no |

A proposal is a separate matter: any writable `.json` source takes proposals back, `{lang}` or not, because a proposal is written into the source-language file.

A `.arb` target that does not exist yet is written on the first pull with `"@@locale"` first, set to its language in the underscore form `gen-l10n` checks it against (`pt_PT` for a config's `pt-PT`, whatever form the file name carries), then the strings; the `@key` metadata stays in the source ARB, where `gen-l10n` reads it. gen-l10n names the files themselves with underscores, `strings_pt_PT.arb`, so write the config's languages the same way, `pt_PT`: a config that says `pt-PT` over such a file is refused with the code to write, since pull would otherwise create `strings_pt-PT.arb` beside it.

`build` and `push` print one line per source that cannot take translations back, so you learn it before anyone translates into it rather than after.

## Types

Every `messages` and `table` source names a `type`. A type groups strings in the catalogue, carries a note on how they should read, and decides what metadata a string may have.

Pick types by how the text behaves rather than by where it lives: `ui` for buttons and labels, `email` for text that must survive a mail client, `tour-step` for a sequence a translator should read in order. A single `ui` is a fine start.

## One source, several files

A source's `path` may be an array of patterns, each with `{lang}`, all sharing the source's type and library: one source per pattern, read as one catalogue the application merges. An id in two of its files with the same source text is one string, as Element Web's app and shared-components catalogues share `Save`: `pull` writes its translation into each target file that already holds it, and into the first pattern's when none does, so a push and a pull leave every file as it was; a proposed edit or removal goes into each source file that holds it. Two target files that translate it differently fail the build, naming both: a shared string takes one translation, or a pull would rewrite one of them. With different source text it is a build error naming both files, as a duplicate between two separate sources always is. A pattern may also carry `{ns}`, one or more path segments anchored by the literals around it, for the layout i18next uses by default, and for a repository where each component keeps its own file (`src/{ns}/i18n/{lang}.json` reaches `src/Card/Header/i18n/en.json`, with ids like `Card/Header:save`, and a component added later needs no config change):

```ts
{ adapter: "messages", type: "ui", path: "public/locales/{lang}/{ns}.json" }
```

Every file that fills `{ns}` for the source language is a source of its own, and the ids it contributes are `ns:key`, with `:` as the separator (i18next's own, not configurable), so `common.json` and `admin.json` may both hold `title`. `pull` writes each string back to the file its id names, and a target file only ever takes the ids its source-language file holds. A new string proposed into a namespaced file, from the workbench or an agent, takes the prefix by itself: `title` into `admin.json` becomes `admin:title`, `admin:title` stays as typed, a key starting with another file's namespace is refused, and a sentence key keeps its own colons; the form's file list says which prefix each file adds. `init` reads the languages and the library through a `{ns}` pattern and writes it as given. A bare `*` is not a pattern: a wildcard alone cannot say which language a file holds.

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
