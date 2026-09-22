One paragraph each, in the order the words tend to come up.

**String.** One piece of text the application shows a person, with an id that is stable across languages. The id is the key in your catalogue; the text is what the source language says. Everything else in Corpus hangs off a string.

**Source language.** The language your repository is written in, declared once in the config. It is the text translators translate from, and it is changed by proposing rather than by translating. A pull never writes a translation into its file, but it does write proposals there, which is how a proposed wording reaches the repository.

**Type.** A label on a string saying what kind of text it is: `ui`, `email`, `tour-step`. A type groups strings, carries a note on how they should read, and decides what metadata a string of that kind may have. Every catalogue and table source names one.

**Source.** An entry in the config saying where text lives and how to read it: a catalogue per language, a table of records, or a command that prints them. A project usually has more than one.

**Adapter.** How a source is read: `messages` for key-value catalogues, `table` for records, `exec` for a command. Whether `corpus pull` can write translations back depends on the adapter and on the path: a catalogue or table takes them back when its path has `{lang}` and ends in `.json`, and an `exec` source when it declares an `importCommand`.

**Snapshot.** What `corpus build` produces and `corpus push` sends: every string, every declaration and every translation the repository already has, as one document in the `corpus/1` contract ([§4](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#4-the-snapshot-contract-corpus1)). It is a description of the repository at one moment, not a diff.

**Seed.** A translation the repository already had, carried up by a push so it does not show as untranslated. A seed whose text is identical to the source stays untranslated, because a catalogue that repeats the English is a catalogue nobody has translated yet.

**State.** Per string and language: `untranslated`, then `translated` when somebody saves one, then `verified` when a maintainer signs it off ([§11](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#11-state-machine-and-history)). The source language uses the same row, starting at translated, where verifying means proofread.

**Stale.** A flag on top of a state, set by a push when the source text changed after the translation was saved, cleared by the next save or verify. The old translation is kept: stale means check this, not retype this.

**Verified.** The state a maintainer puts a translation in, and the one `corpus pull` writes back to the repository by default. Nothing an agent does reaches verified.

**Queue.** A list telling a translator what to work on next: untranslated, stale, unverified source, agent drafts. Narrowed by language and by type.

**Proposal.** A change to the repository, proposed from inside Corpus: new source text for a string, a string's removal, or a string that should exist. It is pending until `corpus pull` writes it into a file, somebody reviews the diff and merges it, and the next push sees the repository agreeing and marks it applied. Corpus proposes; the repository decides.

**Round trip.** Push, then pull, and the repository is byte-for-byte what it was. That is the property that makes Corpus safe to put on an existing codebase, and it is a test in this repository's gate rather than a promise.

**Metadata.** Fields a string carries beside its text, declared per type, shown to whoever translates it. A `table` source's other columns are the usual source.

**Entity.** A thing the strings talk about — a character, a place, a product — with an id, a name and attributes, so it is called the same thing in every string that mentions it.

**Glossary.** Per target language, the terms that must be rendered the same way everywhere, from a file the repository owns. Matched in the source text and shown while translating.

**Agent actor.** The user a project's token writes as, one per project, named `<slug> agent`. It drafts, it is attributed in the history, and it never signs in and never verifies.

**Instance.** One running Corpus: the web app and its database, holding every project and every account. `corpus workbench` is one on your machine; the container image is one for a team.

**Project token.** The per-project bearer token the CLI authenticates with, from `CORPUS_TOKEN` or `.corpus/token`. It pushes, pulls, reads and drafts. It cannot verify and cannot sign in.

**Invite secret.** The one instance-wide secret that admits people. It also creates projects, which is what `corpus project create` uses; a signed-in person creates one from the interface without it.
