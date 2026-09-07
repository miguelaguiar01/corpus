# Changelog

The published packages are `@corpus-tool/cli` and `@corpus-tool/workbench`, at one version. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and stay below 1.0 while the
contract (`corpus/1`) is the only one.

## [Unreleased]

## [0.6.0] - 2026-09-07

The editor speaks the target language.

### Added

- Examples may carry `valuesByLanguage`, slot values resolved per target language by the client's exporter; the contract stays `corpus/1`. The editor previews a draft with the selected language's values when the example has them, and says which language the preview is in; a placeholder chip's hover shows the slot's description and the value it resolves to.
- The editor's language chips switch the target language on the string itself, keeping the queue when the switched-to row is in it.
- The other languages of a string are readable under the source while translating: current text, state, stale marked. Read only; editing stays one target at a time.
- The Moonlight Manor fixture carries English example values, so the smoke and the screenshots show an English draft previewing as the English sentence.

## [0.5.0] - 2026-09-07

The CLI covers the headless path: what the first outside integration asked for, ranked by how often it was blocked.

### Added

- `corpus workbench` creates the project `corpus.config.ts` declares when it starts in a repository with no `.corpus/token`, and writes the token there (owner-only); an existing project is named with its settings page. `--no-provision` opts out.
- `corpus project create [--name] [--server]` creates the config's project on any instance with the instance secret (`CORPUS_INVITE_SECRET`, or `.corpus/secret` for a local workbench) and prints the token alone on the last line of stdout; `corpus project rotate-token` replaces a token with the current one and rewrites `.corpus/token` when that is where it came from. Server side: `POST /api/projects` with the secret, rate-limited like the join form, and `POST /api/projects/<slug>/token` with the current token.
- Where a command needs the project token it reads `CORPUS_TOKEN`, then `.corpus/token`.
- `corpus status [--json]`: the dashboard's numbers in the terminal, per language and per string type, with the string count, the last push and the server's version, and a line naming any language the config and the project disagree on. `GET /api/status` with the project token.
- `corpus pull --lang <l>` (repeatable) pulls one language's files and leaves the rest alone (`/api/pull?lang=`); `corpus pull --check` writes nothing and exits 1 when a pull would change a file.
- `corpus validate [--json]`: the editor's checks over the target files of every JSON source, offline: a dropped placeholder, a malformed select, or a key the source no longer has is a finding, `file:key: message` one per line, exit 1. The repository's own gate runs it.
- `corpus push` names languages the config declares that the project lacks, and the reverse.

### Changed

- The gate scripts (`bin/dogfood`, `bin/install-smoke`, the screenshot fixture) create their projects through the CLI and the API instead of inserting rows by hand.
- The README's quick start is `init`, `workbench`, `push`; a section on CI gates; the screenshots are retaken at a smaller desktop viewport with a staged project that shows every state.

## [0.4.1] - 2026-09-07

What the demo project's integration found.

### Fixed

- `pull` leaves the source language alone: its catalogue is never rewritten (a compact JSON file stays as it is) and an `exec` importer no longer receives source-language text.
- Workbench: the session cookie is `Secure` when the request is HTTPS or reaches a host other than loopback, not whenever the build is production, so `corpus workbench` on `http://localhost` or `http://127.0.0.1` signs in from Safari and from automation.
- Workbench: adding a language in settings creates an untranslated row for every active string at once, so the dashboard, the queues and the catalogue show it without a push; a push also fills any gap.

## [0.4.0] - 2026-09-07

Corpus runs from npm. This file now covers both packages, which share a version.

### Added

- `@corpus-tool/workbench`, the web app as a package: the built app with Next, React and the SQLite binding as dependencies, 1.3 MB packed; its `corpus-workbench` bin starts the app from `CORPUS_DB_PATH`, `CORPUS_INVITE_SECRET`, `PORT` and `HOSTNAME`.
- `corpus workbench [--port <n>] [--db <path>] [--open]` starts an instance from the repository with `@corpus-tool/workbench` installed beside the CLI: database and a generated secret under `.corpus/` (added to `.gitignore`), the URL and the secret printed once it answers, Ctrl-C stops it.
- The container image is published with each release as `ghcr.io/miguelaguiar01/corpus:<version>` and `:latest`; `compose.yaml` pulls it.

## [0.3.1] - 2026-09-06

### Fixed

- A `messages` or `table` catalogue that is not JSON (`.ts`, `.js`) is named by `build` and `push` as one pull cannot write back, and `pull` skips it with that message instead of failing inside `JSON.parse`.

## [0.3.0] - 2026-09-06

### Added

- `check.ignore` entries may be globs (`**/*.test.tsx`); a plain entry is still a path prefix.
- A select branch key may be a number (`{n, select, 1 {…} other {…}}`).

## [0.2.0] - 2026-09-06

What the first outside installation asked for.

### Added

- `table` sources read a named export (`export: "STEPS"`) and can list the fields to carry as metadata (`map.metadata`).
- `corpus build` runs the sources and validates the snapshot with no server; `--out <file>` writes it.
- `build` and `push` name every source that cannot take translations back (an `exec` source without `importCommand`, a path without `{lang}`).

### Changed

- `push` builds and validates the snapshot before it needs `CORPUS_TOKEN`, so config and exporter errors reach the author first.

### Fixed

- Table and messages errors name the source file and no longer escape as stack traces; a non-scalar table field names `map.metadata` as the way to leave it out.
- A JSON table that names an `export` is an error instead of being silently ignored; `pull`'s message for a path without `{lang}` matches `push`'s.

## [0.1.1] - 2026-09-06

### Fixed

- `corpus push` now carries the config's `stringTypes` and `entityTypes` in the snapshot, so an instance renders and validates declared metadata (enums, flags, refs, placeholders) and labels entity types. Before, the declarations never left the repository.

## [0.1.0] - 2026-09-05

The first published version.

### Added

- `corpus init` writes a `corpus.config.ts` from flags and prints the next steps.
- `corpus push` diffs a repository's text into a Corpus instance by string id: adds, changes (marking translations stale), archives.
- `corpus pull [--min-state <state>]` writes translations back through the same adapters, format-preserving; push then pull reproduces the repository byte for byte.
- `corpus check` lints for user-facing literals outside the declared sources.
- The `messages`, `table` and `exec` adapters, and the `corpus/1` snapshot contract with its ICU subset (placeholders and `select`).
- The package ships plain JavaScript for Node 22 with type declarations; a client's config imports `defineCorpus` from `@corpus-tool/cli`.

[Unreleased]: https://github.com/miguelaguiar01/corpus/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.6.0
[0.5.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.5.0
[0.4.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.1
[0.4.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.0
[0.3.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.1
[0.3.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.0
[0.2.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.2.0
[0.1.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.1
[0.1.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.0
