# Corpus — design spec

**Status:** approved design, pre-implementation.
**Date:** 2026-09-04.
**Destination:** this file is the founding document of the `corpus` repository. It is self-contained: the implementing agent needs no other context, and this spec is **binding** — deviations require updating this document first.

---

## 1. What Corpus is

Corpus is a self-hosted, lightweight translation workbench for games and apps whose text is *structured*: strings that carry metadata (gender, conditions, relations to game objects), placeholders, and rendering context — the kind of corpus that flat key-value TMS tools (Crowdin, Weblate) can't represent well.

One private instance serves a small team (an owner plus a few invited translators), holds multiple **projects**, and is reachable from any browser, including phones. Text lives in each project's git repository — Corpus is an **editing surface**, never the source of truth. A CLI syncs the two.

Corpus's own UI chrome is a Corpus project: the tool translates itself with itself (§12). This is both the demo and a standing integration test.

### Goals
- Catalogue an entire project's user-facing text with search, filters, and progress percentages per language and string type.
- A **verification workflow for the source language** (proofreading), using the same state machine as translation.
- A translation editor that shows metadata, related entities, placeholders, and live previews — usable by a non-technical translator on a phone.
- Round-trip sync with the project's repo that is provably lossless.

### Non-goals (v1)
- Accounts/SSO, per-project permissions, or any user management beyond §10.
- Machine-translation suggestions, translation memory, glossaries, comments/threads.
- Direct git integration (Corpus never clones repos or opens PRs — deferred, §13).
- Editing metadata or entities in the UI. Metadata flows one way: repo → Corpus (§5).
- Running project code. Previews are pre-rendered data (§7).

---

## 2. Architecture

Three parts, one contract:

