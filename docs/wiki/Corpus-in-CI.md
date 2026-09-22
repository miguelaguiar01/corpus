Four commands belong in CI, and they divide cleanly: two read only the repository, two talk to the instance.

| Command | Needs the instance | Runs on | Fails when |
|---|---|---|---|
| `corpus check` | no | every pull request | a component says something to a person without going through a catalogue |
| `corpus validate` | no | every pull request | a translation in the repository is broken |
| `corpus pull --check` | yes, read only | every pull request from the repository | the repository is behind what is verified, or a proposal is waiting |
| `corpus push` | yes, writes | the default branch, after merge | a string will not parse, the token is refused, the instance rejects the push, or it cannot be reached |

## The offline pair

Neither needs a token, a network or an instance, so they run on a fork's pull request like any other check, and they are fast enough that nobody notices them: on this repository `check` reads 80 files in 0.7 s and `validate` finishes in 0.5 s. On Outline, 1,920 keys across 28 languages, `validate` takes 2.5 s.

`corpus check` reads the components your config's `check.include` names and reports text a person would read that did not come from a catalogue. It prints one line per literal and exits 1:

<!-- from: recorded/check.out -->
```text
src/components/Toolbar.tsx:2: Save the document
src/components/Toolbar.tsx:2: Save
corpus: 2 user-facing literal(s) outside declared sources
```

Both the button's text and its `title` count: an attribute a screen reader speaks is text a person reads. What it does not count is anything `check.allow` matches, which is where product names, units and codes go.

`corpus validate` parses every translation in the repository against its source and reports what would break at runtime (a plural missing a category its language uses is listed apart as incomplete and does not fail the run, since ICU falls back to `other`) — a lost placeholder, a plural category the language does not have, a tag the source does not open:

<!-- from: recorded/validate.out -->
```text
src/i18n/pt-PT.json:editor.unsaved: missing {count}
corpus: 1 invalid translation(s)
```

This catches what a translator's editor already refuses, because translations arrive by other routes too: a merge, a hand edit, a file someone brought from an older tool. Outline's catalogues, which have never been through Corpus, have 32 invalid translations and 22 orphan keys in them today.

## The two that need the instance

`corpus pull --check` performs a pull and writes nothing, exiting 1 when a pull would have changed a file ([§8](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#8-sync-semantics)). That is the gate that keeps the repository honest: a translation was verified, nobody ran `corpus pull`, and the branch is behind. A pending proposal counts as a change, so the same gate goes red until someone pulls the proposed English in and reviews it.

It needs `CORPUS_TOKEN`, so it cannot run on a fork's pull request, where secrets are not available. Skip it there rather than letting it fail.

`corpus push` belongs on the default branch and nowhere else. The instance's catalogue should follow what is merged, not what someone is proposing in a branch, or translators start working on text that never lands.

## A workflow

<!-- from: examples/ci.yml -->
```yaml
name: i18n

on:
  pull_request:
  push:
    branches: [main]

jobs:
  offline:
    # Needs no instance and no token, so it runs on a fork's pull
    # request like any other check.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: No user-facing text outside the catalogues
        run: npx corpus check
      - name: Every translation in the repository is valid
        run: npx corpus validate

  behind:
    # Reads the instance, writes nothing. A fork's pull request has no
    # secret, so this is skipped there rather than failing.
    if: github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: The repository carries what is verified
        run: npx corpus pull --check
        env:
          CORPUS_TOKEN: ${{ secrets.CORPUS_TOKEN }}

  push:
    # Only from the default branch: the instance's catalogue follows
    # what is merged, not what is proposed.
    if: github.event_name == 'push'
    needs: [offline, behind]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: The instance learns what merged
        run: npx corpus push
        env:
          CORPUS_TOKEN: ${{ secrets.CORPUS_TOKEN }}
```

## A gate of your own

`corpus status --json` is the dashboard's numbers as one object. `progress.perLanguage` is language to counts; `progress.perType` is type to language to the same counts, one level deeper. The counts are `untranslated`, `translated`, `verified`, `stale` and `total`. Beside `progress` are `pendingProposals`, `lastPushAt`, the string count and the server's version. Anything you can express about those is a gate:

```sh
npx corpus status --json | jq -e '.progress.perLanguage["pt-PT"].untranslated == 0'
npx corpus status --json | jq -e '.progress.perType.email["pt-PT"] | .total > 0 and .verified == .total'
```

The first blocks a release until Portuguese is complete; the second until every email string is verified in Portuguese, which is the shape `perType` has: type, then language, then the counts. The second asks for `total > 0` first on purpose: without it, a type that no longer exists compares `null` with `null` and the gate passes on a catalogue that lost the strings it was guarding. It is a policy, not a rule Corpus holds: decide it per project, and expect to relax it for a language you have just added.

## A throwaway instance for a test job

A job that needs a real instance can start one: `corpus workbench` in the checkout creates the project and writes the token itself, so the whole round trip runs with nothing provisioned in advance. This repository's own CI does exactly that in `bin/install-smoke`. `bin/dogfood` takes the other route for the same reason: it boots the production image and provisions it explicitly with `CORPUS_INVITE_SECRET=… corpus project create`, taking the token from the last line.

A tag such as `@v7` is the readable form. This repository pins every action to a commit SHA with the version in a comment, because a tag can be moved to point at other code; `bin/gate`'s own workflow shows the shape. Either is fine, and the stricter one costs you a Dependabot pull request each time an action releases.

The `needs: [offline, behind]` on the push job holds because `behind` runs on a push event: an `if:` that skipped it would make `push` skip too, since a skipped dependency is not a satisfied one. If you narrow that condition later, narrow this one with it.

## The token

`CORPUS_TOKEN` is the project token, the same one `.corpus/token` holds locally. It is read before that file, which is the whole of the CI story: put it in the repository's secrets and nothing else changes.

It is per project, not per person. It cannot verify anything and it cannot sign in ([§10](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#10-users-and-access)). A leaked one reads your catalogue, writes drafts into it, proposes and withdraws proposals, and pushes — which archives strings the push no longer carries. Rotate it: `npx corpus project rotate-token` replaces it, authenticating with the current one, and a maintainer can rotate it from the project's settings page.

## Adding it to a repository that already has CI

Add the offline pair first and let it go red. `corpus check` on a codebase that has never had it usually finds real text, and some of it is not worth translating; that is what `check.allow` and `check.ignore` are for, and the first pass is a pull request of its own. `corpus validate` on old catalogues finds broken translations nobody knew about.

Only once those are green is `pull --check` worth adding, because until the repository agrees with the instance it fails for a reason nobody can act on.

## What none of this catches

A string that is in the catalogue, translated, verified, and wrong. Corpus checks structure, not meaning ([§5](https://github.com/miguelaguiar01/corpus/blob/main/docs/corpus-design.md#5-strings-and-metadata-primitives)): that the placeholders survive, that the plural has the categories the language needs, that the tags balance. Whether the Portuguese is good Portuguese is what a verifying maintainer is for.
