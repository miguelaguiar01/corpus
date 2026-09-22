This page takes a repository that already has message catalogues and ends with a translated string in your files. It takes about ten minutes.

You need Node 22 or later and a repository with one JSON catalogue per language, such as `src/i18n/en.json` beside `src/i18n/de.json`.

## Install

```sh
npm install --save-dev @corpus-tool/cli @corpus-tool/workbench
```

The two packages always share a version. The CLI is what you run; the workbench is the instance it starts.

If your package manager refuses the version because it was published today, that is a release-age policy, and [A team instance](A-team-instance) says how to allow a package through it.

## Write the config

The examples below are a repository with six strings in `src/i18n/en.json`, fully translated into German and half translated into Portuguese. Everything shown here was recorded from that repository; the numbers are its numbers.

```sh
npx corpus init --project acme-app --source en --messages "src/i18n/{lang}.json" --type ui
```

<!-- from: recorded/init.out -->
```text
wrote corpus.config.ts
created .gitignore with .corpus/

Next:
  1. corpus workbench (needs @corpus-tool/workbench) starts an instance, creates the project "acme-app" and writes its token to .corpus/token.
     For another instance at http://localhost:3000: CORPUS_INVITE_SECRET=<its secret> corpus project create prints the token, for CORPUS_TOKEN or .corpus/token.
  2. corpus push
```

`--type` names what kind of string the catalogue holds. It is yours to choose: it groups strings in the catalogue, carries a note to translators, and decides which metadata a string may have. `ui` is a reasonable start; `chrome` is the default if you leave it out.

`init` read the directory to find the languages, looked at the source file to see which i18n library wrote it, and wrote:

<!-- from: recorded/first-push.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [
    { adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" },
  ],
});
```

It also added `.corpus/` to your `.gitignore`. That directory holds the local database, the instance secret and the project token, and none of them belong in git.

Check what it will send before starting anything:

```sh
npx corpus build
```

<!-- from: recorded/build.out -->
```text
built acme-app: 6 string(s) (ui 6), 0 entity(ies) (none)
```

`build` needs no server and no token, so it is the fastest way to see whether your config is right. If a string will not parse, it names the string with its file and key, leaves it out, and exits 1. The rest still push, so one malformed string does not stop you. [When something is wrong](When-something-is-wrong) covers what it can say.

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
pushed acme-app: 6 added, 0 changed, 0 stale, 0 archived, 8 translation(s) seeded from the repository
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
src/i18n/pt-PT.json
pulled acme-app at verified: 1 file(s) changed
```

`git diff` shows one key changed in that file. That is the loop: translations arrive as a reviewable commit.

By default `pull` takes only verified rows. `--min-state translated` takes translated ones too, which is what you want if nobody verifies.

## What to do next

- [The daily loop](The-daily-loop) is what this looks like once it is not the first time.
- [The config file](The-config-file) explains every field, including what to do when your catalogues are not one file per language.
- [Corpus in CI](Corpus-in-CI) keeps a broken translation or a hard-coded string out of your build.
