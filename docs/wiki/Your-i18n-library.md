A source declares the library its catalogue was written for:

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json", library: "i18next" }
```

One value decides how placeholders are spelled, how plurals are written, and what is escaped. `icu` is the default and what an absent field means.

`corpus init` looks at your source file and writes the library it finds, saying so as it does: `i18next` when more values use `{{name}}` than use a single-brace `{name}` or a printf verb, and none holds an ICU plural or select, `vue` when they use a top-level pipe or a `{'…'}` literal and neither of those, `chrome` when every value is a Chrome i18n entry with a `message`. It writes nothing for a plain ICU catalogue, since that is the default.

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

A placeholder may carry a format, `{count, number}`, `{d, date, short}`, `{t, time}`, with the style after a second comma: a translation keeps the name and the type and may change the style, the chip inserts the source's form, and a preview formats the example's value for the language when it can. Rich text is tags: `<link>terms</link>`, `<icon/>`, and HTML with attributes as Gitea writes it, `<a href="%s" target="_blank">docs</a>`: the attribute text is part of the tag, kept as written and never parsed, so a translation carries the tag whole and the chip inserts it whole; `<br>`, `<hr>`, `<wbr>` and `<img …>` need no closing tag. Corpus checks that a translation keeps every placeholder, every branch its language needs, and every tag. That last rule is for tags a component renders, where a tag the code does not know is an error. Where the application reads the string as HTML instead (`dangerouslySetInnerHTML`, Android's `fromHtml`, an email template), a translator may rightly write `<i>` or `<br/>` the source does not have; declare the type `richText: { ui: "html" }` and tags are no longer compared, while placeholders and plurals still are and an unclosed tag is still refused. See [Types read as HTML](Metadata-types-entities-and-the-glossary#types-read-as-html). Prose that spells a tag it does not mean, Jellyfin's `https://example.com/<baseurl>`, is refused as an unclosed tag, with the same advice from `corpus push` and from the server. ICU's own apostrophe quoting (`'<baseurl>'`) is not read here; what works is `&lt;baseurl&gt;` where the application renders HTML, or wording the text so the brackets are not there.

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

**Keys are often the English sentence**, spaces, punctuation and all. That works: a string id is any text without control characters. When the English file holds `""` as the value, as i18next-parser writes it and the app falls back to the key, Corpus reads the key as the text: the string page shows the sentence, the placeholders in it are checked, and `push` says how many strings took the key. A proposal on such a string is refused with the reason, "the text of `<key>` is its key: change it in the code that calls t(), and the catalogue follows", on the string page, the API and the MCP tools alike; `get_string` carries `keyIsText` so an agent knows before it tries.

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

## printf: Go, C, and Android's resources

<!-- from: examples/printf.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en-US",
  languages: ["en-US", "de-DE", "pt-BR"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "options/locale/locale_{lang}.json",
      library: "printf",
    },
  ],
});
```

Gitea's catalogue, and any Go, C or Android app, writes its placeholders as printf verbs: `Pushed %d commits to %s`, Go's `%[2]s` and C's `%2$s` for an explicit position, `%-8.2f` with flags, width and precision, `%%` for a percent. Under `library: "printf"` each verb is a placeholder named by its position, the chip inserts it as the source writes it, and a translation must keep the same positions. Braces, angle brackets and `#` are text here: there are no ICU arguments and no tags, so HTML in a Go string is prose.

Two things to know. **A moved verb needs its index.** Unindexed verbs are read in order, so a translation that writes `%d commits de %s` for `%s pushed %d commits` prints the name where the count goes; Corpus says so (`%d at position 1 is %s in the source; a verb that moved needs its index, %[n]d`), and `%[2]d commits de %[1]s` is right. **A `%` in prose is text.** `50% off` opens no verb, since the space flag is not read, and `100%%` is a percent on both sides; a percent-encoded URL is another matter, `%20b` reads as a verb here as it does in Go, so write `%%20` as Go's own strings do. The hint's index form follows the source: `%n$` when the source writes one, as C, Java and Android do, and Go's `%[n]` otherwise. **A dropped verb is named once.** A translation of `%s pushed %d commits to %s` that leaves out the count reads, verb by verb, as a changed second and a missing third; Corpus says `missing %d`, which is what happened.

