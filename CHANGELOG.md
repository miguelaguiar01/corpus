# Changelog

The published packages are `@corpus-tool/cli` and `@corpus-tool/workbench`, at one version. This file follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) and stay below 1.0 while the
contract (`corpus/1`) is the only one.

## [Unreleased]

### Fixed

- `corpus check` no longer gives a clean bill over components it cannot parse: it reads `.jsx` and `.tsx`, so a tree of Vue or Svelte single-file components parsed to nothing while the command reported no literals and exited 0 (Vikunja: 224 `.vue` files, 0 `.tsx`, untranslated English in its templates). It now says how many files it read, names every scanned directory it parsed nothing in, and exits 1 when it parsed nothing at all.

## [0.16.0] - 2026-09-21

What Outline and Jellyfin found: i18next catalogues, natural keys, a hundred languages.

### Changed

- The Moonlight Manor fixture carries a plural string (`ui.marks-left`, three examples with counts), so the install smoke, the screenshots and every test that walks the fixture exercise one; the README's screens show the editor on it.
- A source string that does not parse no longer blocks the push (§8): `corpus build` and `corpus push` name it with its file and key, leave it out, go on with the rest, and exit 1 with the count so CI notices; a refused string the project already holds is archived like any absent id until it parses. Outline's one stray `</em>` had refused all 1920 strings. A file that does not read, a duplicate id or an exporter that fails still fails the whole build.

### Fixed

- After the i18next syntax: the string page's key heading keeps a key's line breaks; i18next's unescaped form `{{- name}}` parses, as the placeholder `-name`, kept apart from `{{name}}` since the two escape differently; the proposal refusal and the editor's message say the text must parse as a source instead of naming ICU; §5's example entry lists `file` and `syntax`.
- `corpus validate` prints an orphan key once, with the number of target files that carry it, and counts orphan keys apart from invalid translations in its last line; `--json` keeps one finding per file. Outline's 22 removed keys in 27 languages were 594 lines.
- A seed equal to the source text no longer counts as translated (§8): an exporter fills a missing row with the source (Crowdin writes the English where a language has none, and Outline read 1907 of 1920 translated in every language), so the row keeps the text, for the round trip, and stays `untranslated`, so the dashboard and the queues count it as work; saving it in the editor makes it translated. The push report carries `seedsIdentical` and the push line says how many were kept untranslated.
- `corpus check` treats a react-i18next `Trans` element as a catalogue call: its text children, the strings in braces under it and its user-facing props are the translation's key in the natural-key style, not findings; text beside it still is. On Outline, 109 of 251 findings were `Trans` children.
- The string page finds a key with a space or any encoded character again: the App Router hands a page its segment percent-encoded, unlike a route handler, so the page decodes it once (guarded; bad encoding is a 404). A change in this batch had removed the decode on the belief that Next decodes page params; it does not, verified on a dev server, and every natural key was a 404 in the workbench.

### Added

- The dashboard's table, shown from eight languages, keeps the per-type breakdown: a project with more than one string type opens the per-type bars behind a disclosure on the row, closed by default, so a many-language project sees one bar per language and the breakdown on demand (§9.1).
- The language bar becomes a picker from forty languages (§9.3): the source segment with its verified mark, the selected language as the control, and the rest in a list that filters on the code as you type; Jellyfin's 108 languages took the first screen as a wrapped bar, four rows on a desktop and fifteen on a phone. Below forty the wrapped bar is unchanged.
- `corpus check` names `check.allow` when at least half of five or more findings are single words: on Jellyfin, 61 of 74 findings are one token, catalogue keys used as text, encoder presets and names such as `AC-4` and `XMLTV`, most of which belong in the allow list rather than the catalogue. The README's configuration example and §3 show the allow list.
- i18next's plural forms are siblings (§9.3): a key ending in `_plural`, `_zero`, `_one`, `_two`, `_few`, `_many` or `_other` is shown with its base key and the other forms in the siblings section and in `get_string`, beside the prefix siblings; a sentence key, which has no prefix, still shows its family. Outline has 64 such pairs.
- A rich-text tag's name may be a bare number (§5): react-i18next indexes a `Trans` element's children as `<1>`, `<2>`, and Outline writes `<2>{sharedParent.sourceTitle}</2>`; a translation that drops one is now a `missing-tag` finding instead of the tag passing as text.
- `corpus init` takes `--syntax <icu|i18next>` and, without it, reads the syntax from the source file: values with `{{ }}` and no ICU argument mean i18next, written on the source and said in the output. Outline's config needed a hand edit for it.
- A source may declare `syntax: "i18next"` (§3, §5): `{{name}}` and `{{ name }}` are placeholders (a dotted name and a format after a comma as i18next writes them), a single brace is text, and the text is stored and written back as written, so an i18next catalogue's round trip holds; the string carries its syntax to the editor, the agent's `get_string`, validation, previews and `corpus validate`, and the chips insert `{{name}}`. Outline's 365 interpolated strings push.
- A string id may be any text without control characters, a line break or a tab aside, up to a thousand characters (§4): i18next's natural keys, the English sentence itself with its spaces and punctuation, push as they are; 1578 of Outline's 1920 keys. A key with whitespace has no sibling prefix (§9.3), since its dots end clauses.
- A placeholder or argument name may be a bare number (`{0}`, `{1}`), as ICU allows and Jellyfin's catalogue writes in 85 strings (§5).
- A language code may use underscores as i18next and Crowdin write it (`en_US`, `zh_CN`); it is kept as written in paths, the config, the API and the UI, and given to the runtime's locale data in its BCP 47 form (§3).

