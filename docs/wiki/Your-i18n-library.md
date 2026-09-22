A source declares the library its catalogue was written for:

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json", library: "i18next" }
```

One value decides how placeholders are spelled, how plurals are written, and what is escaped. `icu` is the default and what an absent field means.

`corpus init` looks at your source file and writes the library it finds, saying so as it does: `i18next` when the values use `{{name}}` and no ICU argument, `vue` when they use a top-level pipe or a `{'…'}` literal and neither of those. It writes nothing for a plain ICU catalogue, since that is the default.

(`syntax` is the old name for this field. A config that still uses it works, and `build`, `push` and `validate` each say once that the field has been renamed. It goes at 1.0.)

## next-intl, FormatJS, Lingui, and anything ICU

<!-- from: examples/next-intl.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [{ adapter: "messages", type: "ui", path: "messages/{lang}.json" }],
  check: { include: ["app", "components"] },
});
```

These write plain ICU MessageFormat, which is `library: "icu"`, which is the default. Placeholders are `{name}`. Plurals and selects are arguments:

```
{count, plural, one {# document} other {# documents}}
{gender, select, female {her file} male {his file} other {their file}}
```

Rich text is tags: `<link>terms</link>`, `<icon/>`. Corpus checks that a translation keeps every placeholder, every branch its language needs, and every tag. Prose that spells a tag it does not mean, Jellyfin's `https://example.com/<baseurl>`, is refused as an unclosed tag, with the same advice from `corpus push` and from the server. ICU's own apostrophe quoting (`'<baseurl>'`) is not read here; what works is `&lt;baseurl&gt;` where the application renders HTML, or wording the text so the brackets are not there.

## i18next and react-i18next

<!-- from: examples/i18next.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en_US",
  languages: ["en_US", "de_DE", "pt_BR"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "public/locales/{lang}/translation.json",
      library: "i18next",
    },
  ],
  check: { include: ["app", "components"] },
});
```

Three things differ from ICU, and Corpus handles all three:

**Interpolation is `{{name}}`**, with or without spaces, and a format after a comma is ignored. A single brace is text. The unescaped form `{{- name}}` is its own placeholder, kept apart from `{{name}}`, because i18next inserts one raw and escapes the other, and a translation that swaps them changes what the user sees.

**Plurals are separate keys**, not arguments: `item` beside `item_other`, or `_one`, `_few` and the rest. Corpus treats a key and its suffixed forms as siblings, so they appear together on the string page and in what an agent reads, rather than as unrelated rows.

**Keys are often the English sentence**, spaces, punctuation and all. That works: a string id is any text without control characters.

`<Trans>` is a catalogue call, so `corpus check` does not report the text inside it.

## vue-i18n

<!-- from: examples/vue.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "ru"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/i18n/lang/{lang}.json",
      library: "vue",
    },
  ],
  check: { include: ["src"], ignore: ["**/*.story.vue"] },
});
```

`{name}` is a placeholder, single-braced.

**Plurals are positions, not names.** vue-i18n separates the forms of a string with a top-level `|` and picks one by the count passed at render time:

```json
{ "comments": "{count} comment | {count} comments" }
```

There is no argument in the string, so nothing names what is counted.

**Corpus does not check how many forms a translation has**, and the reason is worth knowing. vue-i18n picks a form by how many there are, through whatever `pluralizationRules` the application registered. Its default rule reaches no index above the third; a project can register one that expects an exact count, as Vikunja does for Russian, where three forms are right and the four CLDR gives Russian are wrong. A rule Corpus imposed would refuse text that the project renders correctly, so it imposes none.

What it does check is that every placeholder survives into every form, and it refuses an empty form — `a | | b` — which vue-i18n's own compiler refuses too. Corpus counts a form of nothing but whitespace as empty; the compiler trims only spaces and newlines, so a form holding a lone tab passes there and not here.

**`{'…'}` is a literal.** It is how a catalogue writes an `@`, a `|` or a brace that vue-i18n would otherwise read as syntax — `"e.g. frederic{'@'}vikunja.io"` — and a pipe inside one is text rather than a separator, so `"Pipe ({'|'})"` is one form and not two. Written without the escape, `"Pipe (|)"` is refused rather than split in silence: a form with no word, number, symbol or brace in it — here `)` — is punctuation the pipe cut, and the message says to write `{'|'}`. vue-i18n itself would render `Pipe (`.

Not yet read: `@:linked.keys`. A catalogue that uses them parses, and the link is text.

## What a stray pipe costs

A vue-i18n catalogue read as ICU loses every string with a `{'…'}` in it, because ICU reads `{'@'}` as a placeholder named `'@'` and refuses the string. On Vikunja that was one key across 31 of its 38 language files. Read as `vue`, the same catalogue builds whole.

## gettext, Android, iOS

No adapter reads `.po`, `strings.xml` or `.strings`. An `exec` source can, by converting in both directions; see [Sources and adapters](Sources-and-adapters).

## When the library is wrong

Getting it wrong is usually loud, but not always, and the quiet directions are the ones to know before you choose.

**The loud ones.** An i18next catalogue read as `icu` or as `vue` refuses every string that interpolates, since `{{name}}` is not a valid placeholder in either; an ICU catalogue read as `vue` refuses every string with an argument in it. When five refusals carry advice, whichever advice each drew, or a whole file is refused, the build stops with nothing pushed, and the message names the field to set:

<!-- from: recorded/wrong-library.out -->
```text
corpus: snapshot build failed:
  src/i18n/en.json [greeting]: invalid ICU: invalid placeholder name "{ name"; {{ }} is i18next's interpolation: declare library: "i18next" on the source
  src/i18n/en.json: every string in the file was refused (1)
  nothing was pushed: pushing the rest would archive every refused string
```

**The quiet ones.** Read as `i18next`, a single brace is text: a vue-i18n catalogue refuses nothing and says nothing, its `{name}` placeholders simply ceasing to be placeholders, and so does most of an ICU one, where a plural or a select is read as text like anything else. What i18next does refuse is a `{{`, which an ICU string acquires when a branch opens with a placeholder — `other {{name} updated the file}` — so those strings are dropped while every other string pushes — unless there are five of them, when the advice they share stops the build as above. The damage being partial is what makes it easy to miss, which is why that refusal carries `declare library: "icu"`. This repository's own catalogue has a plural, no `{{` anywhere, and builds all 224 strings silently under the wrong library.

Read as `icu`, a vue-i18n catalogue refuses only its `{'…'}` literals and any bare `}`; its pipe plurals become one string each, quietly.

In both the catalogue still pushes, and the only check left is a translator noticing. That is the argument for setting `library` deliberately rather than discovering it from a failure.
