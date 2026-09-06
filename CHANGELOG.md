# Changelog

The published package is `@corpus-tool/cli`. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and stay below 1.0 while the
contract (`corpus/1`) is the only one.

## [Unreleased]

### Added

- `table` sources read a named export (`export: "STEPS"`) and can list the fields to carry as metadata (`map.metadata`).

### Fixed

- Table and messages errors name the source file and no longer escape as stack traces; a non-scalar table field names `map.metadata` as the way to leave it out.

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

[Unreleased]: https://github.com/miguelaguiar01/corpus/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.1
[0.1.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.0