1. **`apps/web`** — Next.js (App Router) + TypeScript + SQLite. Owns projects, strings, entities, translations, states, users, history. Serves the UI and the HTTP API the CLI talks to. Published to npm as **`@corpus-tool/workbench`** (`packages/workbench`: the built app with its runtime packages as dependencies, nothing vendored), at the same version as the CLI, from the same tag.
2. **`packages/cli`** — the `corpus` binary, published to npm as `@corpus-tool/cli` and run inside a client repo (a client's config imports `defineCorpus` from it; the contract and adapters are bundled in). `corpus push` extracts that repo's text into a snapshot and uploads it; `corpus pull` writes approved translations back into the repo's files. A human (or agent) opens the client repo's PR from there.
3. **`packages/contract`** — the versioned snapshot schema (`"corpus/1"`), defined **once in zod**. Web, CLI, adapters, and tests all import these types. This package is pure (no I/O) and is the only thing web and CLI share.

Plus **`packages/adapters`** — pure functions mapping repo files ↔ snapshot entries (§4). Used by the CLI; unit-testable with no filesystem beyond fixtures.

An instance runs in one of three ways, all the same app and the same database file:

- **`npx corpus workbench`** in the client repository, for one person on their own machine: the CLI starts the workbench package from the repository's `node_modules`, with the database at `.corpus/corpus.db` and a generated instance secret at `.corpus/secret`, and prints the URL and the secret for the first join. When the repository has a `corpus.config.ts` and no `.corpus/token`, the start also creates the project the config declares, unless `--no-provision`, and writes its token to `.corpus/token` (§10), so `corpus push` works in the next shell with nothing pasted; when that project already exists on the instance, it says so and names the settings page, where a maintainer rotates the token, and the file to save it to. Updating is `npm update` of both packages. Nothing else to install.
- **The published container image**, `ghcr.io/miguelaguiar01/corpus:<version>`, for a team: a URL that translators reach from their phones, a volume for the database, HTTPS in front. The image is built by the same tag that publishes the packages, so one version number names all three.
- **A checkout**, for developing Corpus itself.

Monorepo via npm workspaces. Data flow is a loop:

```
client repo ──corpus push──▶ web app (people verify/translate) ──corpus pull──▶ repo files ──PR──▶ merged truth
```

**Truth split (normative):** source text and metadata — the repo wins. Translations and workflow states — Corpus wins. Target-language files in the repo are *outputs* of `pull` (seeded once on first push, see §8).

SQLite is a working copy with history. Losing the database loses only edits not yet pulled; nothing else.

### Stack decisions
- Next.js App Router, TypeScript `strict` + `noUncheckedIndexedAccess`.
- SQLite via Drizzle ORM on `better-sqlite3`; full-text search via an FTS5 virtual table (raw SQL migration).
- UI components: shadcn/ui (copied in, not a dependency) + Tailwind.
- Deployment target: a single Docker container (Next standalone output), SQLite file on a volume.
- The same build runs identically as a local process (`npm run dev`, or the standalone server) and in the container: one code path, with only the database path, the invite secret, and the port coming from the environment. Defaults resolve against the app's own location, never the working directory.
- No other runtime dependencies without a one-sentence justification in the PR that adds them.

---

## 3. Client-repo configuration (`corpus.config.ts`)

The CLI never *discovers* strings — it reads declared sources. Grep-style extraction fails silently; declaration cannot. A client repo commits a typed `corpus.config.ts`:

```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "moonlight-manor",
  server: "https://corpus.example",           // token via CORPUS_TOKEN env
  sourceLanguage: "pt-PT",
  languages: ["pt-PT", "en"],
  stringTypes: { /* §5: metadata field declarations per type */ },
  entityTypes: { /* §6 */ },
  sources: [
    // 1. Standard i18n catalog adapter (flat or nested key-value JSON/TS,
    //    ICU MessageFormat allowed). Zero config beyond the path pattern.
    { adapter: "messages", type: "chrome", path: "src/i18n/messages.{lang}.json" },

    // 2. Generic structured-data adapter: point at a JSON/TS module and map
    //    fields (which is the id, the text, which become metadata).
    { adapter: "table", type: "tutorial-step", path: "src/tutorial/steps.ts",
      map: { id: "id", text: "text" } },
    //    The module's default export, or `export: "STEPS"` for a named one.
    //    Every other field of a record becomes metadata, or only the ones
    //    `map.metadata: ["scene"]` lists.

    // 3. Custom exporter hook: a script in the client repo that emits
    //    snapshot entries (strings and/or entities) directly. Used when only
    //    the project's own code understands its corpus — templates, computed
    //    metadata, pre-rendered examples.
    { adapter: "exec", command: "npx tsx scripts/corpus-export.ts" },
  ],
  // pull writes translations back through the same adapters in reverse;
  // "exec" sources name a companion import command.
});
```

`corpus workbench [--port <n>] [--db <path>] [--open] [--no-provision]` starts the instance of §2's first shape from the repository and prints its URL and secret; `--no-provision` skips the project creation §2 describes. `corpus build` runs the sources and validates the snapshot with no server (`--out <file>` writes it); `push` does the same before it needs a token. Both name every source that cannot take translations back: an `exec` source without `importCommand`, a `messages` or `table` path without `{lang}`, or one that is not `.json` (a `.ts` or `.js` catalogue pushes, but pull rewrites files in place and writes JSON only).

The rest of the CLI needs an instance. `corpus project create [--name <name>] [--server <url>]` posts the config's `project`, `sourceLanguage` and `languages`, with the display name given or the slug in its place, to the server named in the config or in `--server`, and prints the project's token once, alone on the last line of stdout, everything else on stderr, so a CI job can capture it; it writes no file. It authenticates with the instance secret (§10), read from `CORPUS_INVITE_SECRET` or, when the server is a loopback address, from `.corpus/secret`. `corpus project rotate-token [--server <url>]` authenticates with the project's current token, prints the new one the same way, and rewrites `.corpus/token` when that file supplied the token it replaced. `corpus status [--json]` prints the dashboard's numbers (§9.1) per language and per string type with the project token, and names any language the config declares that the project lacks, or the reverse. `corpus validate [--json]` runs the editor's checks (§5, §7) over the target-language `.json` files of every `messages` and `table` source with `{lang}` in its path, with no server: a translation that lost a placeholder or malformed a select is a finding, and so, beyond the editor's checks, is a key the target keeps that the source no longer has; findings print one per line as `file:key: message`, and the exit code is 1 when there is any. Keys a target file lacks are not findings; that is what states are for. `exec` sources are named once as not validated. Where a command needs the project token it reads `CORPUS_TOKEN`, then `.corpus/token`, and names both when neither is set.

**Completeness is enforced client-side, not guessed:** `corpus check` is a lint pass that flags suspicious user-facing string literals outside declared source files (heuristic, à la eslint-plugin-i18next; an ignore list of path prefixes or globs such as `**/*.test.tsx`). Client repos wire it into their CI gate. Config declares where text lives; `check` ensures text only lives there; therefore `push` is complete by construction.

---

## 4. The snapshot contract (`"corpus/1"`)

A push uploads one JSON document:

```jsonc
{
  "contract": "corpus/1",
  "project": "moonlight-manor",
  "sourceLanguage": "pt-PT",
  "strings": [ /* §5 */ ],
  "entities": [ /* §6 */ ],
  "seedTranslations": { /* optional, first-push import, §8 */ }
}
```

Rules:
- Every string and entity has a **stable ID**, unique within the project, stable across pushes. IDs are the identity for diffing; changing an ID is a delete + create.
- The schema is **additive-versioned**: `corpus/1` consumers must ignore unknown fields, so future extensions (e.g. entity form tables, §13) don't break old CLIs.
- The zod schema in `packages/contract` is the normative definition; this section is illustrative.

---

## 5. Strings and metadata primitives

Metadata exists to do exactly four jobs for a translator: **inform** (context to read), **constrain** (validation), **relate** (links to entities), **navigate** (filters/grouping). Every metadata field a project declares has a name, a human `description` (rendered as its tooltip), and one of **five primitive types**:

| Primitive | Declares | UI | Validation |
|---|---|---|---|
| `enum` | fixed set of values | chip + facet filter | value ∈ set |
| `flag` | boolean | chip + facet filter | — |
| `text` | free-form note | inline note | — (escape hatch: what primitives can't express goes here as prose) |
| `placeholders` | named slots the text must keep, each with a description and an optional grammatical `role` tag | insertable tokens/chips in the editor | target must contain exactly the source's slots (§7) |
| `ref` / `list<ref>` | link(s) to an entity | entity card in the editor side rail; facet filter | target of the ref must exist |

Fields are declared **per string type** in `corpus.config.ts`. The UI renders every field generically from its declaration — a new field requires zero UI work. Metadata is read-only in the UI and 100% optional: a bare message catalog with no declarations works day one.

A snapshot string entry:

```jsonc
{
  "id": "skin.seen-at-greenhouse-window",
  "type": "clue-skin",
  "source": "{person} foi {person_gender, select, m {visto} f {vista}} à janela {room_de} às {hour} — e não estava {person_gender, select, m {sozinho} f {sozinha}}.",
  "metadata": {
    "kind": "sighting",                    // enum
    "requires_trait": "trait:insomnia",    // ref → entity
    "requires_windows": true,              // flag
    "note": "Said by the butler; keep it dry."  // text
  },
  "examples": [ /* §7 */ ]
}
```

(The example project throughout this spec, *Moonlight Manor*, is invented. It exists so the spec can show a morphologically rich source language — Portuguese gender agreement, contracted prepositions — without depending on any real game.)

### ICU subset
Source text may use ICU MessageFormat **placeholders** (`{name}`) and **select** (`{g, select, m {…} f {…}}`; a branch key may be a word or a number). Nothing else (no plural, no nesting) in v1 — reject at push time; a count that needs plural forms is a select whose key the client computes (`one` / `other`), until §13's plural decision is taken. This subset is what the editor can render as a friendly branch view rather than raw syntax.

---

## 6. Entities

Entities are the *things strings talk about* — characters, rooms, items, traits. They are not translated in v1; they give translators context and give refs a target.

```jsonc
{
  "id": "trait:insomnia",
  "type": "trait",
  "name": "Insónia",
  "attributes": { "summary": "This character wanders the manor at night." }
}
```

The UI shows an entity card wherever a string refs it, and an entity browser per project (§9). Entity `attributes` are free key-values rendered as a definition list — no schema beyond the entity type's declared label.

---

## 7. Previews: data, not code

Corpus never runs project code. Each string may ship **examples**: concrete slot values plus the source-language render, produced by the client's own exporter at push time.

```jsonc
"examples": [
  {
    "values": { "person": "a Condessa Rosa", "person_gender": "f",
                "room_de": "da estufa", "hour": "21h" },
    "rendered": "A Condessa Rosa foi vista à janela da estufa às 21h — e não estava sozinha."
  },
  {
    "values": { "person": "o Doutor Vaz", "person_gender": "m",
                "room_de": "do salão", "hour": "23h" },
    "rendered": "O Doutor Vaz foi visto à janela do salão às 23h — e não estava sozinho."
  }
]
```

Because examples carry the *values*, the editor can substitute them into a **draft translation** and live-preview the target sentence without any engine — including exercising both branches of a select. Exporters should provide one example per select branch where feasible.

Slot values are language-shaped (note `room_de` arrives with its Portuguese contraction baked in). The `role` tag + description on the placeholder declaration is what tells a translator what the slot arrives as in their language. An example may also carry **`valuesByLanguage`**, a map from target language to slot values resolved for that language, produced by the same exporter from the client's own knowledge of its nouns:

```jsonc
"valuesByLanguage": {
  "en": { "person": "Countess Rosa", "person_gender": "f",
          "room_de": "greenhouse", "hour": "9 pm" }
}
```

A language's map is used whole, never layered over `values`: a slot it lacks stays literal in the preview, as any missing value does. The editor previews a draft with the selected language's values when the example has them, and with the source-language values otherwise, saying which in the preview's heading; a placeholder chip keeps the token as its text, and its hover shows the slot's description and, when the first example carries a value for the selected language, that value. The field is optional and additive: a snapshot without it is what v1 shipped, and Corpus never derives one language's values from another's (form tables stay deferred, §13).

---

## 8. Sync semantics

### `corpus push`
Builds the snapshot from config, validates against the contract locally, uploads with the project bearer token. The server applies it **atomically** (one transaction) as a **diff by ID**:

| Case | Effect |
|---|---|
| new ID | insert; source language `translated` (§11), target languages `untranslated` |
| same ID, source text unchanged | refresh metadata/examples in place; no state changes |
| same ID, source text changed | update source; set `stale` on every existing translation (old target text kept); reset source-language state to `translated` (needs re-verification) |
| ID absent from snapshot | **archive** (hidden from queues and progress; retained with history; auto-unarchives if the ID returns) |

An invalid snapshot is rejected with per-entry errors and **nothing** is applied. The CLI prints the diff report (added / changed / stale / archived). `corpus push --dry-run` prints the report without applying — this must work server-side (same diff, rolled back) so the numbers are exact. The response carries the project's languages, and the CLI warns on one line when they differ from the config's in either direction; it does not change them (§13).

`seedTranslations` (optional, typically first push): existing target-language catalogs found in the repo import as state `translated`. On subsequent pushes, seed data for a string×language that already has any Corpus edit history is **ignored** — Corpus wins on translations.

### `corpus pull`
Downloads translations for the configured target languages — never the source language, whose text belongs to the repository; default only `verified`, `--min-state translated` to loosen — and writes repo files through the adapters (messages/table written directly; `exec` sources invoke their import command with the entries on stdin). `--lang <l>` (repeatable) asks the server for those target languages only (`/api/pull?lang=`), writes only their files and hands `exec` importers only their entries; every other file is left alone, and the source language is refused. `--check` writes nothing and runs no import command: it lists the files a pull would create or change and exits 1 if there are any, so a CI job can assert that the repository already carries what the server would give; `exec` sources are named once as not checked. Prints changed files. The human/agent reviews and PRs.

**Core invariant (tested, §15): push∘pull round-trips byte-identical files** for the built-in adapters — pushing a repo and immediately pulling at `--min-state untranslated` leaves every file exactly as it was, target catalogues the repository already keeps included, and pulling translations that equal a target catalogue's text writes the same bytes. The source-language files are never written.

---

## 9. UI surfaces

All surfaces are project-scoped under `/p/[slug]/…`, with a project switcher (command-palette combobox) in the header. Mobile-first: the design target is a translator on a phone.

1. **Dashboard** — per-language progress bars broken down by string type; **queues** as buttons: *untranslated (n)*, *stale (n)*, *unverified source (n)*. Tapping a queue opens the editor at its first item. A translator should never wonder what to work on. The same numbers, from the same query, are the `/api/status` response, read with the project token, and the output of `corpus status` (§3).
2. **Catalogue** — every string; FTS5 search (accent-insensitive); facet filters auto-generated from metadata declarations plus type, state, language, archived. A language alone lists the strings with text in it (translated or verified, stale included); a state alone, the strings in that state in any language; both, that state in that language. Rows show per-language state chips; click into the editor. This surface is the aggregation/verification view and is fully useful before any translation exists.
3. **Editor** — source left (branch view for selects, placeholder chips, metadata chips, entity cards in a side rail, examples), target right (chip-insertable placeholders — no hand-typed braces), live preview from the draft using example values (the selected language's when the example carries them, §7), save (→ `translated`) and verify (→ `verified`, maintainer only), visible attributed history, next/previous at thumb height to flow through a queue. Validation feedback is inline and specific ("missing {witness}"). The per-language state chips at the top are the **language switcher**: one per language, the selected one marked; the queue the person came from is kept when the switched-to row is in it, and dropped otherwise, so next and previous never point at a row of another queue; the source language's chip is the proofreading view. Placeholder chips keep the token as their text and show the resolved value on hover (§7). Under the source pane, **the other languages**, every language except the source and the selected target, are readable: current text or a quiet "untranslated", the state, stale marked; read only, so save and verify act on one target at a time.
4. **Entity browser** — read-only cards per entity type, narrowed by a type chip or a name search once a project has hundreds.
5. **Maintainer corner** — project settings, push token (generate/rotate), snapshot history (when, counts, stale caused), language list, seen users. Visible to maintainers only. Adding a language creates an `untranslated` row for every active string at once (§11), so the dashboard, the queues and the catalogue show it without a push; removing one keeps its rows for when it comes back.

The tool has its own visual identity (quiet, big type, system light/dark via shadcn theming) — it renders *projects'* text prominently and keeps its own chrome minimal. All chrome strings come from Corpus's own message catalog from the first component (§12).

---

## 10. Users and access

- Accounts are a **display name and a password**, stored in the instance's SQLite (scrypt hashes). One **instance invite secret** (an env var; `corpus workbench` generates one into `.corpus/secret` and prints it) admits new people: joining takes the secret, a name, and a password of at least eight characters. A taken name is refused, except that an account from before passwords existed (no hash yet) is claimed by the first join with its name. Signing in takes name and password. There is no e-mail and no self-service recovery.
- A maintainer can **reset** anyone's password from §9.5: it ends that person's sessions and shows a temporary password once; their next sign-in goes straight to choosing a new one, and nothing else is reachable until they have.
- Sessions live in the database and last 90 days of disuse, renewed on use. **Sign out** ends the session on the server, not just in the browser; so does a password reset, and so does losing the maintainer flag.
- Users have one flag: `maintainer`. The first user created on an instance is a maintainer; maintainers can toggle the flag for other users in the UI. Maintainers verify strings and see surface §9.5. Everyone sees all projects on the instance.
- The CLI authenticates with **per-project bearer tokens** (created at project creation, rotatable), supplied via `CORPUS_TOKEN` or read from `.corpus/token`, which `corpus workbench` writes and `rotate-token` rewrites with owner-only permissions inside the gitignored `.corpus/` — never committed.
- The instance secret also **creates projects**: `POST /api/projects` (slug, display name, source language, languages) creates one when the request presents the secret as a bearer token, and returns the token once, only its hash stored, as from the UI. The secret is what every person on the instance was invited with, so the route hands out no more than a new project's own token, which opens nothing that existed before; a project's token is rotated with the project's current token, `POST /api/projects/<slug>/token`, or by a maintainer in §9.5. The creation route is rate-limited like the join form; the rotation route needs a current token, which is not guessable. Neither logs the secret or a token.
- The instance is expected to run behind the owner's own edge (e.g. Cloudflare Access) for defense in depth, but must be safe without it: secret, passwords, and tokens are sufficient auth; rate-limit the sign-in and join forms; session cookies `HttpOnly`/`SameSite=Lax`, `Secure` when the request is HTTPS or reaches a host other than loopback (a workbench on `http://localhost` works in every browser), security headers on.
- Every page under `/p/[slug]/` calls `requireUser()` itself. The shared layout checks too, but a layout is not an authorization boundary: the App Router can skip an unchanged layout on a client navigation, and the edge proxy (Next's request gate, formerly called middleware) only checks that a session cookie exists.

---

## 11. State machine and history

Per string × language: `untranslated → translated → verified`, plus a `stale` boolean overlay (set by push on source change; cleared by the next save or verify). The **source language** uses the same row type: it starts at `translated` and its verify action is the proofreading sign-off.

Every mutation appends to an `edits` log (who, when, string, language, old → new text/state). Last-write-wins on concurrent edits, with a non-blocking "changed since you opened it" warning in the editor. No locking.

Progress numbers are counts over string×language states, excluding archived strings.

---

## 12. Dogfood: Corpus translates Corpus

- Corpus's UI chrome lives in `apps/web/src/i18n/messages.{lang}.json` from the first component — no hardcoded user-facing literals, enforced by `corpus check` in the repo's own gate.
- The repo carries its own `corpus.config.ts` (a `messages` source — the two-line standard-path case).
- CI boots a throwaway instance, runs `corpus push` and `corpus pull` against it, and asserts the round-trip. The standard adapter path can never silently rot: the tool's own translation would break first.
- This also yields the public demo: screenshots of Corpus translating Corpus, with no private client content involved.

---

## 13. Deferred decisions (recorded, not dodged)

| Decision | Trigger that forces it |
|---|---|
| **Entity form tables** (per-language, per-role grammatical forms as translatable data, with per-language derivation rules) vs. grammar-as-code in each client. The contract's additive versioning reserves an entities `forms` field. Per-language example values (§7, M10) took the cheaper half: the client resolves its nouns per language and ships the results; Corpus derives nothing. | A client wants Corpus, not its own code, to derive a slot's forms. Possibly never. |
| **Direct git integration** (Corpus holds a scoped token, opens translation PRs itself). The CLI snapshot format is the foundation either way. | Manual push/pull demonstrably becomes the bottleneck with real translators. |
| Per-project membership / roles beyond `maintainer`. | A person exists who must be excluded from some project on the instance. |
| ICU plural support. | A source string genuinely needs it (source language pt-PT has so far not). |
| `corpus watch`: re-run build and check as the config or the sources change. Build and check are fast and the loop runs a handful of times per config change; a watcher adds a dependency for it. | An integration reports the manual loop as the thing that slows it down, not the first thing it wished for. |
| `corpus push` reconciles the project's languages with the config's. Today the config is the source of the project's languages once, at creation; afterwards the maintainer corner owns them, push warns on drift (§8) and `corpus status` shows it. | A project whose languages change on both sides, or an integration that adds a language in the config and expects the next push to open it. |

---

## 14. Engineering standards (binding)

Process:
- **PR-only `main`**, enforced by a repo ruleset from the first commit. Every PR is reviewed by a **different agent than the author**, verdict comment before merge.
- **`bin/gate`** (typecheck + lint + all tests + `corpus check` on the repo itself) must pass before opening a PR; CI re-runs it on every PR. CI is the QA gate — there is no other.
- **`AGENTS.md` is written before any code** and encodes: this spec is binding; the gate; the review rule; the module boundaries below; the dependency rule (§2).
- **`docs/DECISIONS.md`** records architecture decisions as they're made.
- **Scope ratchet:** v1 scope is §16. Anything else becomes an issue, never a drive-by addition to an open PR.
- A **simplification/review pass** is scheduled at the end of each milestone, not left to inspiration.

Code:
- Module boundaries as in §2; `contract` and `adapters` stay pure (no I/O). Pure cores, thin shells.
- TDD for the pure logic: diff semantics, ICU parsing/validation, adapters, state transitions.
- TypeScript `strict` + `noUncheckedIndexedAccess`; ESLint + Prettier in the gate.

---

## 15. Testing

- **Contract:** zod schema round-trip tests; golden snapshot fixtures (including one modeled on the *Moonlight Manor* examples with selects, refs, and examples).
- **Invariant:** push∘pull byte-identical round-trip for `messages` and `table` adapters (repo fixture with source and target catalogues in, identical files out; the source files untouched, the target files rewritten through the writer).
- **Diff semantics:** table-driven tests for §8's four cases, including stale marking, archive/unarchive, and seed-ignored-after-edit.
- **Validation:** the placeholder/select rule table (§5, §7 — placeholders must survive; selects may collapse entirely but not be malformed; branch keys must match source when present) as pure unit tests, enforced client- and server-side.
- **UI:** component tests for the editor's validation feedback; **one Playwright smoke** (invite → dashboard → queue → translate with placeholder chips → verify as maintainer → progress updates) running in CI from the first milestone that has an editor.
- **Dogfood CI job** as §12 — a living integration test on every build.

---

## 16. v1 scope and milestones

Ship order (catalogue-first — source-verification value before translation):

- **M0 — Foundations.** Repo, workspaces, AGENTS.md, ruleset, gate, CI, empty Next app with invite auth (§10), Corpus's own message catalog wired (§12). *Done when: gate green in CI, PR-only enforced, app deploys and logs in.*
- **M1 — Contract + push + catalogue.** `packages/contract`, `messages` + `table` + `exec` adapters, `corpus push` (+ `--dry-run`), diff semantics, read-only catalogue with search/facets/progress. *Done when: a fixture repo pushes and its strings browse/filter correctly; diff tests green.*
- **M2 — States + queues + verification.** State machine, edits history, dashboard with queues, verify flow (source-language proofreading works end to end). *Done when: a maintainer can verify the source corpus from a phone.*
- **M3 — Translation + pull.** Editor with placeholder chips, branch view, previews from examples, validation both sides; `corpus pull`; seed-on-first-push; round-trip invariant test green. *Done when: a translator completes a queue item on a phone and `pull` writes correct files.*
- **M4 — Dogfood + polish.** Corpus self-translation live in CI (§12), `corpus check`, entity browser, maintainer corner, Playwright smoke, README with self-translation screenshots. *Done when: §12's CI job is green and the README demo is real.*

M0–M4 are the MVP. One milestone follows it:

- **M5 — Post-MVP refinement.** Frontend and UX refinement of every surface, bugs found outside a milestone's scope, and functionality the owner wants sharpened. During M3 and M4 the epic is only a landing zone for such issues; it is refined when M4 closes, from a design audit against §9, a real-usage pass on a non-dogfood project, and a triage into must-fix and later. *Done when: the must-fix list is empty and the audit's findings are fixed or explicitly deferred.*

M5 is done. The milestones after it:

- **M6 — Ship as a package.** The CLI is published to npm as `@corpus-tool/cli`, one package with the contract and adapters bundled in, built to plain JavaScript with declarations, with `corpus init` scaffolding a config, a release workflow, and an install smoke in CI that installs the packed tarball into a fresh repository and round-trips against the container. *Done when: `npm install` of the CLI in a fresh repository, `corpus init`, `corpus push` and `corpus pull` reproduce that repository byte for byte, verified by a CI job, and the README's quick start is that path.*
- **M7 — External installation feedback.** Corpus is handed to another agent with a real project of its own (tags, relations, and a large number of entities), who installs it from the package and reports on the installation and the use. The report is triaged into must-fix and later; the epic is a landing zone until the report exists and is refined from it. *Done when: the report exists and its must-fix list is empty.*
- **M8 — Corpus runs from npm.** The web app ships as `@corpus-tool/workbench`, released by the same tag at the same version as the CLI; `npx corpus workbench` starts it on localhost with the database and secret under `.corpus/`, no Docker; the container image is published per tag for the team case; the README's quick start becomes two npm commands, with the container as the path for a team. *Done when: in a fresh repository, `npm install --save-dev @corpus-tool/cli @corpus-tool/workbench` and `npx corpus workbench` give a working instance on localhost that `corpus init`, `push` and `pull` round-trip against, verified by a CI job with no Docker on that path; one tag publishes both packages and the image at one version; the README's quick start is that path.*
- **M9 — The CLI covers the headless path.** Every step the integration project had to do in a browser or with a raw query gets a command: the project is provisioned from `corpus.config.ts`, by `corpus workbench` when it starts without a `.corpus/token`, which writes the token there, or by `corpus project create` against any instance, which prints it; `corpus status` prints the dashboard's numbers; `corpus pull --lang` scopes a pull and `--check` asserts one is not needed; `corpus validate` runs the editor's checks offline over the target files. *Done when: in a fresh repository with a config, `npx corpus workbench` followed by `corpus push`, `corpus status`, `corpus pull --lang <l>` and `corpus validate` work with no browser and no token pasted, verified by the install smoke; `bin/dogfood` and the screenshot fixture no longer insert projects by hand; the README's CI section shows the status, validate and pull-check gates.*
- **M10 — The editor speaks the target language.** Examples carry slot values per target language, so a draft previews as the real target sentence and a placeholder chip says what it resolves to; the editor's language chips switch the target on the string itself; the other languages are readable under the source while translating. *Done when: on a string with two target languages, a translator switches between them on the editor page, sees every other language's text and state under the source, and, when the pushed examples carry values for the selected language, sees the draft previewed with those values and each placeholder's resolved value on hover; the Moonlight Manor fixture carries English values so the contract's tests, the smoke and the screenshots exercise it; released as 0.6.0.*

Everything not listed here is §13 or a future issue.
