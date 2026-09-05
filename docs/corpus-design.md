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

1. **`apps/web`** — Next.js (App Router) + TypeScript + SQLite. Owns projects, strings, entities, translations, states, users, history. Serves the UI and the HTTP API the CLI talks to.
2. **`packages/cli`** — the `corpus` binary, run inside a client repo. `corpus push` extracts that repo's text into a snapshot and uploads it; `corpus pull` writes approved translations back into the repo's files. A human (or agent) opens the client repo's PR from there.
3. **`packages/contract`** — the versioned snapshot schema (`"corpus/1"`), defined **once in zod**. Web, CLI, adapters, and tests all import these types. This package is pure (no I/O) and is the only thing web and CLI share.

Plus **`packages/adapters`** — pure functions mapping repo files ↔ snapshot entries (§4). Used by the CLI; unit-testable with no filesystem beyond fixtures.

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
  server: process.env.CORPUS_SERVER!,        // token via CORPUS_TOKEN env
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

**Completeness is enforced client-side, not guessed:** `corpus check` is a lint pass that flags suspicious user-facing string literals outside declared source files (heuristic, à la eslint-plugin-i18next; configurable ignore list). Client repos wire it into their CI gate. Config declares where text lives; `check` ensures text only lives there; therefore `push` is complete by construction.

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
Source text may use ICU MessageFormat **placeholders** (`{name}`) and **select** (`{g, select, m {…} f {…}}`). Nothing else (no plural, no nesting) in v1 — reject at push time. This subset is what the editor can render as a friendly branch view rather than raw syntax.

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

Slot values are language-shaped (note `room_de` arrives with its Portuguese contraction baked in). The `role` tag + description on the placeholder declaration is what tells a translator what the slot arrives as in their language. Cross-language slot-value provisioning is deferred (§13); for v1, example values are source-language values, which previews use as-is for all targets — imperfect for grammar, sufficient for meaning.

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

An invalid snapshot is rejected with per-entry errors and **nothing** is applied. The CLI prints the diff report (added / changed / stale / archived). `corpus push --dry-run` prints the report without applying — this must work server-side (same diff, rolled back) so the numbers are exact.

`seedTranslations` (optional, typically first push): existing target-language catalogs found in the repo import as state `translated`. On subsequent pushes, seed data for a string×language that already has any Corpus edit history is **ignored** — Corpus wins on translations.

### `corpus pull`
Downloads translations for the configured languages — default only `verified`, `--min-state translated` to loosen — and writes repo files through the adapters (messages/table written directly; `exec` sources invoke their import command with the entries on stdin). Prints changed files. The human/agent reviews and PRs.

**Core invariant (tested, §15): push∘pull round-trips byte-identical files** for the built-in adapters — pushing a repo and immediately pulling at `--min-state untranslated` reproduces the source files exactly.

---

## 9. UI surfaces

All surfaces are project-scoped under `/p/[slug]/…`, with a project switcher (command-palette combobox) in the header. Mobile-first: the design target is a translator on a phone.

1. **Dashboard** — per-language progress bars broken down by string type; **queues** as buttons: *untranslated (n)*, *stale (n)*, *unverified source (n)*. Tapping a queue opens the editor at its first item. A translator should never wonder what to work on.
2. **Catalogue** — every string; FTS5 search (accent-insensitive); facet filters auto-generated from metadata declarations plus type, state, language, archived. Rows show per-language state chips; click into the editor. This surface is the aggregation/verification view and is fully useful before any translation exists.
3. **Editor** — source left (branch view for selects, placeholder chips, metadata chips, entity cards in a side rail, examples), target right (chip-insertable placeholders — no hand-typed braces), live preview from the draft using example values, save (→ `translated`) and verify (→ `verified`, maintainer only), visible attributed history, next/previous at thumb height to flow through a queue. Validation feedback is inline and specific ("missing {witness}").
4. **Entity browser** — read-only cards per entity type.
5. **Maintainer corner** — project settings, push token (generate/rotate), snapshot history (when, counts, stale caused), language list, seen users. Visible to maintainers only.

