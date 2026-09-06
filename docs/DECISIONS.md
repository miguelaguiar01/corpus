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

## 2026-09-04 — jiti loads the client's corpus.config.ts

**Decision:** the CLI loads `corpus.config.ts` at runtime with jiti, a
TypeScript/ESM loader, rather than requiring the client repo to compile
its config first.

**Why:** §3's config is authored in TS and imports `@corpus/contract`;
jiti runs it directly with no build step in the client repo, keeping
`corpus push` a single command. One small dependency, scoped to the CLI.

**Context:** #42.

## 2026-09-04 — Version token is the row's `updated_at`, advisory only

**Decision:** concurrent-edit detection (§11) uses the translation row's
`updated_at` in milliseconds as the version token. The editor submits the
token it opened with; the transition still applies (last write wins, no
locking) and the result carries `changedSinceOpened` for a non-blocking
warning.

**Why:** the column already changes on every applied transition, so no
extra counter or migration is needed; the warning is advisory by spec, so
millisecond resolution is enough.

**Context:** #87.

## 2026-09-04 — Entity type labels are persisted on the project

**Decision:** `projects.entity_types` stores the snapshot's `entityTypes`
declarations, refreshed on every push like `string_types`.

**Why:** entity cards render the type's declared label (§6) and the server
never reads the client's config, so the snapshot is the only channel and
the label has to survive between pushes.

**Context:** #90.

## 2026-09-04 — M5 post-MVP refinement milestone

**Decision:** §16 gains an M5 after the MVP (M0–M4): refinement and
polish driven by a design audit, a real-usage pass, and triage. Until M4
closes, the M5 epic is only a landing zone for out-of-scope bugs and
polish ideas; it is refined planning-first when M4 ends.

**Why:** v1 scope was bounded on purpose (scope ratchet), which left no
home for the refinement work an MVP always needs. Naming the milestone
keeps that work planned and reviewed rather than drive-by.

**Context:** owner decision on 2026-09-04, at the close of M2.

## 2026-09-04 — Pull writes JSON files only; TS-module sources go through `exec`

**Decision:** the adapters' write side regenerates `messages` and `table`
files only when they are JSON. A source that is a TypeScript module is
read on push but not written on pull; a project that wants translations
back into a TS module names an `exec` import command (§3). Two JSON
layouts round-trip byte-identical: JSON.stringify's expanded form (any
indent, with or without a trailing newline) and, for tables, one record
per line.

**Why:** a TS module cannot be reproduced byte for byte from its data,
and the round-trip invariant (§8) is worth more than write support for
one more file type. The exec hook already exists for exactly this case.

**Context:** #110.

## 2026-09-05 — Host and image share one Node major (22)

**Decision:** `engines.node` is `22.x`, `.nvmrc` says `22`, CI reads
`.nvmrc`, and the Dockerfile's builder and runner are `node:22-slim`.

**Why:** `better-sqlite3` is a native module. Prebuilt binaries exist for
common platforms, so a newer host often works by luck; when they do not,
a mismatched major means a toolchain and a confusing first install. One
number in four places keeps mode 1 (local) and mode 2 (container)
honest with each other (§2).

**Context:** #131, from the local-vs-container review.

## 2026-09-05 — Build identity is the git describe string, stamped into the image

**Decision:** the Docker image takes `--build-arg CORPUS_VERSION` (CI passes
`git describe --tags --always --dirty`, e.g. `v0.4.0-3-gabc1234`), baked
into the runner as an env var. `/api/health` returns it alongside `status`,
and the maintainer corner shows it. An unstamped build reports `dev`.

**Why:** a running instance must be traceable to a commit without a
login, and health is the endpoint operators already poll. The snapshot
contract version (`corpus/1`, §4) is a different axis and stays separate.

**Context:** #139, owner-requested on 2026-09-04.

## 2026-09-05 — IBM Plex Sans and Mono are the one typeface pair

