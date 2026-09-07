# Changelog

The published packages are `@corpus-tool/cli` and `@corpus-tool/workbench`, at one version. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and stay below 1.0 while the
contract (`corpus/1`) is the only one.

## [Unreleased]

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

[Unreleased]: https://github.com/miguelaguiar01/corpus/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.1
[0.4.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.0
[0.3.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.1
[0.3.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.0
[0.2.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.2.0
[0.1.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.1
[0.1.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.0
