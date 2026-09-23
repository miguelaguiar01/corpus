`corpus.config.ts` sits at the root of your repository and declares what Corpus reads, where it sends it, and what `corpus check` scans. Every command that touches your strings runs it; `init` writes it, and `corpus workbench` reads it only when it creates the project.

It is TypeScript, run directly with no build step. `defineCorpus` types it and validates it, so a mistake is a type error in your editor, or an error when a command loads it, rather than a failed push. A plain module works too: `corpus.config.mjs` exporting the same object, validated when it loads, which is the shape to use when the CLI runs from `npx` and `@corpus-tool/cli` is not in the repository to import from.

Here is one with every field that matters, annotated:

<!-- from: examples/annotated.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  // The project's slug on the instance, and where to reach it.
  project: "acme-app",
  server: process.env.CORPUS_SERVER ?? "http://localhost:3000",

  // The language the repository is written in, then every language the
  // project has. A pull never writes a translation into the source
  // language's file; it does write proposals there.
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],

  // Where the text is. One entry per shape of file; see Sources and
  // adapters. `library` says which i18n library wrote the catalogue.
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/i18n/{lang}.json",
      library: "icu",
    },
    {
      adapter: "table",
      type: "tour-step",
      path: "src/tour/steps.ts",
      map: { id: "id", text: "text", metadata: ["screen"] },
    },
  ],

  // What a string of each type may carry beside its text, and how each
  // type should read. Both are optional and both are shown to whoever
  // translates the string.
  stringTypes: {
    "tour-step": {
      screen: {
        type: "enum",
        description: "Where the step appears.",
        values: ["inbox", "editor", "settings"],
      },
    },
  },
  typeNotes: {
    ui: "Terse, sentence case, no exclamation marks.",
    "tour-step": "Second person, warm, one instruction per step.",
  },

  // Terms that must be rendered the same way everywhere, one file per
  // target language.
  glossary: { path: "src/i18n/glossary.{lang}.json" },

  // What `corpus check` reads, what it skips, and what is not chrome.
  check: {
    include: ["src"],
    ignore: ["**/*.test.tsx", "src/generated"],
    allow: ["^Acme$", "^[0-9]+ ?(px|ms|MB)$"],
  },
});
```

## The fields

**`project`** is the slug on the instance: lowercase letters, digits and hyphens. It is how the CLI finds your project, so it matches what the instance holds; `corpus workbench` creates a project of that name the first time it runs.

**`server`** is the instance's URL. `http://localhost:3000` is what `corpus workbench` starts. Reading it from an environment variable is normal for a repository whose developers each run their own:

```ts
server: process.env.CORPUS_SERVER ?? "http://localhost:3000",
```

**`sourceLanguage`** is the language your repository is written in. Its text belongs to the repository, so Corpus never writes it back from a translation; it is the one language that gets proofread rather than translated.

**`languages`** lists every language, the source included. It seeds the project's list at creation. After that the instance owns it: adding a language on the settings page makes rows for every string at once, and `corpus push` warns when the two lists have drifted rather than changing either.

**`sources`** is where your text is. Each entry names an adapter, a type, and a path. [Sources and adapters](Sources-and-adapters) covers them; a config with more than one source is normal, one per shape of file.

**`library`** on a source says which i18n library wrote the catalogue, which decides how placeholders and plurals are read. [Your i18n library](Your-i18n-library) has a recipe per ecosystem.

**`check`** configures the lint:

- `include`: the directories with your components. `src` when absent, which is wrong for a monorepo and for Outline-shaped layouts, so set it.
- `ignore`: path prefixes, or globs when they contain `*` or `?`. `**/*.test.tsx` is the common one.
- `allow`: regular expressions for text that is not chrome. A product name shown untranslated in every language belongs here; so does a code, a brand, or a unit. When a run has five findings or more and at least half of them are single words, `check` says so and names this option.

**`stringTypes`** declares the metadata a type of string may carry, which is what makes a string page useful rather than bare. **`typeNotes`** is one sentence per type on its voice, shown to whoever translates it. **`entityTypes`** and the entities an `exec` source emits describe the people and places your text refers to. **`glossary`** points at one JSON file per target language, each an array of `{ term, forms?, target, note? }`. A term matches the word it names, ignoring case and accents, so `forms` lists its plurals and agreements; in a script written without spaces between words, such as Chinese, Japanese or Thai, it matches as a run of characters instead. The terms that occur in a string are shown beside it while it is translated.

[Metadata, types, entities and the glossary](Metadata-types-entities-and-the-glossary) will cover all four in full; none is required.

## Where the token comes from

The config holds no secrets. Commands that talk to the instance read `CORPUS_TOKEN`, and fall back to `.corpus/token`. `init` adds `.corpus/` to your `.gitignore` for exactly this reason.

`corpus workbench` writes that file when it creates the project. Against an instance someone else runs, the instance secret creates the project and prints the token once, alone on the last line so a script can capture it:

```sh
CORPUS_INVITE_SECRET=<the instance secret> npx corpus project create --name "Acme app"
```

`corpus project rotate-token` replaces the token, authenticating with the current one, and rewrites `.corpus/token` when that is where the old one came from.

## A caution worth stating

`corpus build`, `corpus push` and `corpus pull` execute your config, and `exec` sources run the commands it declares. Run them only in repositories you trust, as you would their build scripts.

## Checking it

```sh
npx corpus build
```

`build` needs no server and no token. It runs the sources, validates everything locally, prints a summary, and names any source whose translations cannot come back. It is the fastest way to know a config is right.
