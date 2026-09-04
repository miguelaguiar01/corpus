# Corpus

Corpus is a self-hosted translation workbench for structured game/app text.
**`docs/corpus-design.md` is the binding spec — read it before writing any
code.** If reality forces a deviation, update the spec in the same PR and say
so in the PR body; never let code and spec disagree silently. Architecture
decisions made along the way are recorded in `docs/DECISIONS.md`.

## Non-negotiables

- **Nothing lands on `main` directly** — every change goes through a PR. (M0
  enables a repo ruleset that rejects direct pushes; until that ruleset is
  active, behave as if it were.) Every PR is reviewed by a **different agent
  than the one that wrote it** — a different tool or, at minimum, a fresh
  independent instance. The reviewer leaves a verdict comment on the PR;
  merge only on an approving verdict.
- **`bin/gate` must pass before opening any PR** — typecheck + lint + full
  test suite + `corpus check` on this repo's own catalog. CI re-runs the gate
  on every PR; CI is the only QA gate this project has.
- **The round-trip invariant is golden**: `push∘pull` reproduces client repo
  files byte-identical (spec §8). Never merge with this test red; never
  weaken it to make a change pass.
- **Purity boundaries**: `packages/contract` and `packages/adapters` perform
  no I/O. The contract's zod schema is the single source of truth for
  snapshot types — web, CLI, and tests import it; nothing redeclares it.
- **No hardcoded user-facing strings**: all UI chrome goes through
  `apps/web/src/i18n/messages.{lang}.json` from the first component
  (spec §12). `corpus check` in the gate enforces this.
- **Dependency rule**: shadcn components are copied in, not installed; any
  new runtime dependency needs a one-sentence justification in the PR that
  adds it.
- **Scope ratchet**: v1 scope is spec §16. Anything beyond it becomes an
  issue in the Backlog — never a drive-by addition to an open PR.

## Commands

- `bin/gate` — typecheck + lint + tests + self `corpus check`; must pass
  before any PR (created in M0; keep it the single entry point).
- `bin/board <issue#> <backlog|ready|in-progress|blocked|done>` — add an
  issue to the Corpus project board and set its lane (created in M0 from the
  IDs below).
- Standard workspace commands: `npm test`, `npm run typecheck`, `npm run dev`
  (wire these in M0 across the workspaces).

## Board and tickets

Work is tracked on GitHub project board **#4 ("Corpus", user
`miguelaguiar01`)** plus repo issues. Lanes and their meaning:

| Lane | Meaning |
|---|---|
| Backlog | Captured, not yet refined |
| Ready | Refined and cleared to start next |
| In progress | Being worked on (move it there when you start) |
| Blocked | Waiting on a dependency or a decision — say which, on the issue |
| Done | Merged and verified |

**Rules:**

- **One epic per milestone** (M0–M4, spec §16), each an issue with a task
  list linking its child issues — the epic tracks overall progress and moves
  to Done only when its milestone's "done when" criterion holds.
- **Granular child tickets**: roughly half a day of work or less, one
  concern each, one PR each (small exceptions fine, say so in the PR).
- **Nothing sits in Ready unrefined.** Refined means the body contains:
  scope, the spec section(s) it implements, acceptance criteria, and any
  dependency/sequencing notes. A one-liner belongs in Backlog until refined.
- Decisions only the owner can make (product taste, naming, anything the
  spec defers in §13) go to **Blocked** with a clearly worded question —
  don't guess and build.

IDs for `bin/board` (project **#4**, owner `miguelaguiar01`):

```
project id:   PVT_kwHOAYLnWs4BiZ1K
status field: PVTSSF_lAHOAYLnWs4BiZ1KzhhSBm0
options:      Backlog=15972a3d  Ready=aefe58df  In progress=fcdf6852
              Blocked=ee89bafc  Done=a6ea2847
```

## Working agreements

- **TDD for pure logic** (diff semantics, ICU parse/validation, adapters,
  state transitions): failing test first, then the implementation.
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`); ESLint +
  Prettier enforced by the gate, not by memory.
- End each milestone with a **simplification/review pass** over what it
  produced, before starting the next epic.
- PR bodies say what changed and how it was verified, and link their ticket
  with a closing keyword (`Closes #N`) so the merge auto-closes the issue
  and the board workflow moves it to Done. Never move a ticket to Done by
  hand — Done is reached only through a merged PR. (Planning-only tickets,
  e.g. writing other tickets, are the one exception; say so on the issue.)
  Report test results honestly — a red suite is a finding, not an
  embarrassment.
