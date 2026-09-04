# Architecture decisions

Decisions made along the way, per AGENTS.md. Newest last. Format:

```
## YYYY-MM-DD — Title
**Decision:** what was decided.
**Why:** the reasoning, in one or two sentences.
**Context:** ticket/PR where it happened.
```

Product decisions the spec defers to the owner (§13) are made on their
tickets in the Blocked lane; only the outcome is recorded here when it
shapes the architecture.

## 2026-09-04 — M0 bootstrap sequence for the PR gate

**Decision:** the earliest M0 PRs open before `bin/gate` exists (it is
built in #10 and wired into CI in #11). Each pre-gate PR states this
explicitly in its body and reports what verification was run instead.
From #10 onward the gate is mandatory before every PR, per AGENTS.md.
Additionally, `bin/gate`'s `corpus check` step is a skip-with-loud-warning
placeholder until M4 delivers the real `corpus check`; the M4 ticket
replaces it.

**Why:** the gate cannot precede the workspaces it checks; sequencing this
openly beats pretending the rule applied before its tooling existed.

**Context:** #6, #10, #11; epic #1.

## 2026-09-04 — Vitest as the test runner

**Decision:** vitest runs all tests, configured once at the monorepo root
(`vitest.config.ts` globs every workspace's `src/**/*.test.ts`).

**Why:** TypeScript-native (no transpile step to maintain), one config for
all workspaces, and it will later host the component tests spec §15 asks
for without switching runners.

**Context:** #9.

## 2026-09-04 — Corpus chrome is authored in English, dogfood-first

**Decision:** the UI chrome's source language is `en`, first target
`pt-PT`. The catalog lives at the `messages` adapter's standard path
(`apps/web/src/i18n/messages.{lang}.json`), uses flat stable
dot-separated keys (key = snapshot string ID), and restricts message
syntax to the ICU subset of §5 (placeholders + `select` only).
`messages.pt-PT.json` is produced by `corpus pull`, never edited by hand.

**Why:** Corpus translates Corpus (§12); authoring the catalog exactly as
the adapter consumes it makes self-translation the two-line standard
config instead of a special case.

**Context:** owner decision on #13.

## 2026-09-04 — Migrations carry descriptive names

**Decision:** every drizzle migration is generated with an explicit name
describing what it changes — `npx drizzle-kit generate --name=<what-it-does>`
(e.g. `0000_users-and-sessions.sql`). Auto-generated whimsical names are
not accepted in review.

**Why:** migration filenames are the schema's changelog; "colorful_odin"
tells a reader nothing (owner directive on #14/PR #24).

**Context:** PR #24.

## 2026-09-04 — Metadata declarations travel in the snapshot

**Decision:** the `corpus/1` envelope carries optional `stringTypes`
(per-type field declarations) and `entityTypes` (labels) alongside
strings and entities.

**Why:** the server renders metadata generically from declarations
(§5 — facets, tooltips, editor chips) but never reads the client's
`corpus.config.ts`; the snapshot is the only channel. §4's additive
versioning makes the addition backward-compatible.

**Context:** #30.
