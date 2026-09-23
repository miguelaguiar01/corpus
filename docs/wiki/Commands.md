Every command, what it needs, and what it exits with.

<!-- from: recorded/usage.out -->
```text
usage: corpus push [--dry-run] | corpus pull [--min-state <untranslated|translated|verified>] [--lang <l>]... [--check] | corpus check | corpus build [--out <file>]
       corpus init --project <slug> --source <lang> --messages <path with {lang}> [--languages <a,b>] [--server <url>] [--type <name>] [--library <icu|i18next|vue>]
       corpus workbench [--port <n>] [--db <path>] [--open] [--no-provision]
       corpus project create [--name <name>] [--server <url>] | corpus project rotate-token [--server <url>]
       corpus status [--json]
       corpus validate [--json]
       corpus mcp
       corpus agent queue <untranslated|stale|unverifiedSource|agentDrafts> [--lang <l>] [--type <t>] | string <key> | draft <key> <lang> <text> | propose <key> (--text <t> | --remove) | add <key> --file <f> --text <t> | proposals | withdraw <id> | status | --stdin
```

`corpus --version` prints the version; `corpus --help` prints the above. Both exit 0.

## Exit codes

**0** is success and **1** is everything else: a refused string, an invalid translation, a literal outside the catalogues, a repository behind what is verified, a token that does not exist, an unreachable instance, an unknown command, an unknown flag. `corpus workbench` is the exception — it exits with whatever the server it started exited with, so a crash there comes through as the server's own code.

Most failures print one line per finding and a summary last, on stderr, prefixed `corpus: `. Two do not: `corpus pull --check` lists the files that would change and its summary on **stdout** with no prefix, and an unknown command prints the usage. The prefix fails the other way too — `push` and `init` print `corpus: ` warnings and still exit 0. Gate on the exit code.

## What each needs

| Command | Config | Instance | Token |
|---|---|---|---|
| `init` | writes one | no | no |
| `build` | yes | no | no |
| `check` | yes | no | no |
| `validate` | yes | no | no |
| `push` | yes | yes | yes |
| `pull` | yes | yes | yes |
| `status` | yes | yes | yes |
| `agent` | yes | yes | yes |
| `mcp` | yes | yes | yes |
| `workbench` | no, but uses one | starts one | writes one |
| `project create` | yes | yes | the instance secret |
| `project rotate-token` | yes | yes | the current token |

The token is `CORPUS_TOKEN`, then `.corpus/token`. The instance secret is `CORPUS_INVITE_SECRET`, then `.corpus/secret`.

## The ones you run daily

**`corpus push`** sends the repository to the instance: strings added, changed, archived, and the translations the repository already has as seeds. `--dry-run` reports what it would do and writes nothing. A string that will not parse is refused by name and the push continues; the exit is 1 so CI notices. When a whole file is refused, or five strings are refused with advice, whichever advice each drew, nothing is pushed at all: one cause is likely behind all of them, and pushing the rest would archive every one.

**`corpus pull`** writes translations back through the same adapters, format-preserving. `--min-state` sets the floor, `verified` by default; `--lang` narrows to one language and repeats. `--check` writes nothing and exits 1 if a pull would have changed a file, which includes a proposal waiting to land.

**`corpus status`** prints the dashboard's numbers, the last push, the server's version, the pending proposals and the writable sources. `--json` is the same as one object, for a gate of your own.

## The ones you run once

**`corpus init`** writes `corpus.config.ts`, adds `.corpus/` to `.gitignore` and prints what to do next. It detects the library from the catalogue it is pointed at. It writes `check.include` from the directories that hold components, of `src`, `app`, `lib`, `components` and `shared`, and says which; when only `src` does, or none, it writes no `check` key and `corpus check` reads `src`. Declare `check.include` yourself when your components live somewhere else.

**`corpus workbench`** starts the web app from your repository, creates the project your config names and writes its token. `--port`, `--db`, `--open`, `--no-provision`.

**`corpus project create`** creates a project against an instance with the instance secret, printing the token once, alone on the last line. `--name` sets the display name, `--server` overrides the config's.

**`corpus project rotate-token`** replaces the token, authenticating with the current one.

## The ones CI runs

**`corpus check`** reads the files `check.include` names and reports text a person would read that did not come from a catalogue. **`corpus validate`** parses the translations in the repository's catalogues against their sources; an `exec` source's are read from its exporter, and one that emits none is named as not validated. Neither needs a network. Both are covered on [Corpus in CI](Corpus-in-CI).

**`corpus build`** produces the snapshot a push would send, without sending it, and prints a one-line summary: the project, the string count by type, the entity count. `--out <file>` is what writes the snapshot itself. Useful for seeing what a push will carry, and for a diff when a push does something you did not expect.

## The ones an agent runs

**`corpus mcp`** speaks the Model Context Protocol on stdio. **`corpus agent`** is the same operations as subcommands, and `--stdin` runs many through one process. Both are covered on [The MCP server](The-MCP-server) and [Agents without MCP](Agents-without-MCP).

## Where things are read from

| What | First | Then |
|---|---|---|
| The config | `corpus.config.ts` | `.mts`, `.js`, `.mjs` |
| The token | `CORPUS_TOKEN` | `.corpus/token` |
| The instance secret | `CORPUS_INVITE_SECRET` | `.corpus/secret`, and only when the server is on this machine |
| The server | `--server`, on the commands that take it | the config's `server` |

`--server` is taken by `init` and by both `project` subcommands, and it overrides the config's `server` rather than replacing the config: `project create` still loads one, for the project's slug and languages. No other command takes it, and passing it is refused rather than ignored — as is any flag a command does not know, so a typo fails instead of quietly running something else.

A config may read the environment itself — `server: process.env.CORPUS_SERVER ?? "http://localhost:3000"` — which is how one repository points at a workbench locally and a team instance in CI.
