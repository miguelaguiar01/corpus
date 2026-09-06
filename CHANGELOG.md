# Changelog

The published package is `@corpus-tool/cli`. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and stay below 1.0 while the
contract (`corpus/1`) is the only one.

## [Unreleased]

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

[Unreleased]: https://github.com/miguelaguiar01/corpus/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.2.0
[0.1.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.1
[0.1.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.0