**C's length modifiers and iOS's `%@`.** `%ld`, `%lu`, `%zu`, `%lld` and `%hhd` are one verb each, modifier and letter together, so `%lu` where the source has `%ld` is a changed verb and the chip inserts `%ld` whole; `%@`, the object verb of an iOS `.strings` file through an exec source, is checked like any other. A letter right after Go's `%t` or `%q` reads as a modifier and a verb (`%td`), so keep the space Go's own strings keep. Two things stay as they are: Java's `%,d` grouping flag is not read, so that verb is text, and Go's `%[2]*d`, a width taken from an argument, reads as one verb at position 2.

`init` names the library when most placeholder-bearing strings carry verbs.

## Chrome i18n: browser extensions

<!-- from: examples/chrome.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-extension",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt_BR"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "src/_locales/{lang}/messages.json",
      library: "chrome",
    },
  ],
});
```

Every browser extension keeps `_locales/{lang}/messages.json`, one object per key:

```json
{
  "copied": {
    "message": "Copied $CURRENT$ of $TOTAL$",
    "description": "Shown after a copy.",
    "placeholders": {
      "current": { "content": "$1", "example": "3" },
      "total": { "content": "$2" }
    }
  }
}
```

Under `library: "chrome"` the `messages` adapter reads each entry as Chrome does: `message` is the text, `description` the string's note, and a placeholder's `example` its example value, which the chip's tooltip and the preview show. `$CURRENT$` is a placeholder, named without regard to case as Chrome matches it, so `$current$` in a translation is the same one; `$$` is a dollar, and braces, angle brackets and `%` are text. A translation must keep every placeholder the source has, and the chip inserts it as the source writes it.

A pull writes a translation into its entry's `message` and leaves the rest of the entry, and a byte-order mark, where they were; a key new to a language copies the source's `description` and `placeholders` beside it. `init` names the library when every value in the source file is such an object; without the library, the same file reads as nested keys (`copied.message`), since a catalogue of `{ title, message }` objects has that shape too. An extension split over several apps, as Bitwarden's is, is one `{ns}` pattern per layout: `apps/{ns}/src/_locales/{lang}/messages.json`.

## Android string resources

<!-- from: examples/android.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-BR", "sr-Latn"],
  sources: [{ adapter: "android", type: "ui", path: "app/src/main/res" }],
});
```

An `android` source names the `res` directory. `values/strings.xml` is the source, and each language in the config has its `values-<qualifier>` directory by Android's own rule: `de` is `values-de`, `pt-BR` is `values-pt-rBR`, `sr-Latn` is `values-b+sr+Latn`, and the legacy `in` and `iw` are `values-in` and `values-iw`. So write the config's languages the way the directories name them; a repository that spells one with `b+` where `-r` would do (`values-b+pt+BR`) needs `pt-BR` moved to `values-pt-rBR` first.

A `<string>` is a string, and a `<plurals>` is one string whose text is an ICU plural on `quantity`, one branch per `<item>`: the translator sees and writes `{quantity, plural, one {%d episode} other {%d episodes}}`, and a draft with a `many` branch comes back as a `<plurals>` with a `many` item. Strings marked `translatable="false"`, `product` variants other than the default, and values that are an `@string/` reference are left out and left as they are; `<string-array>` is not read. The text is what the app shows: `\'`, `\"`, `\n`, entities, CDATA and the double quotes that keep spaces are undone for the editor and written back escaped, while markup inside a string, `<b>` or `<xliff:g id="name">`, stays as written. A pull edits only the elements and plural items whose text changed and appends new ones before `</resources>`, so an unchanged file stays byte for byte, comments included.

The library is `android`: printf verbs as under `printf` (the index form is `%n$s`), and tags as under ICU, so a translation's `<i>` the source lacks is named. A string the app shows through `Html.fromHtml` may take the translator's own tags; declare its type `richText: { ui: "html" }` ([Types read as HTML](Metadata-types-entities-and-the-glossary#types-read-as-html)).

## gettext and iOS

No adapter reads `.po` or `.strings`. An `exec` source can, by converting in both directions; see [Sources and adapters](Sources-and-adapters). A converter that leaves the verbs as they are can declare `library: "printf"` on the exec source's strings, so the verbs are checked.

## When the library is wrong

Getting it wrong is usually loud, but not always, and the quiet directions are the ones to know before you choose.

**The loud ones.** An i18next catalogue read as `icu` or as `vue` refuses every string that interpolates, since `{{name}}` is not a valid placeholder in either; an ICU catalogue read as `vue` refuses every string with an argument in it. When five refusals have one cause, the wrong library whichever advice each drew, or a whole file is refused, the build stops with nothing pushed, and the message names the field to set:

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
