Symptoms, in the order they tend to happen. Every message here is one the tool actually prints; search this page for the text you were given.

## `CORPUS_TOKEN is not set and .corpus/token does not exist`

No token. `corpus workbench` writes one on its first run in a repository with a config; against a team instance, `corpus project create` prints one and you put it in `.corpus/token` or `CORPUS_TOKEN`.

This is also what a client reports when `corpus mcp` "fails to start".

## `no config found in …`

The command ran somewhere without a `corpus.config.ts`. For an MCP client that is the usual cause of "the server failed to start": the app began in your home directory rather than the repository, and the config is read before the token, so this is the message rather than the one above.

The names it looked for are in the message: `corpus.config.ts`, `.mts`, `.js`, `.mjs`.

## `unauthorized — the token was refused`

The token exists and the instance does not accept it. Usually the wrong project, or a token rotated somewhere else. Check `corpus status` against the same config; rotate from the project's settings page if you have lost the current one.

## `could not reach the server at …`

Nothing is listening. If it should be a workbench, it stopped — it dies with the command that started it. If it is a team instance, check `curl -s <url>/api/health`.

## The push refused a string

```text
corpus: 1 string(s) refused and not pushed; a refused string the project holds is archived until it parses
```

A string did not parse as a message. The lines above name each one and why. The rest of the push landed. `--dry-run` says "would not be pushed" instead, and archives nothing.

## `corpus: snapshot build failed` with a list of refusals

Nothing was pushed. Either every string in a file was refused, or five were refused for the same reason — both mean the configuration is wrong rather than the strings, most often a `library` that is not declared. Pushing what parsed would archive every refused string, and a proposal pending on an archived string is superseded for good, so the build stops instead.

The refusals are listed above the summary, and their advice is what to act on: `declare library: "i18next" on the source` means exactly that.

The commonest cause on a repository that has never used Corpus is a `{` that means a brace rather than a placeholder, and the second commonest is a tag the source opens and never closes. `corpus build` reproduces it offline.

## `corpus: check parsed no files in …`

`check` found the directories but could not read anything in them. It reads `.jsx`, `.tsx` and `.vue`, so on a Svelte project this is expected.

## `corpus: check scanned nothing: no directory among …`

Not one of the paths it looked in is a directory. With no `check.include` the default is `src`, which is what a config written by `corpus init` falls back to — so this is what you see when the components live somewhere else and nobody has said where.

## `corpus: <command>: unknown option --…`

A flag that command does not take. The message suggests the near miss when there is one — `--langs` for `--lang`. Every command refuses what it does not know, so a typo fails rather than running something other than what you asked for; the flags each one takes are on [Commands](Commands).

## `corpus: <command>: --flag=… is not read`

Corpus reads a flag and its value as two words. `--out=snapshot.json` was accepted and did nothing before this was refused, so the command exited 0 having written no file.

## `corpus: check could not read … ; it was skipped`

A path inside an included directory that could not be read: a dangling symlink, a file or directory without permission. It is skipped and the rest of the tree is still scanned, so the findings are real but they cover slightly less than the config says.

## `corpus: check.include names … , which does not exist`

One entry is missing while others were scanned. The run carries on with what it could read, and its exit code still follows the findings — but the lint now covers less than the config says it does, which is what a renamed directory looks like. The same line with `which is a file` means an entry names a file; `check.include` takes directories.

## The check found far too much

A codebase that has never had `check` run usually has real findings and a long tail of things that are not interface text: product names, codes, units, test fixtures, component stories. `check.allow` takes regular expressions for the text, `check.ignore` takes path prefixes and globs. The first pass is a pull request of its own.

On a Vue project two things account for most of it. Stories are not the application: `check.ignore: ["**/*.story.vue"]` covers Histoire and Storybook, as `**/*.test.tsx` does elsewhere. And a component prop named `label` often names a field rather than saying anything — `label="title"` on a select — which `check.allow` is for.

`check` says so itself when the shape suggests it: with five findings or more, when at least half of them are single words with no whitespace, it prints how many and points at `check.allow`.

## The check found nothing and the app is full of text

Either `check.include` is missing, or the components are not `.jsx`, `.tsx` or `.vue`. Both print a line saying so — read the last line of the output rather than the exit code.

## A translation will not save

In the editor the structural problems are listed under the box and the save button stays disabled until they are fixed: a missing placeholder, a plural branch your language needs, a tag the source opens. Through the token — an agent, or `corpus agent` — the same write comes back as a named refusal:

- `human-edited: <key> in <lang> holds a person's work; propose a change if the source is the problem; otherwise leave the row to its author` — an agent tried to write over somebody's translation. Retrying will not help; the message names the two ways forward.
- `source-row: the source text comes from the repository and is not edited here` — the source language is changed by proposing, not by translating.
- `archived: <key> is archived` — the repository no longer has this string.
- `unknown-language: <lang> is not a language of <project>` — the language is not in the config, so the push never created the row.
- `empty-text: the translation is empty` — nothing to save.
- `invalid-translation: …` — the structural problem, named.

## `pull` wants to change a file you did not expect

`corpus pull --check` fails when the repository is behind, and a pending proposal counts: it is a change waiting to be written into the source file. `corpus status` prints the pending count. Run the pull, read the diff, and merge it like any other change.

## A language shows as untranslated though its file is full

The file's text is identical to the source text. A push seeds a translation from the repository, but a seed that repeats the source stays untranslated, because a catalogue full of English is a catalogue nobody has translated. Outline's `en_GB` went from "99% translated" to an honest 1,863 untranslated on its first push for exactly this reason.

## `corpus: … has no {lang}: its translations cannot be written back`

A source Corpus can read but not write. Push works, pull has nowhere to put the result. The message is printed by `build` and `push` too, so you learn it before anyone translates into it.

The same applies to `is not JSON: pull writes JSON only` and to an `exec` source with no `importCommand`.

## `corpus: N translation(s) belong to no writable source and were not written`

A pull had translations for strings whose source cannot take them back. Nothing was lost on the instance; there is simply nowhere in the repository to put them.

## The workbench will not start

`@corpus-tool/workbench is not installed in this repository` — install it beside the CLI; the two always share a version.

If the port is taken, `--port`. If it starts and the database is empty, you are pointing `--db` somewhere new: the database is the instance, and a new file is a new instance with no accounts.

## Nobody can verify anything

The instance has no maintainer, and nothing can make one, because promoting somebody needs a maintainer. Every instance started as a workbench between 0.8.0 and 0.16.0 is in this state: the workbench created the project before anybody joined, so the project's agent actor was the first row in the table and the first person to join came in as a translator.

A migration repairs it, promoting the earliest person, the first time the database is opened by a version carrying the fix. It is in `main` and not in 0.16.0, so today the answer is to build from `main` or wait for the next release.

## The install was refused

A package manager with a release-age policy holds back a version published inside its window. [A team instance](A-team-instance) has the three spellings and their allow lists.

## Proposals are all refused

```text
last pushed before sources were declared
```

The instance learns which files can take proposals from a push. Push once with a current CLI and `corpus status` will list the writable sources.

## An agent drafts nothing and reports `status` only

The instance is older than the CLI. The token routes the tools call arrived in 0.8.0; an older instance answers `status` and nothing else. Upgrade both packages together, or pull the matching image.
