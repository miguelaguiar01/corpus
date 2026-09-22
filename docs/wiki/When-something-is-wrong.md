Symptoms, in the order they tend to happen. Every message here is one the tool actually prints; search this page for the text you were given.

## `CORPUS_TOKEN is not set and .corpus/token does not exist`

No token. `corpus workbench` writes one on its first run in a repository with a config; against a team instance, `corpus project create` prints one and you put it in `.corpus/token` or `CORPUS_TOKEN`.

This is also what a client reports when `corpus mcp` "fails to start", and what you get when a tool starts in your home directory rather than the repository.

## `unauthorized — the token was refused`

The token exists and the instance does not accept it. Usually the wrong project, or a token rotated somewhere else. Check `corpus status` against the same config; rotate from the project's settings page if you have lost the current one.

## `could not reach the server at …`

Nothing is listening. If it should be a workbench, it stopped — it dies with the command that started it. If it is a team instance, check `curl -s <url>/api/health`.

## The push refused a string

```text
corpus: 1 string(s) refused
```

A string did not parse as a message. The lines above name each one and why. The rest of the push landed; fix the string and push again.

The commonest cause on a repository that has never used Corpus is a `{` that means a brace rather than a placeholder, and the second commonest is a tag the source opens and never closes. `corpus build` reproduces it offline.

## `corpus: check parsed no files in …`

`check` found the directories but could not read anything in them. On a Vue or Svelte project that is expected: it reads `.jsx` and `.tsx` only.

## `corpus: check scanned nothing: none of …`

The paths in `check.include` do not exist. `corpus init` does not write that key, so a fresh config has no `include` at all and `check` has nothing to read.

## The check found far too much

A codebase that has never had `check` run usually has real findings and a long tail of things that are not interface text: product names, codes, units, test fixtures. `check.allow` takes regular expressions for the text, `check.ignore` takes path prefixes. The first pass is a pull request of its own.

`check` says so itself when the ratio suggests it: it prints a hint about `check.allow` when a handful of tokens account for most of the findings.

## The check found nothing and the app is full of text

Either `check.include` is missing, or the components are not `.jsx`/`.tsx`. Both print a line saying so — read the last line of the output rather than the exit code.

## A translation will not save

The editor says which structural thing is wrong and disables the button until it is fixed: a missing placeholder, a plural branch your language needs, a tag the source opens. The rarer refusals:

- `human-edited` — an agent tried to write over somebody's work. Propose a change if the source is the problem; otherwise leave the row alone.
- `source-row` — the source language is changed by proposing, not by editing.
- `archived` — the repository no longer has this string.
- `unknown-language` — the language is not in the config, so the push never created the row.

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

The instance has no maintainer. On a version before 0.17 a workbench created the project before anybody joined, which made the project's agent actor the first user and left the first person a translator; opening the instance on a current version promotes the earliest person once. If it persists, that is a bug worth reporting.

## The install was refused

A package manager with a release-age policy holds back a version published inside its window. [A team instance](A-team-instance) has the three spellings and their allow lists.

## Proposals are all refused

```text
last pushed before sources were declared
```

The instance learns which files can take proposals from a push. Push once with a current CLI and `corpus status` will list the writable sources.

## An agent drafts nothing and reports `status` only

The instance is older than the CLI. The token routes the tools call arrived in 0.8.0; an older instance answers `status` and nothing else. Upgrade both packages together, or pull the matching image.