The tool has its own visual identity (quiet, big type, system light/dark via shadcn theming) — it renders *projects'* text prominently and keeps its own chrome minimal. All chrome strings come from Corpus's own message catalog from the first component (§12).

---

## 10. Users and access

- Accounts are a **display name and a password**, stored in the instance's SQLite (scrypt hashes). One **instance invite secret** (env var) admits new people: joining takes the secret, a name, and a password of at least eight characters. A taken name is refused, except that an account from before passwords existed (no hash yet) is claimed by the first join with its name. Signing in takes name and password. There is no e-mail and no self-service recovery.
- A maintainer can **reset** anyone's password from §9.5: it ends that person's sessions and shows a temporary password once; their next sign-in goes straight to choosing a new one, and nothing else is reachable until they have.
- Sessions live in the database and last 90 days of disuse, renewed on use. **Sign out** ends the session on the server, not just in the browser; so does a password reset, and so does losing the maintainer flag.
- Users have one flag: `maintainer`. The first user created on an instance is a maintainer; maintainers can toggle the flag for other users in the UI. Maintainers verify strings and see surface §9.5. Everyone sees all projects on the instance.
- The CLI authenticates with **per-project bearer tokens** (created at project creation, rotatable), supplied via `CORPUS_TOKEN` — never committed.
- The instance is expected to run behind the owner's own edge (e.g. Cloudflare Access) for defense in depth, but must be safe without it: secret, passwords, and tokens are sufficient auth; rate-limit the sign-in and join forms; session cookies `HttpOnly`/`SameSite=Lax`, security headers on.
- Every page under `/p/[slug]/` calls `requireUser()` itself. The shared layout checks too, but a layout is not an authorization boundary: the App Router can skip an unchanged layout on a client navigation, and the edge middleware only checks that a session cookie exists.

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
| **Entity form tables** (per-language, per-role grammatical forms as translatable data, with per-language derivation rules) vs. grammar-as-code in each client. The contract's additive versioning reserves an entities `forms` field. | A client ships engine text in a second language where slot grammar can't be derived by a trivial rule (for pt→en it can: "of the " + name). Likely at that client's engine-localization phase; possibly never. |
| **Direct git integration** (Corpus holds a scoped token, opens translation PRs itself). The CLI snapshot format is the foundation either way. | Manual push/pull demonstrably becomes the bottleneck with real translators. |
| Per-language example slot values for previews. Evidence from the M5 demo: a draft English translation previews as "was seen at the da estufa window", the Portuguese contraction baked into the value; the editor now names the values' language and renders them in the quiet tone so the mismatch reads as data, not as the translator's error. | Same trigger as form tables; revisit together. |
| Per-project membership / roles beyond `maintainer`. | A person exists who must be excluded from some project on the instance. |
| ICU plural support. | A source string genuinely needs it (source language pt-PT has so far not). |

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
- **Invariant:** push∘pull byte-identical round-trip for `messages` and `table` adapters (repo fixture in, identical files out).
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

M5 is done. Two milestones follow it:

- **M6 — Ship as a package.** The CLI and the contract it imports are published to npm, built to plain JavaScript with declarations, with `corpus init` scaffolding a config, a release workflow, and an install smoke in CI that installs the packed tarballs into a fresh repository and round-trips against the container. *Done when: `npm install` of the CLI in a fresh repository, `corpus init`, `corpus push` and `corpus pull` reproduce that repository byte for byte, verified by a CI job, and the README's quick start is that path.*
- **M7 — External installation feedback.** Corpus is handed to another agent with a real project of its own (tags, relations, and a large number of entities), who installs it from the package and reports on the installation and the use. The report is triaged into must-fix and later; the epic is a landing zone until the report exists and is refined from it. *Done when: the report exists and its must-fix list is empty.*

Everything not listed here is §13 or a future issue.