**Decision:** the web app sets IBM Plex Sans (400/500/600) for chrome and
project text and IBM Plex Mono (400/500) for identifiers and ICU, loaded
through `next/font/google`. The files are downloaded once at `next build`
and served from `/_next/static`, so the running app is network-free and
the CSP's `default-src 'self'` covers them; the image build itself does
need network access for that step (vendoring the woff2 files with
`next/font/local` would remove that, if it ever matters). `font-bold`
resolves to 600 so the browser never synthesises a weight that was not
loaded. The full token system is in `docs/design.md`.

**Why:** the spec asks for a quiet identity where a project's text is the
prominent thing (§9); Plex has wide language coverage for that text, a
matching mono for string keys and braces, and reads as a tool rather than
a template. Self-hosting keeps the runtime network-free.

**Context:** #166, from the M5 design audit on epic #114.

## 2026-09-05 — Previews name the language of their values and mute them

**Decision:** the editor's preview heading says which language the example
values come from ("Preview with pt-PT values"), and the substituted values
render in the quiet tone while the translator's own words stay in the
foreground tone. The contract gains `renderPreviewSegments`, the same
substitution as `renderPreview` but keeping value and draft text apart;
`renderPreview` is built on it.

**Why:** example values are source-language values used as-is for every
target (§7, §13); a preview like "was seen at the da estufa window" must
read as data the translator cannot fix here, not as their mistake.

**Context:** #175, from the M5 demo finding (#145).

## 2026-09-05 — One published package, `@corpus-tool/cli`, with the contract folded in

**Decision:** the only package on npm is `@corpus-tool/cli` (binary
`corpus`), under the `corpus-tool` organisation. A client project's
`corpus.config.ts` imports `defineCorpus` and `CorpusConfig` from it; the
`@corpus/contract` and `@corpus/adapters` workspace packages stay private
and are bundled into the CLI's `dist` by esbuild, with their declarations
emitted alongside and rewritten to relative paths. Runtime dependencies
stay external: `jiti` (loads the client's TypeScript config), `typescript`
(`corpus check` parses source files) and `zod` (the contract's schemas).
Inside the workspace, `@corpus-tool/cli` resolves to the CLI's source
through `tsconfig` paths and the vitest alias, so nothing in the repo
depends on a build having run except `bin/gate`'s own build step.

**Why:** nothing in a client project touches Corpus at runtime, so a second
package would be ceremony; the `@corpus` scope belongs to an existing npm
account, and `corpus-tool` was free as an organisation.

**Context:** #200 (owner decision), #201; epic #199.

## 2026-09-05 — Releases are tags; npm publishes through trusted publishing

**Decision:** `@corpus-tool/cli` is versioned in its `package.json` with a
matching `CHANGELOG.md` section (keep-a-changelog). A tag `v<version>` on
`main` runs `.github/workflows/release.yml`: it checks the tag against the
package and the changelog, runs the install smoke, publishes with npm's
trusted publishing (OIDC from GitHub Actions, provenance attached
automatically, no long-lived token in the repository), and creates the
GitHub release from the changelog section. A prerelease version publishes
under the dist-tag `next`. The first version is published by hand because
trusted publishing is configured on a package that already exists. The
web app keeps `git describe` as its build identity.

**Why:** one number in one file, one command to ship it, and nothing a
leaked secret could publish.

**Context:** #205; epic #199.

## 2026-09-05 — Accounts are a name and a password in the instance database

**Decision:** joining an instance takes the invite secret, a display
name, and a password; signing in takes the name and password. Passwords
are scrypt hashes in SQLite beside the users they belong to. A taken name
is refused, so the invite secret no longer lets anyone become anyone; an
account created before passwords existed is claimed by the first join
with its name. Maintainers reset passwords from the settings page (a
temporary password shown once, sessions ended, a new password forced at
the next sign-in). Sessions are server-side rows that sign-out, a reset,
and demotion end; they expire after ninety days of disuse. No e-mail, no
external identity provider, no self-service recovery.

**Why:** the pre-publish audit found that the shared secret alone made
every display name impersonable by anyone who had it, and that nothing
ever ended a session. A password per person closes both without adding a
service, which is the constraint the whole deployment story rests on.

**Context:** #220, #219; audit #216.
