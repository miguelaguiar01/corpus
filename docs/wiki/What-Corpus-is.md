Corpus is a self-hosted workbench for the text your application shows people, and for its translations.

It assumes your repository already has message catalogues, and that they stay where they are. You declare where they live; Corpus reads them, gives translators a place to work, and writes translations back as files you review and merge like any other change.

## The split it enforces

**The repository owns the source text.** Nobody edits the English in a web page and hopes the repository catches up. If a source string should change, Corpus records a proposal; `corpus pull` writes it into the file it came from, you review the diff, and the next push confirms it.

**Corpus owns the translations and the workflow.** Which strings are untranslated, which went stale when their source changed, who verified what, which text an agent drafted. That state lives in Corpus, because a git diff is a poor place to keep it.

Two commands move between the two:

```
corpus push   repository → Corpus   source text, metadata, and the translations the repository already holds
corpus pull   Corpus → repository   translations that reached the state you asked for, plus pending proposals
```

Push then pull reproduces your files byte for byte. That is a test in the project's own gate, not a promise.

## Why you declare your catalogues

Corpus never scans your code for strings. You name your sources in `corpus.config.ts`, and it reads exactly those.

Extraction tools fail quietly: a key built at runtime, a string in a file the pattern missed, and nothing tells you. A declaration cannot fail quietly. What it costs is a config file, which is also what lets Corpus know a string's type, where to write a translation back, and which files a proposal may touch.

For the strings that should be in a catalogue and are not, `corpus check` reads your components and reports text that is still hard-coded.

## What it is not

It is not a translation marketplace: there is no vendor, no invoice, nobody to buy words from.

It does not translate for you. It gives an agent, machine or human, the same editor and the same rules, and marks machine drafts as such so a maintainer reviews them as their own pile.

It is not a CAT tool with translation memory, fuzzy matching and segmentation. It shows a translator the string, what it means, what it looks like rendered, and what its neighbours say.

It is not hosted. You run it: `corpus workbench` on a laptop, or the container image for a team.

## What you get out of it

A translator opens a queue on a phone and works through it without cloning anything.

A maintainer sees what is untranslated, what went stale, and what an agent drafted, per language.

Your build fails when a translation loses a placeholder, when a component gains a hard-coded string, or when the repository is behind what has been verified.

## Where to go next

[Install and first push](Install-and-first-push) puts it on a real repository in about ten minutes.
