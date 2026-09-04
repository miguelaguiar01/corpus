# Corpus

Corpus is a self-hosted, lightweight translation workbench for games and
apps whose text is *structured* — strings that carry metadata, placeholders,
relations to game objects, and rendering context that flat key-value TMS
tools can't represent well.

Text lives in each project's git repository; Corpus is an editing surface,
never the source of truth. A CLI (`corpus push` / `corpus pull`) syncs the
two, and the round-trip is provably lossless. Corpus translates its own UI
with itself — the standing demo and integration test.

- **[`docs/corpus-design.md`](docs/corpus-design.md)** — the binding design
  spec. Read it before writing any code.
- **[`AGENTS.md`](AGENTS.md)** — workflow, non-negotiables, and the board.
- **[`docs/DECISIONS.md`](docs/DECISIONS.md)** — architecture decisions log.

## Configuration

Environment variables are documented in [`.env.example`](.env.example).
The SQLite database file location is set with `CORPUS_DB_PATH` (default
`./data/corpus.db`); migrations apply automatically on first database
access.

> Under construction (milestone M0). The real README — with screenshots of
> Corpus translating Corpus — lands with M4.
