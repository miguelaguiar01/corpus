A source declares the library its catalogue was written for:

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json", library: "i18next" }
```

One value decides how placeholders are spelled, how plurals are written, and what is escaped. `icu` is the default and what an absent field means.

`corpus init` looks at your source file and writes the library it finds, saying so as it does: `i18next` when more values use `{{name}}` than use a single-brace `{name}` or a printf verb, and none holds an ICU plural or select, `vue` when they use a top-level pipe or a `{'…'}` literal and neither of those, `chrome` when every value is a Chrome i18n entry with a `message`, `counterpart` when `%(name)s` placeholders outnumber every other shape, `easy_localization` when a string holds `{}` or an `@:key` link, `rails` when `%{name}` placeholders outnumber every other shape. It writes nothing for a plain ICU catalogue, since that is the default.

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

One may sit in the other's branch, one level deep: `{gender, select, female {{count, plural, one {her # file} other {her # files}}} other {…}}`. `#` is the count of the plural it is in; inside a select within a plural write `{count}`, since FormatJS prints a `#` there as it stands. A translation nests as its source does; a plural in a plural, a select in a select, or a third level is refused.

A translation needs the branches its language uses; one it lacks is **incomplete**, listed apart by `corpus validate` and never the reason it fails, since the runtime falls back to `other`. A branch the language never selects, `one` in Japanese, is incomplete the same way: dead text, and the plural rules your runtime ships may be older or newer than Node's, as Discourse's Hebrew `many` is. A language whose only category is `other` may write the plural plainly: `{count}件の投稿` for `{count, plural, one {# post} other {# posts}}`, keeping every value the `other` branch uses.

A placeholder may carry a format, `{count, number}`, `{d, date, short}`, `{t, time}`, with the style after a second comma: a translation keeps the name and the type and may change the style, the chip inserts the source's form, and a preview formats the example's value for the language when it can. Rich text is tags: `<link>terms</link>`, `<icon/>`, and HTML with attributes as Gitea writes it, `<a href="%s" target="_blank">docs</a>`: the attribute text is part of the tag, kept as written and never parsed, so a translation carries the tag whole and the chip inserts it whole; Where the text is HTML (a type declared `richText: { ui: "html" }`, or Android's strings) and under i18next, whose `Trans` keeps them void, `<br>`, `<hr>`, `<wbr>` and `<img …>` need no closing tag and `<br></br>` counts as one; where a component renders each tag (next-intl, FormatJS), `<br></br>` is a pair like any other and a lone `<br>` is left open: write `<br/>`. Corpus checks that a translation keeps every placeholder, every branch its language needs, and every tag. That last rule is for tags a component renders, where a tag the code does not know is an error. Where the application reads the string as HTML instead (`dangerouslySetInnerHTML`, Android's `fromHtml`, an email template), a translator may rightly write `<i>` or `<br/>` the source does not have; declare the type `richText: { ui: "html" }` and tags are no longer compared, while placeholders and plurals still are and an unclosed tag is still refused. See [Types read as HTML](Metadata-types-entities-and-the-glossary#types-read-as-html). Prose that spells a tag it does not mean, Jellyfin's `https://example.com/<baseurl>`, is refused as an unclosed tag, with the same advice from `corpus push` and from the server. ICU's own apostrophe quoting (`'<baseurl>'`) is not read here; what works is `&lt;baseurl&gt;` where the application renders HTML, or wording the text so the brackets are not there.

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

Angle brackets are text: vue-i18n has no tag syntax (its component interpolation, `<i18n-t>`, fills `{name}` slots), so `Replace <access token> with your token` is prose and is left alone; `richText` has nothing to change for a vue source.

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

Two things to know. **A moved verb needs its index.** Unindexed verbs are read in order, so a translation that writes `%d commits de %s` for `%s pushed %d commits` prints the name where the count goes; Corpus says so (`%d at position 1 is %s in the source; a verb that moved needs its index, %n$d or %[n]d`), and in Go `%[2]d commits de %[1]s` is right. **A `%` in prose is text.** `50% off` opens no verb, since the space flag is not read, and `100%%` is a percent on both sides; a percent-encoded URL is another matter, `%20b` reads as a verb here as it does in Go, so write `%%20` as Go's own strings do. The hint's index form follows the source: `%n$` when the source writes one, as C, Java, JavaScript's sprintf and Android do, Go's `%[n]` when the source writes that, and both when it writes neither, since only your project's language decides which works. A verb of another type where the source has none of that type did not move: it reads `%d where the source has %lld`. **A dropped verb is named once.** A translation of `%s pushed %d commits to %s` that leaves out the count reads, verb by verb, as a changed second and a missing third; Corpus says `missing %d`, which is what happened.

**C's length modifiers and iOS's `%@`.** `%ld`, `%lu`, `%zu`, `%lld` and `%hhd` are one verb each, modifier and letter together, so `%lu` where the source has `%ld` is a changed verb and the chip inserts `%ld` whole; `%@`, the object verb of an iOS `.strings` file through an exec source, is checked like any other. A letter right after Go's `%t` or `%q` reads as a modifier and a verb (`%td`), so keep the space Go's own strings keep. Two things stay as they are: Java's `%,d` grouping flag is not read, so that verb is text, and Go's `%[2]*d`, a width taken from an argument, reads as one verb at position 2.

`init` names the library when most placeholder-bearing strings carry verbs.

## counterpart: Element and matrix-web-i18n

`library: "counterpart"` is the substitution Element Web's `_t()` uses. `%(name)s`, or `%(name)d`, is a placeholder named `name`, which a translation must keep; a tag is a substitution the code fills, `<b>…</b>` a pair and a bare `<pill>` with no close one on its own, and a translation keeps both; braces are text. Plurals are JSON objects, `{ "one": "%(count)s room", "other": "%(count)s rooms" }`, which read as one plural (see [Sources and adapters](Sources-and-adapters#messages)), so a Polish translation gains `few` and `many`.

```json
{ "invite": "Invite <pill> to %(roomName)s" }
```

`corpus init` writes it when `%(name)s` placeholders outnumber every other shape. Element's own substitution leaves a tag the code does not pass as text, `<empty string>`, which Corpus cannot know, so it asks a translation to keep such a tag as written too.

## easy_localization: Flutter

`library: "easy_localization"` is the Flutter package's syntax. `{}` is a positional placeholder, the first `{}` of a string the first argument, so a translation keeps their order, and `{name}` a named one; `@:key` links to another key's text, and `@.upper:key` (or `.lower`, `.capitalize`) links with a modifier. A translation keeps each placeholder and each link as written: a draft that drops `@:appName` is refused, and one that writes `@:appName-Konto`, which the package reads as a link to a key named `appName-Konto`, is told the link it lost and the one it made. Braces around anything else, `#` and angle brackets are text. Plurals are JSON objects, `{ "one": "{} file", "other": "{} files" }`, read as one plural whose `{}` is the count.

`corpus init` writes it when strings with `{}` or links outnumber those with single-brace or ICU arguments (vue-i18n writes `@:key` links too, so a link counts only where nothing else says vue), and a `{}` refused under another library says to declare it.

## Rails I18n and I18n.js

`library: "rails"` is Rails' interpolation, and I18n.js's `%{name}` form: the library of the [yaml](Sources-and-adapters#yaml) source, which reads Rails' YAML catalogues with no converter. `%{name}` is a placeholder a translation keeps as written, and the chip inserts it whole: `{application_name}` without the `%` is text to Rails and prints as it stands, so a translation that writes it is refused with `missing %{application_name}`. Rails' format style, `%<count>d` or `%<amount>.2f`, is a placeholder too; `%%` is a literal `%`; other braces, `#` and a lone `%` are text. Tags are read as under ICU, so a lone `<br>` is an unclosed tag unless the type is declared `richText: { ui: "html" }`, which a catalogue whose strings Rails renders as HTML, as Discourse's are, wants. Plurals are hashes, `{ "one": "%{count} post", "other": "%{count} posts" }`, read as one plural.

`corpus init` writes it for a JSON catalogue when `%{name}` placeholders outnumber every other shape; a yaml source is `rails` unless it names another.

## Qt

`library: "qt"` is Qt's `tr()` substitution, the library of the [qt-ts](Sources-and-adapters#qt-ts) source, which reads Qt Linguist `.ts` files with no converter, and of strings a converter brings from them. `%1` to `%99` are placeholders named by their number (Qt reads at most two digits, so `%01` is `%1` and `%100` is `%10` then a `0`), which may repeat and come in any order; `%L1` is `%1` shown in the locale's digits and counts as `%1`; `%n` is the count of a numerus form. Any other `%` is text (`100%`, `%N` in help text), as are braces and `#`, and so are angle brackets, which Qt catalogues use for prose such as `<dir>`, unless the type is declared `richText: { ui: "html" }`. `%1h %2m` is two placeholders and some letters, not two printf verbs, and `% 1` or `1%` is no `%1`: a translation that writes either is told it lost `%1`.

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

## Fluent

<!-- from: examples/fluent.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt"],
  sources: [{ adapter: "fluent", type: "ui", path: "i18n/{lang}/app.ftl" }],
});
```

A `fluent` source reads `.ftl` files: messages with a value, as Project Fluent writes them for COSMIC and other Rust apps. The editor sees ICU: `{$items}` is the placeholder `{items}`, a reference to another message such as `{trash}` is a placeholder named after it, and a select on a variable is a plural when its keys are plural categories or numbers:

```
copied = Copied {$items} {$items ->
    [one] item
   *[other] items
  } to {trash}
```

reads as `Copied {items} {items, plural, one {item} other {items}} to {trash}`. A select on other keys is an ICU select, so a translation that selects a count on words (`[unha]`, `[outra]`, which Fluent never matches) is named by `validate`. A pull writes a changed message back in that message's own layout and appends a new one at the end; everything else, comments included, stays byte for byte.

Attributes (`.title =`), terms (`-brand`), function calls (`NUMBER($n)`) and string literals are refused by name, every one in the file at once, until a project needs them; the literals Corpus writes itself, `{""}` for an empty variant and `{"."}` for a line that starts with `.`, `[` or `*`, read back. A select whose default is not `[other]` gains an `other` branch with the default's text, since that is what ICU falls back to, and a message the translator changes is written with `*[other]` as its default.

## Angular

Angular's i18n extracts to XLIFF, which the `xliff` source reads with no converter (see [Sources and adapters](Sources-and-adapters#xliff)). The text inside a unit is ICU: `{VAR_PLURAL, plural, …}` and `{VAR_SELECT, select, …}` are checked as plurals and selects, and Angular's inline elements are placeholders and tags, `{INTERPOLATION}` and `<LINK>…</LINK>`, so the library stays `icu`.

## gettext

The `gettext` source reads `.po` and `.pot` files with no converter and writes translations back in place (see [Sources and adapters](Sources-and-adapters#gettext)). Its library is `printf`: `%s`, `%d` and `%1$s` are placeholders a translation keeps, and a plural is checked branch by branch, each branch's verbs on their own. A project whose msgids carry another syntax names it with `library` on the source, or `corpus init --library`: `counterpart` for Python's `%(name)s` and `%(name)d`, though a bare `%s` beside them is then text, unchecked, and `%(n).1f` is not a placeholder; `icu` for `{name}`, where `#` in a plural branch is the number and an apostrophe before a brace quotes it.

## iOS

A String Catalog, the default since Xcode 15, is read with no converter by the `xcstrings` source (see [Sources and adapters](Sources-and-adapters#xcstrings)). Its library is `printf`, with Foundation's verbs, `%@`, `%lld` and `%1$@`, and its plurals: a substitution's plural names the argument it formats, `{arg2, plural, …}`, so a translation may put the plurals in another order or pluralise an argument English prints plainly, and in its branches `%arg` is that argument.

Older `.strings` and `.stringsdict` files have no adapter. An `exec` source can read them, by converting in both directions; see [Sources and adapters](Sources-and-adapters). A converter that leaves the verbs as they are can declare `library: "printf"` on the exec source's strings, so the verbs are checked. A `.stringsdict` plural becomes one string by writing the whole text as an ICU plural with the verbs inside each branch, `{count, plural, one {%d card} other {%d cards}}`: under `printf` that text is read as a plural, each branch's verbs are checked on their own, as an Android `<item>`'s are, and the branches the language needs are checked too. Only a text that parses as one plural from start to end is read this way; anything else, text after the plural, a brace inside a branch, a plural without `other`, is printf text as before, and `#` and angle brackets are text even inside a plural.

## When the library is wrong

Getting it wrong is usually loud, but not always, and the quiet directions are the ones to know before you choose.

**The loud ones.** An i18next catalogue read as `icu` or as `vue` refuses every string that interpolates, since `{{name}}` is not a valid placeholder in either; an ICU catalogue read as `vue` refuses every string with an argument in it. When five refusals have one cause, the wrong library whichever advice each drew, or a whole file is refused, the build stops with nothing pushed, and the message names the field to set:

<!-- from: recorded/wrong-library.out -->
```text
corpus: snapshot build failed:
  src/i18n/en.json [greeting]: invalid ICU: invalid placeholder name "{ name"; {{ }} is i18next's interpolation: declare library: "i18next" on the source
  src/i18n/en.json: every string in the file was refused (1)
  no snapshot was built: pushing the rest would archive every refused string
```

**The quiet ones.** Read as `i18next`, a single brace is text: a vue-i18n catalogue refuses nothing and says nothing, its `{name}` placeholders simply ceasing to be placeholders, and so does most of an ICU one, where a plural or a select is read as text like anything else. What i18next does refuse is a `{{`, which an ICU string acquires when a branch opens with a placeholder — `other {{name} updated the file}` — so those strings are dropped while every other string pushes — unless there are five of them, when the advice they share stops the build as above. The damage being partial is what makes it easy to miss, which is why that refusal carries `declare library: "icu"`. This repository's own catalogue has a plural, no `{{` anywhere, and builds all 224 strings silently under the wrong library.

Read as `icu`, a vue-i18n catalogue refuses only its `{'…'}` literals and any bare `}`; its pipe plurals become one string each, quietly.

In both the catalogue still pushes, and the only check left is a translator noticing. That is the argument for setting `library` deliberately rather than discovering it from a failure.
