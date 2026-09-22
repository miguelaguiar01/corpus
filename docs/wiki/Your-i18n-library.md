A source declares the library its catalogue was written for:

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json", library: "i18next" }
```

One value decides how placeholders are spelled, how plurals are written, and what is escaped. `icu` is the default and what an absent field means.

`corpus init` looks at your source file and writes `library: "i18next"` when the values use `{{name}}` and no ICU argument, saying so as it does. It writes nothing for a plain ICU catalogue, since that is the default.

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

Rich text is tags: `<link>terms</link>`, `<icon/>`. Corpus checks that a translation keeps every placeholder, every branch its language needs, and every tag.

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

Not yet. vue-i18n writes plurals as one string with pipes (`one | other`) and escapes literals as `{'@'}`, and Corpus reads neither today: the pipes are literal text to it, so a translation that drops a form is not a finding, and a string with `{'@'}` is refused. The work is tracked in [#495](https://github.com/miguelaguiar01/corpus/issues/495) and [#496](https://github.com/miguelaguiar01/corpus/issues/496).

A vue-i18n catalogue whose strings use `{name}` interpolation and no pipes works today as `icu`, which covers most of a typical catalogue: of Vikunja's 1,456 strings, 22 use pipes.

## gettext, Android, iOS

No adapter reads `.po`, `strings.xml` or `.strings`. An `exec` source can, by converting in both directions; see [Sources and adapters](Sources-and-adapters).

## When the library is wrong

A catalogue read under the wrong library fails loudly rather than quietly. An i18next catalogue read as ICU refuses every string that interpolates, since `{{name}}` is not a valid ICU placeholder, and the message names the field to set:

<!-- from: recorded/wrong-library.out -->
```text
corpus: src/i18n/en.json [greeting]: invalid ICU: invalid placeholder name "{ name"; {{ }} is i18next's interpolation: declare library: "i18next" on the source
built acme-app: 0 string(s) (none), 0 entity(ies) (none)
corpus: 1 string(s) refused and left out of the snapshot
```