## [0.15.0] - 2026-09-21

What the full Álibi run and Homarr found.

### Changed

- The README's agent section connects any MCP client, not only Claude Code: the server's command and working directory, then the entry for Claude Code, Claude Desktop, Cursor, VS Code, OpenAI's Codex CLI and Agents SDK, Gemini CLI, and a client of one's own.
- The language bar wraps its segments, so a project of dozens of languages takes rows on a phone instead of overprinting them.
- The dashboard shows a table of one row per language from eight languages on, instead of a block per language; Homarr's 36 blocks of one bar each were a wall.
- The other languages under the editor show the first five open and fold the rest behind their count; Homarr's string pages carried 34 texts under every editor. Corpus's own chrome renders its messages through the contract's engine, so the self catalogue may use select and plural (the fold's count is the first).

### Fixed

- A push whose seeds already match no longer costs a write per seed: the server reads the project's rows once and updates only where a seed differs (Homarr's no-op push of 98,402 seeds went from 12 s of updates to a comparison), and the edits it checks are the project's own. The CLI gzips a request body from 256 KiB and the server inflates it under the cap, which is now 32 MiB on the inflated body (8 MiB before; Homarr's push was 3% under it).
- `corpus check` reads a string in braces as a prop's value (`size={"sm"}`, `align={"start"}`) under the prop rule, so only a user-facing prop makes it a finding; on a Mantine codebase that was 160 of 190 findings. With none of the included directories present (Homarr has no `src`), it says nothing was scanned and exits 1 instead of reporting no literals.
- `corpus validate` treats an empty or blank target value as a key the target lacks, as push does, instead of reporting every source placeholder missing (462 of the 595 findings on a Crowdin-exported catalogue were that).

### Added

- Rich-text tags in the ICU subset (§5): `<link>terms</link>` and `<icon/>`, as next-intl, FormatJS and Lingui write them. They parse as nodes, nest, may hold placeholders and sit in a branch; a translation must keep every tag and may add none (`missing-tag`, `unexpected-tag`); the editor shows a tag as what it wraps in a marked span and a chip inserts its pair; previews show what a tag wraps; the string response carries `tags`. On Homarr, eight strings carry tags that nothing checked before. Still `corpus/1`.
- `corpus init` takes the languages from the files that fill the messages path's `{lang}` when `--languages` is omitted, the source first, and warns about a code the runtime has no locale data for (a translation tool's pseudo-locale, such as Crowdin's `cr`, passes the tag's grammar and is not a language).
- `corpus --version` (`-v`, `version`) prints the CLI's version. The READMEs say a release-age policy in the package manager refuses a fresh release for its window.
- Queue items carry the string's source and the row's current text (§10), so a queue read is enough to translate a batch and the agent drafts queue reads back as a review list; `list_queue` and `corpus agent queue` carry them as they are. Additive; still `corpus/1`.
- The string response carries `slots` (§10): every value the source takes, placeholders then counts, with the description and role the repository declares for the slot and the first example's value per language, so an agent reads what the editor's chips show on hover instead of guessing a value's shape from its name. Additive; still `corpus/1`.

## [0.14.0] - 2026-09-20

Plural, and the open tickets.

### Added

- ICU **plural** in the subset (§5): `{n, plural, one {…} other {…}}` with CLDR categories, `=N` exact branches and `#` for the count, single-level like select. A count must survive a translation, as `{n}` or as a plural on `n`; a translation may pluralise any value the source has; a plural's categories are checked against the target language's, by the runtime's CLDR data, on save, on a token draft and in `corpus validate`. Previews resolve a plural by the example's count (§7). The string response carries `plurals`; still `corpus/1`. The §13 decision is taken: a real project's count strings needed it.

### Changed

- Tooling: eslint 10, `@eslint/js` 10, TypeScript 6.0 and vitest 5 (#238). TypeScript 6 no longer includes every `@types` package by itself, so the base tsconfig names Node's and `@types/node` is a root devDependency; the CLI declares the esbuild its build imports. TypeScript 7 waits for typescript-eslint to accept it.
- Glossary terms in a script written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese, Tibetan) match as a run of characters (§5); a Latin term still matches as whole words.

