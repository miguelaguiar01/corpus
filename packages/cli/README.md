# @corpus-tool/cli

The `corpus` command for [Corpus](https://github.com/miguelaguiar01/corpus), a self-hosted translation workbench for games and apps whose text is structured. The CLI runs inside the repository whose text is translated. Node 22 or later.

## Quick start

```sh
npm install --save-dev @corpus-tool/cli @corpus-tool/workbench
npx corpus init --project my-game --source en \
  --messages "src/i18n/{lang}.json" --server http://localhost:3000
npx corpus workbench      # starts the instance, creates the project, writes .corpus/token
npx corpus push           # the repository's strings, and the translations it already has
npx corpus pull           # verified translations back into the repository's files
```

`init` writes `corpus.config.ts` and adds `.corpus/` to `.gitignore`, creating the file when there is none, as `workbench` does too; it reads the languages from the files that fill `{lang}` and the library from the source file (`{{ }}` and no ICU argument is i18next), or takes `--languages` and `--library <icu|i18next>`. `workbench` starts an instance from the companion package, creates the project the config declares and writes the token to `.corpus/token`. Open the URL, join with the printed secret, translate and verify; `pull` writes the verified rows back, format-preserving, and a second pull changes nothing. For a team's instance, `CORPUS_INVITE_SECRET=<secret> npx corpus project create` prints the project's token once, for `CORPUS_TOKEN` or `.corpus/token`. A package manager with a release-age policy holds back a version published inside its window, and the three write it differently: pnpm's `minimumReleaseAge` in `pnpm-workspace.yaml`, yarn's `npmMinimalAgeGate` in `.yarnrc.yml`, npm's `min-release-age` in `.npmrc`. Each has an allow list for the packages a team trusts on release day: `minimumReleaseAgeExclude`, `npmPreapprovedPackages` and `min-release-age-exclude[]`, where `@corpus-tool/cli` and `@corpus-tool/workbench` are worth naming once. Yarn and npm refuse the install outright; pnpm installs the fresh version and writes the exclusion into `pnpm-workspace.yaml` itself, pinned to that version and saying so, unless `minimumReleaseAgeStrict` is on, when it asks first, or fails where there is no terminal to ask. Otherwise install the previous release, or wait the window out.

## The commands

- `corpus push [--dry-run]`: the repository's strings into Corpus by id; the translations the repository's target-language catalogues already hold travel too, and so does what an `exec` exporter emits as `translations`; both land where Corpus has no edit of its own.
- `corpus pull [--min-state <s>] [--lang <l>]... [--check]`: verified translations (or looser) back into the files, and pending source proposals into the source files; `--check` lists what would change and exits 1 if anything would. An `exec` source's `importCommand` receives on stdin only the rows this pull selected, never the whole catalogue, so it must merge them into its file and leave every other entry alone: a command that rewrites its file from the payload loses every row the pull did not select.
- `corpus status [--json]`: the dashboard's numbers, the writable sources, the pending proposals.
- `corpus validate [--json]`: every translation still fits its source, offline. `corpus check`: no user-facing literal outside the declared sources, over `.jsx`, `.tsx` and `.vue`.
- `corpus build [--out <file>]`: the snapshot with no server, for authoring the config.
- `corpus project create | rotate-token`, `corpus init`, `corpus workbench`.

## Work with an agent

`corpus mcp` is a Model Context Protocol server on stdio for any MCP client: Claude Code, Claude Desktop, Cursor, VS Code, OpenAI's Codex CLI or Agents SDK, Gemini CLI, or an agent of your own. The command is `npx corpus mcp`, started in the repository, registered before the session starts; the repository README shows each client's entry. In Claude Code:

```sh
claude mcp add corpus -- npx corpus mcp
```

`corpus agent` is the same operations as shell commands (`queue`, `string`, `draft`, `propose`, `add`, `proposals`, `withdraw`, `status`), and `corpus agent --stdin` runs many of them through one process, one JSON object per line in and one JSON line per operation out. Each line names its `op` and carries the operation's arguments by name: `queue` with `queue` (`untranslated`, `stale`, `unverifiedSource` or `agentDrafts`) and, optionally, `language` and `type`; `string` with `key`; `draft` with `key`, `language` and `text`; `propose` with `key` and `text`; `remove` with `key`; `add` with `key`, `file` and `text`; `withdraw` with `proposal`; `proposals` and `status` with none; an optional `id` is echoed back on the answer. An agent reads queues and strings as the editor shows them, saves drafts and proposes source changes, under three rules: it never overwrites a person's work, every draft is attributed, and only a signed-in maintainer verifies. The instance must run the same version as the CLI, and a project pushed before 0.7.0 needs one push before proposals know where to go.

## In CI

A job with `CORPUS_TOKEN` can gate a merge: `corpus check`, `corpus validate`, `corpus pull --check`, and `corpus status --json` for the numbers.

Every command but `init` executes the repository's own `corpus.config.ts`, and `push`, `build` and `pull` run the `exec` commands it declares, by design: run them only in repositories you trust, as you would their build scripts. The full guide, the design spec and the changelog live in the [repository](https://github.com/miguelaguiar01/corpus).
