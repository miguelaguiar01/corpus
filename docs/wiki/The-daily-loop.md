Four commands carry the work between the repository and the instance. This page says what each changes, who runs it, and when.

## push, after the source text changes

`corpus push` sends the source strings and the translations the repository holds. The server applies it in one transaction as a diff by string id:

| What changed in the repository | What Corpus does |
|---|---|
| a new id | adds it; the source language counts as translated, every target as untranslated |
| a string's text is the same | refreshes its metadata and examples; no state moves |
| a string's text changed | updates it, marks every existing translation **stale**, keeps the old text |
| an id is gone | **archives** it: out of queues and progress, history kept, back if the id returns |

Stale is the point of that table. A translation of a sentence that has since changed is not wrong, but it is not right either, and Corpus keeps it visible rather than silently correct.

Push is safe to run as often as you like. One that changes nothing moves no state and rewrites no translation; it still records that it happened, so `corpus status` shows when the instance last heard from the repository.

Run it when source text changes: by hand after editing a catalogue, or from CI on merge to your default branch.

## Translating, on the instance

A translator opens a queue and works. Saving a row makes it **translated**. A maintainer verifying it makes it **verified**. Nothing a translator does touches your repository.

Under the source, anyone can propose a change to the source text or its removal. The proposal waits; it changes nothing on its own.

## pull, to bring translations back

```sh
corpus pull                          # verified only
corpus pull --min-state translated   # translated and verified
corpus pull --lang de                # one language, other files untouched
```

`pull` writes through the same adapters that read your files, so formatting and key order survive. It prints only the files it changed, and it writes pending proposals into your source files at the same time.

Review the diff and merge it. That is what makes the repository the truth: a translation is in your product when it is in your repository, not when someone pressed save.

## The confirmation

The push after a merged proposal sees the repository agreeing and marks the proposal applied. If the text arrived different from what was proposed, it is marked superseded instead. Neither changes a translation.

## check and validate, in the meantime

`corpus check` reads your components and reports user-facing text that is not in a catalogue. It reads `.jsx` and `.tsx`, and says how many files it read, so a clean bill over code it cannot parse is not possible.

`corpus validate` reads your target files and reports translations that no longer fit their source: a dropped placeholder, a malformed plural, a key the source no longer has. It needs no server and no token, so it belongs in the same CI job as your unit tests.

Both are described in [Corpus in CI](Corpus-in-CI).

## A week of it

1. A developer adds three strings to `en.json` and merges. CI pushes; the three appear as untranslated in every language.
2. A developer rewords one existing string. Its translations go stale, and translators see them in the stale queue with the old text still there.
3. A translator works the untranslated queue on a phone; a maintainer verifies.
4. CI runs `corpus pull --check` on every pull request and fails when the repository is behind, so someone runs `corpus pull` and merges the translations.
5. A translator proposes better English for a confusing string. It arrives in the next `corpus pull` as a diff in `en.json`, is reviewed like any change, and the next push marks it applied.