### Fixed

- Pull into an empty target file: an id that crosses a string leaf two or more levels down (`a.b.c` where `a.b` is text) is written as a flat key at the root, as the in-place splice already wrote it, instead of inside the nested node where it read back as `a.a.b.c`.

## [0.13.0] - 2026-09-20

What the 0.12.0 check found.

### Added

- An `exec` exporter's output may carry `translations`, per target language the text the repository already holds for its strings, and `corpus push` seeds them as it does a file's (§3, §8): only ids the snapshot has, never empty text, only declared target languages; the source language or an undeclared one is a build error.

### Changed

- `corpus init` adds `.corpus/` to `.gitignore`, creating the file when there is none, as the workbench does: a team on a shared instance writes the token by hand after `project create` and never starts the workbench.
- The published CLI README names the `--stdin` operations' arguments and says an `exec` import command receives only the selected rows and must merge them.

## [0.12.0] - 2026-09-20

What a clean install and the round trip found.

### Added

- `corpus push` carries the translations the repository already has (§8): every target language's file of every writable source with `{lang}` in its path travels as seeds, imported as translated where Corpus holds no edit for the row, and the push line says how many were seeded and how many Corpus kept as its own.

### Changed

- `corpus workbench` creates `.gitignore` with `.corpus/` when there is none, rather than printing a note, so a first start never leaves a token one `git add .` from a commit.
- A token route refuses a body field it does not take by name instead of dropping it; a `state` on a draft is told that the token cannot verify and a signed-in maintainer does, in the workbench. The contract's draft and proposal body schemas are strict; still `corpus/1`.
- The README and the spec say that an `exec` import command receives only the rows a pull selected and must merge them; the published CLI README carries the commands, the agent section and the CI section; the stdin operations' argument names are listed. Both READMEs now say which commands run the repository's `corpus.config.ts` (every one but `init`) and which run its `exec` commands (`push`, `build`, `pull`); 0.11.0's README understated the first set.

### Fixed

- A string from a source pull cannot write (a `.ts` catalogue) carries no `file`, so a proposal on it is refused up front rather than accepted and left pending; strings already on an instance take the change at their next push.

## [0.11.0] - 2026-09-19

What the third MCP run found.

### Added

