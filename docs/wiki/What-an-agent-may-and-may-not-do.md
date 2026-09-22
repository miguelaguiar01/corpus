Three rules hold for everything written through a project token, whether it came from `corpus mcp` or `corpus agent`. They are not advice to an agent; they are enforced by the server, and the MCP handshake states them so a client needs no prompt from you.

## It never overwrites a person's work

A draft lands on a row that is untranslated, a row that went stale, or the agent's own earlier draft. A row a person edited refuses:

```text
human-edited: editor.save in pt-PT holds a person's work; propose a change if the source is the problem; otherwise leave the row to its author
```

Retrying will not help, and that is the point. The refusal names the two ways forward: if the English is the problem, propose a change to it; otherwise the row belongs to whoever wrote it.

The other six refusals are structural. `invalid-translation` says what broke — a lost placeholder, a plural category the language needs and the draft does not have. `empty-text` refuses a blank. `archived` refuses a string the repository no longer has. `source-row` refuses an edit to the source language, which comes from the repository and is changed by proposing, not by drafting. `not-found` is a key the project does not have, and `unknown-language` a language it does not declare, which between them are what a typo looks like.

## Every draft is attributed

A draft is written by the project's agent actor, which is one actor per project, named after it: `acme-app agent` in the recordings on these pages. The history shows it, the editor's chips show it, and the settings page lists it beside the people.

Agent drafts are their own queue on the dashboard, so a maintainer can review machine text as a pile rather than meeting it one string at a time mixed in with a colleague's. That is the whole design intent: drafting is cheap and reviewing is not, so the review is what gets the structure.

## Only a signed-in maintainer verifies

There is no tool for it and no endpoint the token can reach. An agent can move a row from untranslated to translated and no further; verified is a person's signature, and it is the state `corpus pull` writes back to the repository by default.

## Proposals, which are the other direction

A translation is the agent's to write. Source text is not: it belongs to the repository. When the English is the problem — ambiguous, untranslatable, wrong — the agent proposes a change instead of working around it.

A proposal is pending until someone runs `corpus pull`, which writes it into the source file, and the diff is reviewed and merged like any other change. The next `corpus push` sees the repository agreeing and marks it applied. Nothing is applied by proposing, and nothing is applied by Corpus: the repository stays the truth.

`propose_removal` and `add_string` are the same mechanism for a string that should go and a string that should exist. Both need a writable source — `.json`, in the sources the last push declared — which `status` lists as `writableSources`. A project pushed before sources were declared has none until its next push, and every proposal is refused with that reason until then.

An agent can withdraw its own proposals and nobody else's.

## What Corpus does not do

It runs no model. Corpus holds strings, states, history and rules; the drafting happens on the agent's side, with whatever model that agent has, and arrives through the same API a person's editor uses. Nothing here sends your strings to a model provider unless the agent you connected does.
