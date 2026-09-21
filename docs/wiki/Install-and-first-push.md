This page takes a repository that already has message catalogues and ends with a translated string in your files. It takes about ten minutes.

You need Node 22 or later and a repository with one JSON catalogue per language, such as `src/i18n/en.json` beside `src/i18n/de.json`.

## Install

```sh
npm install --save-dev @corpus-tool/cli @corpus-tool/workbench
```

The two packages always share a version. The CLI is what you run; the workbench is the instance it starts.

If your package manager refuses the version because it was published today, that is a release-age policy, and [A team instance](A-team-instance) says how to allow a package through it.

## Write the config

```sh
npx corpus init --project acme-app --source en --messages "src/i18n/{lang}.json"
```

`init` reads the directory to find your languages, looks at the source file to see which i18n library wrote it, and writes `corpus.config.ts`:

<!-- from: examples/minimal.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }],
});
```

It also adds `.corpus/` to your `.gitignore`. That directory holds the local database, the instance secret and the project token, and none of them belong in git.

Check what it will send before starting anything:

```sh
npx corpus build
```

```
built acme-app: 412 string(s) (ui 412), 0 entity(ies) (none)
```

If a string will not parse, `build` names it with its file and key, leaves it out, and exits 1. The rest still push, so one malformed string does not stop you. [When something is wrong](When-something-is-wrong) covers the messages you might see here.

## Start the workbench

```sh
npx corpus workbench
```

```
Corpus workbench 0.16.0 is running at http://localhost:3000
  database  .corpus/corpus.db
  secret    a101b74f13e7b92de77912d782256645adbd6713f5d43d9d  (join with it once; it is in .corpus/secret)
  token     written to .corpus/token (project acme-app created)
  stop      Ctrl-C
```

It created the project your config names and wrote its token. Leave it running.

## Push

In another shell:

```sh
npx corpus push
```

```
pushed acme-app: 412 added, 0 changed, 0 stale, 0 archived, 806 translation(s) seeded from the repository
```

The seeds are the translations your repository already had: Corpus imports them as translated rather than asking anyone to redo them. If a row's text is the same as the English, it stays untranslated, because an exporter that fills a missing translation with the source is not a translation.

## Translate one string

Open http://localhost:3000, join with the secret from the workbench output, and pick a name and a password. The first person to join is the maintainer.

The dashboard shows what to work on. Click **Untranslated**, and you are in the editor on the first string: the source on the left with its placeholders as chips, your language on the right. Type a translation, insert placeholders from the chips rather than typing braces, and save. Then click **Verify**, which only a maintainer can do.

## Pull

```sh
npx corpus pull
```

```
pulled acme-app at verified: 1 file(s) changed
  src/i18n/de.json
```

`git diff` shows one key changed in one file. That is the loop: translations arrive as a reviewable commit.

By default `pull` takes only verified rows. `--min-state translated` takes translated ones too, which is what you want if nobody verifies.

## What to do next

- [The daily loop](The-daily-loop) is what this looks like once it is not the first time.
- [The config file](The-config-file) explains every field, including what to do when your catalogues are not one file per language.
- [Corpus in CI](Corpus-in-CI) keeps a broken translation or a hard-coded string out of your build.