- A glossary entry may list its `forms` (§5), the plurals and agreements the source may write; each is matched as the term is, and the entry shows once under its term. A name is a term like any other, so a suspect or a room is pinned the same way. The contract's entry shape gains `forms`; still `corpus/1`.
- Proposals on the agent path (§3, §10): `GET /api/proposals` lists the pending ones with their authors, the agent actor's own marked; `DELETE /api/proposals/<id>` withdraws one of the actor's own. `list_proposals` and `withdraw_proposal` tools (the latter by `proposal`, since on stdin `id` is the line's own), `proposals` and `withdraw` subcommands and stdin ops.

### Changed

- `corpus pull` says what applies a proposal it wrote: commit and push, and the next `corpus push` marks it applied. The MCP instructions and the README say the same.
- A tool or stdin argument given as a number is taken as its digits, so an id read from `list_proposals` goes straight back in.

## [0.10.0] - 2026-09-17

What the second MCP run found.

### Added

- `corpus agent --stdin` (§3): many operations through one process, one JSON object per line in (`op` is `queue`, `string`, `draft`, `propose`, `remove`, `add` or `status`) and one JSON line per operation out, in order, with the server's error and message on a refusal, `unreachable` when the server is down, and an echoed `id`; no start-up per call and no shell quoting around a translation.
- The string response and `get_string` carry the entities a string refers to, as the editor's cards show them: field, id, type and its label, name, attributes. The contract gains `entities`; still `corpus/1`.

### Changed

- The README leads with the agent surface and no longer carries a status paragraph.

### Fixed

- A pull or a proposal edits a messages file in place (§8): a changed value replaces its token, a removed key goes with its comma and the object it empties, an added key lands in its object's own style, inline or expanded, with the file's line ending; every other byte stays. A catalogue that keeps small objects on one line was rewritten whole before, so three proposals read as a hundred changed lines.
- The CLI exits only once its output has drained, so a long answer through a pipe keeps its tail, and a reader that closed early (`| head`) ends it quietly instead of with a stack trace.

## [0.9.0] - 2026-09-16

What the first MCP user found.

### Added

- **Siblings** (§9.3): the other strings of the same type under the same key prefix, the ten nearest in key order with the total, under the source on the string page and on the string response and `get_string` with every target language's text and state, so a set of quips or a run of steps is translated as one.
- **A voice note per string type** (§5): `typeNotes` in the config, one sentence per type on voice and register, pushed with the declarations and shown under the source and in `get_string`.
- **A glossary** (§5): `glossary: { path }` in the config names one JSON file per target language of `{ term, target, note? }` entries the repository owns; `corpus build` reads every target's file and a push replaces the project's copy whole. The string page and `get_string` show the entries whose term occurs in the source, matched on whole words case- and accent-insensitively. Not enforced.
- **`corpus agent`** (§3): the seven MCP tools as subcommands (`queue`, `string`, `draft`, `propose`, `add`, `status`), each printing the API's JSON, for an agent that has a shell and no MCP client.
- Queue items carry the string's `type`; `GET /api/queues` and `list_queue` narrow by type as well as language.
- `GET /api/status` and `corpus status` carry the project's writable sources, and say when the last push predates their declaration.
- The snapshot carries `typeNotes` and `glossary`, the string response carries `note`, `glossary` and `siblings`, and queue items carry `type`. All optional; the contract stays `corpus/1`.

### Changed

- A refusal says what to do next: `409 human-edited` names the agent's move, and `not-writable` / `unknown-source` end with the writable sources, "no writable source", or "last pushed before sources were declared; run corpus push with this CLI".
- The CLI always sends `sources`, empty included, so a project with nothing writable is told so rather than asked to push again.
- README: connect the MCP server before the session starts, match the instance's version, push once after upgrading, and how to drive the server as a subprocess.

## [0.8.0] - 2026-09-15

Agents draft; people verify.

### Added

- The project token reads and drafts (§10): `GET /api/queues`, `GET /api/strings/<key>`, `PUT /api/strings/<key>/translations/<lang>`, `POST /api/strings/<key>/proposals` and `POST /api/proposals`, under three rules. An agent never overwrites a person's current work: a draft lands on an untranslated row, a stale row or the agent's own earlier draft, and a row a person edited (or push seeded) answers `409 human-edited`. Every draft is attributed to the project's agent actor, `<slug> agent`, a user that never signs in, shown as such in the history, the chips and the settings list. Nothing but a signed-in maintainer verifies: the token has no verify route.
- A fourth queue, **agent drafts**, on the dashboard and the home card once the project has any: the translated rows the agent last edited, for a maintainer to walk and verify.
- `corpus mcp` starts a Model Context Protocol server on stdio from the repository, reading the config and the token like every other command, with seven tools that are one API call each: `list_queue`, `get_string`, `save_draft`, `propose_change`, `propose_removal`, `add_string` and `status`. Refusals come back as tool errors with the server's message. The README says how to connect Claude Code or any MCP client. Corpus runs no model; the model stays on the agent's side.
- The contract carries the agent surface's bodies and responses; still `corpus/1`.

### Changed

- A language bar at the top of the string page, inside the queue bar on a desktop, is the editor's switcher: one segment per language, the selected one solid, the source language first with its verified mark. The state chips are display only.
- The join form refuses any name ending in ` agent`, the name family reserved for agent actors.

## [0.7.0] - 2026-09-15

Corpus proposes source strings.

### Added

- Anyone on the instance may propose a change to a string's source text, its removal, or a new string into a catalogue chosen among the sources push declared (§9, §11). A proposal is pending until `corpus pull` writes it into the source file and the next `corpus push` sees the repository agreeing; a push that moved on, or archived the string, marks it superseded. One proposal per string or key; a newer one replaces the older, and every outcome reads in the string's history.
- `corpus pull` writes pending proposals into the source-language files through the adapters, format preserved, and removes a deleted key from the source's target files too; `--check` counts them; `corpus status` shows the pending count. A pull with no pending proposals never writes a source file.
- The snapshot carries each entry's `file` and the writable `sources`; the pull payload carries `sourceChanges`. All optional; the contract stays `corpus/1`.
- Strings from `exec` sources, or from `.ts`/`.js` catalogues pull cannot write, refuse proposals with a reason.

## [0.6.0] - 2026-09-07

The editor speaks the target language.

### Added

- Examples may carry `valuesByLanguage`, slot values resolved per target language by the client's exporter; the contract stays `corpus/1`. The editor previews a draft with the selected language's values when the example has them, and says which language the preview is in; a placeholder chip's hover shows the slot's description and, when the example has a value for the language, what it resolves to.
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

[Unreleased]: https://github.com/miguelaguiar01/corpus/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.16.0
[0.15.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.15.0
[0.14.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.14.0
[0.13.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.13.0
[0.12.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.12.0
[0.11.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.11.0
[0.10.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.10.0
[0.9.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.9.0
[0.8.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.8.0
[0.7.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.7.0
[0.6.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.6.0
[0.5.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.5.0
[0.4.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.1
[0.4.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.4.0
[0.3.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.1
[0.3.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.3.0
[0.2.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.2.0
[0.1.1]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.1
[0.1.0]: https://github.com/miguelaguiar01/corpus/releases/tag/v0.1.0
