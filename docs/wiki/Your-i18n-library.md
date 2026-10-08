A source declares the library its catalogue was written for:

```ts
{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json", library: "i18next" }
```

One value decides how placeholders are spelled, how plurals are written, and what is escaped. `icu` is the default and what an absent field means.

`corpus init` looks at your source file and writes the library it finds, saying so as it does: `i18next` when more values use `{{name}}` than use a single-brace `{name}` or a printf verb, and none holds an ICU plural or select, `vue` when they use a top-level pipe or a `{'…'}` literal and neither of those, `chrome` when every value is a Chrome i18n entry with a `message`, `counterpart` when `%(name)s` placeholders outnumber every other shape, `easy_localization` when a string holds `{}` or an `@:key` link, `rails` when `%{name}` placeholders outnumber every other shape. It writes nothing for a plain ICU catalogue, since that is the default.

(`syntax` is the old name for this field, on a `messages` or `table` source; any other source refuses it by name. A config that still uses it there works, and `build`, `push` and `validate` each say once that the field has been renamed. It goes at 1.0.)

## next-intl, FormatJS, Lingui, and anything ICU

<!-- from: examples/next-intl.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-PT"],
  sources: [
    {
      adapter: "messages",
      type: "ui",
      path: "messages/{lang}.json",
      library: "formatjs",
    },
  ],
  check: { include: ["app", "components"] },
});
```

These write ICU MessageFormat as FormatJS reads it, which is `library: "formatjs"`; `corpus init` writes it when the package.json names react-intl, next-intl, svelte-i18n, ember-intl, intl-messageformat or `@formatjs/intl` (not FormatJS's `Intl` polyfills). Lingui's parser quotes otherwise, which is `library: "lingui"`, written when the package.json names `@lingui/core`: an apostrophe before a brace quotes only up to one that closes it, so `'{name}'` is the text `{name}` while `l'{name}` prints `l'` and the value. Plain ICU, the default `library: "icu"`, reads the same as FormatJS but for one thing: under `formatjs` an apostrophe quotes, as FormatJS reads it, so `'{'0'}'` is the text `{0}`, `''` is one apostrophe, and a French `l'{name}` quotes the placeholder away, which `corpus validate` names with the advice to write `’`, as it does when an apostrophe before a brace, a tag or a `#` quotes past a plural branch's end and breaks the plural. Under `icu` an apostrophe is the character, as Angular, Flutter and most exporters read it. Placeholders are `{name}`. Plurals and selects are arguments:

```
{count, plural, one {# document} other {# documents}}
{gender, select, female {her file} male {his file} other {their file}}
```

An ordinal is `{age, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}`: a plural picked by the language's ordinal rule, so English needs `one`, `two`, `few` and `other`, French `one` and `other`, and German, with one ordinal form, may write plain text. A translation keeps it a `selectordinal`.

One may sit in the other's branch, one level deep: `{gender, select, female {{count, plural, one {her # file} other {her # files}}} other {…}}`. `#` is the count of the plural it is in; inside a select within a plural write `{count}`, since FormatJS prints a `#` there as it stands. A translation nests as its source does; a plural in a plural, a select in a select, or a third level is refused.

A translation needs the branches its language uses; one it lacks is **incomplete**, listed apart by `corpus validate` and never the reason it fails, since the runtime falls back to `other`. A category only exact millions or decimals reach, French or Spanish `many` and Czech `many`, is allowed and never asked for, since a runtime with older plural data has none of it and `other` serves those numbers. A branch the language never selects, `one` in Japanese, is incomplete the same way: dead text. A category CLDR has removed that runtimes still ship is allowed, as Hebrew `many` is, which Android 6 to 13 picks. Where your runtime picks other categories for a language, say so on the source: `pluralRules: { he: ["one", "two", "many", "other"] }` makes each one needed for that language, `other` always among them. Two libraries pick a branch by their own rule rather than the language's: counterpart by English's in every language, so a Japanese plural needs `one` and a Polish `few` is never shown, and easy_localization, by default, by the value itself, `zero`, `one` and `two` for 0, 1 and 2, so `few` and `many` are never shown. A gettext file picks by its own `Plural-Forms`: an Italian `.po` with `nplurals=2` has no `many`, whatever CLDR adds. The branches Corpus asks for, and the ones it calls dead, follow that rule. A language whose only category is `other` may write the plural plainly: `{count}件の投稿` for `{count, plural, one {# post} other {# posts}}`, keeping every value the `other` branch uses.

A translation may use only the values the source text names: a value the code passes that the source never prints, such as a `count` beside `{counter}`, must appear in the source first, since FormatJS throws on one it is not given. A plural the translation writes as plain text may still print the plural's count, and a translation in the source's own base language, British English from English or European Portuguese from Brazilian, needs only the categories the source's plural has.

A placeholder may carry a format, `{count, number}`, `{d, date, short}`, `{t, time}`, with the style after a second comma: a translation keeps the name and the type and may change the style, the chip inserts the source's form, and a preview formats the example's value for the language when it can. Rich text is tags: `<link>terms</link>`, `<icon/>`, and HTML with attributes as Gitea writes it, `<a href="%s" target="_blank">docs</a>`: the attribute text is part of the tag, compared as HTML reads it, so `<a href = "x">` or `<a target="_blank" href="x">` is the source's tag while a changed `href` is not, and the chip inserts it as the source writes it; where the type is read as HTML, whose tags are not compared, a placeholder inside an attribute, `<a href='%{url}'>`, must still be kept, as the text's own are; Where the text is HTML (a type declared `richText: { ui: "html" }`, or Android's strings) and under i18next, whose `Trans` keeps them void, `<br>`, `<hr>`, `<wbr>` and `<img …>` need no closing tag and `<br></br>` counts as one; where a component renders each tag (next-intl, FormatJS), `<br></br>` is a pair like any other and a lone `<br>` is left open: write `<br/>`. Corpus checks that a translation keeps every placeholder, every branch its language needs, and every tag. That last rule is for tags a component renders, where a tag the code does not know is an error. Where the application reads the string as HTML instead (`dangerouslySetInnerHTML`, Android's `fromHtml`, an email template), a translator may rightly write `<i>` or `<br/>` the source does not have; declare the type `richText: { ui: "html" }` and tags are no longer compared, while placeholders and plurals still are, and a tag that never closes, or a stray closing one, is text, as a browser reads it. See [Types read as HTML](Metadata-types-entities-and-the-glossary#types-read-as-html). Prose that spells a tag it does not mean, Jellyfin's `https://example.com/<baseurl>`, is refused as an unclosed tag where a component renders the tags, with the same advice from `corpus push` and from the server; where the application renders the type as HTML, declare it `richText: "html"` and the brackets are text. Under `library: "formatjs"` ICU's apostrophe quoting (`'<baseurl>'`) makes them text, as FormatJS reads it; otherwise word the text so the brackets are not there.

An English file `formatjs extract` writes from each `defaultMessage`, Mastodon's `en.json`, is the code's in the same way: `generated: true` on the source refuses proposals into it, and its translations still push and pull as before.

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

Four things differ from ICU, and Corpus handles all four:

**Interpolation is `{{name}}`**, with or without spaces, and a format after a comma is ignored. A single brace is text. The unescaped form `{{- name}}` is its own placeholder, kept apart from `{{name}}`, because i18next inserts one raw and escapes the other, and a translation that swaps them changes what the user sees. A `{{…}}` that holds no name, Grafana's Go template `{{ define "<NAME>" }}`, is printed as written, since i18next is passed no value for it; Corpus reads it as a placeholder named by its content, so a translation must keep it verbatim (`{{ définir « <NAME> » }}` is reported) and the chip inserts it as the source writes it.

**Plurals are suffix keys**, not arguments: `item_one` and `item_other`, and in Polish `_few` and `_many` too. Corpus reads a family of them as one string, `item`, a plural whose branches are the forms, so a Polish translator gets `few` and `many` to write though the English file has neither, a Japanese one needs only `other`, and a pull writes each branch back to its own key, a new one beside the family's. `_zero` is a branch in every language, as i18next picks it for 0. A key the file also holds bare (`item` beside `item_one`), an `_ordinal` family and a lone `_other` stay keys of their own, except in a source whose language has only `other`, such as Japanese, Korean, Chinese, Vietnamese or Thai: there a lone `item_other` is the family `item`, so its targets' `item_one` and `item_few` are its forms, and a key that merely ends in `_other` is read as a plural too. Before 0.22 each suffixed key was a string of its own. The first 0.22 push archives those rows and reads each family from the files; where a file has no translation for a language, the push carries what Corpus holds on the old keys to the family's string, and reports how many. An object of two forms or more, `{ "one": "…", "other": "…" }`, which a build step turns into suffix keys (Rocket.Chat's), is read as one plural; a lone `{ "other": "…" }` is a key, as i18next reads it.

**Keys are often the English sentence**, spaces, punctuation and all. That works: a string id is any text without control characters. When the English file holds `""` as the value, as i18next-parser writes it and the app falls back to the key, Corpus reads the key as the text: the string page shows the sentence, the placeholders in it are checked, and `push` says how many strings took the key. A proposal on such a string is refused with the reason, "the text of `<key>` is its key: change it in the code that calls t() or tr(), and the catalogue follows", on the string page, the API and the MCP tools alike; `get_string` carries `keyIsText` so an agent knows before it tries.

**Tags are `Trans`'s**, compared between source and translation: `<0>the docs</0>` needs its `<0>…</0>`, and `<2/>` in its place wraps nothing and is refused. A tag that never closes in the English text is text, as `t()` returns it for React to escape: `<no title>` or `"<GroupID>:<Role>"` needs no `richText`. A translation may leave as many unpaired as the source does; one more that is a closing tag, a source tag's name or HTML markup (`<ul> <li>`) is broken and refused, while `<sans titre>` is prose. So declare `richText: { ui: "html" }` only for a type the app really renders as HTML, since it stops the tag comparison. A `</br>` no `<br>` opens renders as nothing; `corpus build` names it.

`<Trans>` is a catalogue call, so `corpus check` does not report the text inside it.

**An extracted catalogue is the code's.** Where `i18next-cli extract` writes the English file from `t(key, defaultValue)`, as Grafana's does, an edit there is undone by the next extract. Say so on the source, `generated: true`, and a proposal on its strings is refused with the reason, "change the text in the code, and the next extract carries it"; a top-level `_comment`, Grafana's "The code is the source of truth for English phrases", is then no string. A source file git ignores is taken as generated without the key.


**sprintf on top of i18next.** An app that installs `i18next-sprintf-postprocessor`, as Rocket.Chat does, formats some strings with `%s` too. `placeholders: ["printf"]` on the source checks those verbs as printf does, in the strings whose English writes one, read as sprintf-js reads them, `%(name)s` included: `%s秒` and `%d%%` are the value, while a `%` in any other string, `% of`, or an example's `%email%`, stays text. `corpus init` writes it when two strings or more hold printf verbs.
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

**Corpus does not check how many forms a translation has**, unless you tell it the rule, and the reason is worth knowing. vue-i18n picks a form by how many there are, through whatever `pluralizationRules` the application registered. Its default rule reaches no index above the third; a project can register one that expects an exact count, as Vikunja does for Russian, where three forms are right and the four CLDR gives Russian are wrong. A rule Corpus imposed would refuse text that the project renders correctly, so it imposes none.

A project that registers no `pluralizationRules` runs vue-i18n's default rule, and can say so: `pluralRules: "default"` on the source. Under it, two forms are shown for 1 and for every other count, and three or more for 0, 1 and every other count, a fourth never. So a translation whose forms number other than the source's is **incomplete**, and `corpus validate`, the editor and an agent's draft say what each form is shown for: a Polish `{n} minuta | {n} minuty | {n} minut` for `{n} minute | {n} minutes` reads `3 forms read as =0 | =1 | other under vue-i18n's default rule, where the source's 2 are =1 | other`. One form passes in a language whose every count reads alike, Japanese, Chinese, Korean or Thai; in Turkish, Hungarian or Persian, where CLDR has `one` and `other` but a number is often followed by one form, it is named, and you know whether it is right. The editor says what each form is shown for beside the draft, and `get_string` returns `formMeanings`, `["=1", "other"]` here.

What it does check is that every placeholder the source uses appears in at least one form of the translation, and it refuses an empty form — `a | | b` — which vue-i18n's own compiler refuses too. Corpus counts a form of nothing but whitespace as empty; the compiler trims only spaces and newlines, so a form holding a lone tab passes there and not here.

**Names and `@` are read as vue-i18n's compiler reads them.** A placeholder name is ASCII: letters, digits, `_`, `$` and `-`, so `{local-mta}` is a name and `{aquí}` or `{名前}` is not; vue-i18n cannot compile a message holding one and shows it raw, braces included, and Corpus reports exactly that. An `@` is vue-i18n's link (`@:common.name`); one that opens no link, `@all` or `a@b.c`, does not compile, so a translation that writes one is invalid and a source that writes one gets a warning: write `{'@'}`.

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

Gitea's catalogue, and any Go, C or Android app, writes its placeholders as printf verbs: `Pushed %d commits to %s`, Go's `%[2]s` and C's `%2$s` for an explicit position, `%-8.2f` with flags, width and precision, `%%` for a percent. Under `library: "printf"` each verb is a placeholder named by its position, the chip inserts it as the source writes it, and a translation must keep the same positions. A Python mapping key, `%(name)s`, is a placeholder named by its key instead. Braces, angle brackets and `#` are text here: there are no ICU arguments and no tags, so HTML in a Go string is prose.

Two things to know. **A moved verb needs its index.** Unindexed verbs are read in order, so a translation that writes `%d commits de %s` for `%s pushed %d commits` prints the name where the count goes; Corpus says so (`%d at position 1 is %s in the source; a verb that moved needs its index, %n$d or %[n]d`), and in Go `%[2]d commits de %[1]s` is right. **A `%` in prose is text.** `50% off` opens no verb, since the space flag is not read, and `100%%` is a percent on both sides; a percent-encoded URL is another matter, `%20b` reads as a verb here as it does in Go, so write `%%20` as Go's own strings do. The hint's index form follows the source: `%n$` when the source writes one, as C, Java, JavaScript's sprintf and Android do, Go's `%[n]` when the source writes that, and both when it writes neither, since only your project's language decides which works. A verb of another type where the source has none of that type did not move: it reads `%d where the source has %lld`. **A dropped verb is named once.** A translation of `%s pushed %d commits to %s` that leaves out the count reads, verb by verb, as a changed second and a missing third; Corpus says `missing %d`, which is what happened.

**C's length modifiers and iOS's `%@`.** `%ld`, `%lu`, `%zu`, `%lld` and `%hhd` are one verb each, modifier and letter together, so `%lu` where the source has `%ld` is a changed verb and the chip inserts `%ld` whole; `%@`, the object verb of an iOS `.strings` file through an exec source, is checked like any other. A letter right after Go's `%t` or `%q` reads as a modifier and a verb (`%td`), so keep the space Go's own strings keep. Two things stay as they are: Java's `%,d` grouping flag is not read, so that verb is text, and Go's `%[2]*d`, a width taken from an argument, reads as one verb at position 2.

`init` names the library when most placeholder-bearing strings carry verbs.

## counterpart: Element and matrix-web-i18n

`library: "counterpart"` is the substitution Element Web's `_t()` uses. `%(name)s`, or `%(name)d`, is a placeholder named `name`, which a translation must keep; a tag is a substitution the code fills, `<b>…</b>` a pair and a bare `<pill>` with no close one on its own, and a translation keeps both; braces are text. Plurals are JSON objects, `{ "one": "%(count)s room", "other": "%(count)s rooms" }`, which read as one plural (see [Sources and adapters](Sources-and-adapters#messages)). counterpart picks a form by English's rule in every language, so a translation needs `one` and `other` whatever its language, a Polish `few` or `many` never being shown.

```json
{ "invite": "Invite <pill> to %(roomName)s" }
```

`corpus init` writes it when `%(name)s` placeholders outnumber every other shape. Element's own substitution leaves a tag the code does not pass as text, `<empty string>`, which Corpus cannot know, so it asks a translation to keep such a tag as written too.

## gen-l10n: Flutter

Flutter's own localisation, `gen-l10n` (`flutter gen-l10n`, or `generate: true` in `pubspec.yaml`), reads `.arb` files with a subset of ICU, which is `library: "gen_l10n"`; `corpus init` writes it for an `.arb` catalogue. Placeholders are `{name}`, and plurals and selects are arguments as in ICU, with these differences, each one a syntax error gen-l10n stops the whole app's generation for, or text it prints as written:

- `#` is text: gen-l10n prints it as written, so a plural's branch writes the count as `{count}`. A translation branch that writes more `#` than any of the source's branches is refused with that advice; a hashtag the source writes, `#{channel}`, may be repeated in every form.
- A placeholder is formatted only as `date` or `time` with a skeleton, exactly one of intl's named formats, `{d, date, ::yMd}`, `::yMMMd`, `::jm`; any other skeleton, `::yMd+jm` among them, stops generation and is refused (only an `@key` placeholder's `format` joins several by `+`). `{n, number}`, `{d, date}` and `{d, date, short}` are refused; format a number in the code, through the placeholder's `@key` metadata.
- There is no `selectordinal` and no `offset:`.
- A plural's keys are `=0`, `=1`, `=2`, `zero`, `one`, `two`, `few`, `many` and `other`.
- An apostrophe is the character. A project whose `l10n.yaml` sets `use-escaping: true` quotes with it, which Corpus does not read: `init` says so.
- Angle brackets are text, as gen-l10n has no tags: `Press <Enter>` is text, and a translation may drop or reword a `<b>`. A type read as HTML (`richText: "html"`), for an app that renders the text through an HTML widget, reads them as tags.

## easy_localization: Flutter

`library: "easy_localization"` is the Flutter package's syntax. `{}` is a positional placeholder, the first `{}` of a string the first argument, so a translation keeps their order, and `{name}` a named one; `@:key` links to another key's text, and `@.upper:key` (or `.lower`, `.capitalize`) links with a modifier. A translation keeps each placeholder and each link as written: a draft that drops `@:appName` is refused, and one that writes `@:appName-Konto`, which the package reads as a link to a key named `appName-Konto`, is told the link it lost and the one it made. Braces around anything else, `#` and angle brackets are text. Plurals are JSON objects, `{ "one": "{} file", "other": "{} files" }`, read as one plural whose `{}` is the count. By default the package picks a form by the value, `zero`, `one` and `two` for 0, 1 and 2 where written and `other` otherwise, so a Polish `few` is never shown and Corpus says so. An app that passes `ignorePluralRules: false` to `EasyLocalization` picks by the plural rules the package carries instead, intl's table from an older CLDR, looked up by the language code alone; say so on the source with `pluralRules: "cldr"`. A table of categories is refused on such a source, since the package never picks by one. A Polish plural then needs `one`, `few` and `many`, a written `zero` no longer taking 0, Maltese has no `two`, French no `many`, and a language the table lacks (Sorani `ckb`) is still picked by value. Where the app sets a fallback locale, a category the translation lacks shows the fallback locale's text for it before `other`, so a missing category matters more there.

`corpus init` writes it when strings with `{}` or links outnumber those with single-brace or ICU arguments (vue-i18n writes `@:key` links too, so a link counts only where nothing else says vue), and a `{}` refused under another library says to declare it.

## Rails I18n and I18n.js

`library: "rails"` is Rails' interpolation, and I18n.js's `%{name}` form: the library of the [yaml](Sources-and-adapters#yaml) source, which reads Rails' YAML catalogues with no converter. `%{name}` is a placeholder a translation keeps as written, and the chip inserts it whole: `{application_name}` without the `%` is text to Rails and prints as it stands, so a translation that writes it is refused with `missing %{application_name}`. Rails' format style, `%<count>d` or `%<amount>.2f`, is a placeholder too; `%%` is a literal `%`; a `%{` that opens no name, `%{dana]` or `%{jina la mtumiaji}`, is refused, since Rails would print it as written; other braces, `#` and a lone `%` are text. Tags are read as under ICU, so a lone `<br>` is an unclosed tag unless the type is declared `richText: { ui: "html" }`, which a catalogue whose strings Rails renders as HTML, as Discourse's are, wants. Plurals are hashes, `{ "one": "%{count} post", "other": "%{count} posts" }`, read as one plural. A `zero` key is always a branch the runtime picks, for 0, as Ruby's I18n and I18n.js both do. A key whose name ends in `_html` (or is `html`) is HTML, as Rails marks it html_safe: a translation writes its own emphasis, `<em>` added or `<strong>` left out, but closes what it opens, so an unclosed `<a>`, a stray `</a>` or an attribute quote left open is invalid. Other keys compare their tags, since Rails prints them as text. A gem that renders other keys as HTML, simple_form's `simple_form.hints.*`, wants its own type with `richText`: `{ adapter: "yaml", type: "simple_form", path: "config/locales/simple_form.{lang}.yml" }` and `richText: { simple_form: "html" }`. Where your `Gemfile.lock` lists `rails-i18n`, a translation is checked against the gem's rule for its locale rather than CLDR's: French needs `one` and `other`, not `many`, and a Japanese `one` is text Ruby never shows. A locale the gem has no rule for takes I18n's own `one` and `other`. A locale your app gives a rule of its own in `config/initializers` keeps CLDR's, and `corpus build` says which rules it used.

**Values your code passes beside the source's.** A translation may print or pluralise on only the values its source names. When your code passes more, as Discourse's `d-number.js` passes `number` beside the `%{count}` its English prints, say so per string on the source, and a translation that writes `%{number}` instead is valid:

```js
{ adapter: "yaml", type: "ui", path: "config/locales/client.{lang}.yml", arguments: { "js.views_long": ["number"] } }
```

The id is the string's as `corpus build` reads it, a namespace's prefix included (`app:js.views_long` under `{ns}`), and a name is the value's alone, `number` rather than `%{number}`. An id no file of the source holds stops `build` and `validate` by name, so a typo never does nothing. The key is a `messages`, `table`, `gettext`, `qt-ts`, `yaml`, `xcstrings` or `strings` source's whose library names its values; printf, Qt and Chrome pass theirs by position and refuse it.

`corpus init` writes it for a JSON catalogue when `%{name}` placeholders outnumber every other shape; a yaml source is `rails` unless it names another. Where the source file has strings only HTML reads, an unclosed `<p>` or a lone `<br>`, init writes `richText: { ui: "html" }` for a yaml source read as `rails` and says so; for any other catalogue, a JSON one read as `rails` or a yaml one of another library, it names the line to add, and `corpus build` names it beside the refusals.

## Qt

`library: "qt"` is Qt's `tr()` substitution, the library of the [qt-ts](Sources-and-adapters#qt-ts) source, which reads Qt Linguist `.ts` files with no converter, and of strings a converter brings from them. `%0` to `%99` are placeholders named by their number (Qt reads at most two digits, so `%01` is `%1` and `%100` is `%10` then a `0`; Qt's own `arg()` starts at `%1`, and an app that substitutes `%0` itself is read the same way), which may repeat and come in any order; `%L1` is `%1` shown in the locale's digits and counts as `%1`; `%n` is the count of a numerus form, which a translation may print in every form. A marker beyond the ones `.arg()` fills, the source's count of them, lowest first, is text where it writes a number the source writes, as Turkish writes `%10` for 10%. An Arabic `٪` or a fullwidth `％` before one of the source's markers (`٪n`, `٪1`, `٪ 1`) is refused: Qt prints it as written. Before a number the source has no marker for, `٪50`, it is a percentage, and text. Any other `%` is text (`100%`, `%N` in help text), as are braces and `#`, and so are angle brackets, which Qt catalogues use for prose such as `<dir>`, unless the type is declared `richText: { ui: "html" }`. `%1h %2m` is two placeholders and some letters, not two printf verbs, and `% 1` or `1%` is no `%1`: a translation that writes either is told it lost `%1`.

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

Under `library: "chrome"` the `messages` adapter reads each entry as Chrome does: `message` is the text, `description` the string's note, and a placeholder's `example` its example value, which the chip's tooltip and the preview show. `$CURRENT$` is a placeholder, named without regard to case as Chrome matches it, so `$current$` in a translation is the same one; `$$` is a dollar, and braces, angle brackets and `%` are text. A bare `$1` to `$9` is a placeholder too, filled from the arguments, so a translation keeps it. Chrome reads some dollars otherwise than they look, and `corpus validate` warns where a source or a translation writes one, without failing the run: a lone `$` is dropped with the character after it (`$ karakter` shows `karakter`), so write `$$`; `$40` is substitution 4 and a 0, so write `$$40` for a price; and `$$NAME$` is a dollar before the placeholder, which Chrome then reads with the start of its value, so Bob shows as `ob` and a value of `$1` as a literal `$1`; with more dollars, `$$$NAME$` shows `$Bob`, and a `$1` value joins the run. Put a space between them. A run of dollars shows one fewer, and what follows it is text: `$$$1` shows `$$1`. A translation must keep every placeholder the source has, and the chip inserts it as the source writes it.

A pull writes a translation into its entry's `message` and leaves the rest of the entry, and a byte-order mark, where they were; a key new to a language copies the source's `description` and `placeholders` beside it. `init` names the library when every value in the source file is such an object; without the library, the same file reads as nested keys (`copied.message`), since a catalogue of `{ title, message }` objects has that shape too. An extension split over several apps, as Bitwarden's is, is one `{ns}` pattern per layout: `apps/{ns}/src/_locales/{lang}/messages.json`.


**An extension's own placeholders.** Some extensions fill a syntax of their own on top of Chrome's: uBlock Origin writes `{{name}}` and replaces it in its JavaScript. Say so on the source, `library: "chrome", placeholders: ["i18next"]`, and each `{{name}}` is a placeholder a translation must keep, beside the `$NAME$` ones; `{{input:number}}` is the value `input`. `corpus init` writes it when two strings or more hold `{{name}}`. Tags are still text under `chrome`.
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

An `android` source names the `res` directory. `values/strings.xml` is the source, and each language in the config has its `values-<qualifier>` directory by Android's own rule: `de` is `values-de`, `pt-BR` is `values-pt-rBR`, `sr-Latn` is `values-b+sr+Latn`, and the legacy `in` and `iw` are `values-in` and `values-iw`. So write the config's languages the way the directories name them; a repository that spells one with `b+` where `-r` would do (`values-b+pt+BR`) needs `pt-BR` moved to `values-pt-rBR` first. A language with a region, `ta-IN`, whose plain language and other variants the config does not also list, reads each module's `values-ta-rIN`, or its `values-ta` where that is all the module has, as Android resolves a device's `ta-IN`; a pull writes into whichever the module keeps. Thunderbird's modules spell Tamil both ways, and one `ta-IN` in the config reads them all. It does not where two variants would share the file, `pt-BR` beside `pt-PT`, or where the region changes the script Android matches: `zh-TW` is Traditional and `values-zh` Simplified, so each keeps its own directory.

A `<string>` is a string, and a `<plurals>` is one string whose text is an ICU plural on `quantity`, one branch per `<item>`: the translator sees and writes `{quantity, plural, one {%d episode} other {%d episodes}}`, and a draft with a `many` branch comes back as a `<plurals>` with a `many` item. An `=0` branch, or any key that is not a plural category, has no `<item>` aapt2 compiles, so a pull names that plural, leaves its element as it is, and exits 1. Strings marked `translatable="false"`, `product` variants other than the default, and values that are an `@string/` reference are left out and left as they are; `<string-array>` is not read. The text is what the app shows: `\'`, `\"`, `\n`, entities, CDATA and the double quotes that keep spaces are undone for the editor and written back escaped, while markup inside a string, `<b>` or `<xliff:g id="name">`, stays as written. Only a literal `<` is markup: `&lt;Unknown Recipient&gt;` and `<![CDATA[<no name>]]>` are the text `<Unknown Recipient>` and `<no name>`, which a translation may write in its own words and a pull writes back escaped, while an escaped pair, `&lt;b>…&lt;/b>` for `Html.fromHtml`, is still a pair a translation keeps. A pull edits only the elements and plural items whose text changed and appends new ones before `</resources>`, so an unchanged file stays byte for byte, comments included.

The library is `android`: printf verbs as under `printf` (the index form is `%n$s`), and tags as under ICU, so a translation's `<i>` the source lacks is named. `<xliff:g id="…">%d</xliff:g>`, which marks text the translator keeps, is a tag too: a translation that drops one around a verb, or turns it into text, is named, while a translated `id` is fine, since aapt strips the element. A verb in a tag's attribute takes its place in the order, since `getString` fills the verbs before `fromHtml` reads the tags: in `<a href="%s">%s</a>` the link is `%1$s` and its text `%2$s`, so a translation may write `<a href="%1$s">%2$s</a>`, and one that writes `%1$s` for the text is named. A string the app shows through `Html.fromHtml` may take the translator's own tags; declare its type `richText: { ui: "html" }` ([Types read as HTML](Metadata-types-entities-and-the-glossary#types-read-as-html)).

**A modular app** keeps its strings in many modules' `res` directories, which Gradle merges into one set of resources, a library module's string and the app's of the same name being one entry. List them as one source, `path` an array: an id two modules hold with the same text is one string, a pull writes its translation into every module's file that holds it, and `merge` says what happens where their text differs, `"strict"` (the default) refusing it by name and `"last-wins"` taking the later pattern's, so list lower-priority modules first, the reverse of Gradle's dependency order. Compose Multiplatform's `composeResources` are another matter: each module generates its own `Res` class, so a `{ns}` in the pattern captures the module, and its ids are `module:name`, stripped again when a pull writes them. Build variants (`src/debug/res`, `src/beta/res`) override `main`, so they hold its ids and are left out: in a source of their own they are a duplicate, and in the list they would stand for `main` in every build. A variant whose translatable strings `main` lacks may be a source of its own.

<!-- from: examples/android-modules.config.ts -->
```ts
import { defineCorpus } from "@corpus-tool/cli";

export default defineCorpus({
  project: "acme-mail",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de", "pt-BR"],
  sources: [
    // The modules' res directories, which Gradle merges into one set of
    // resources: lower-priority modules first, so the later one wins.
    {
      adapter: "android",
      type: "ui",
      path: [
        "core/ui/src/main/res",
        "feature/settings/src/main/res",
        "app/src/main/res",
      ],
      merge: "last-wins",
    },
    // Compose Multiplatform's own resources, one Res class per module:
    // their ids are `<module>:<name>`.
    {
      adapter: "android",
      type: "ui",
      path: "feature/{ns}/src/commonMain/composeResources",
    },
  ],
});
```

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

A `fluent` source reads `.ftl` files: messages with a value, as Project Fluent writes them for COSMIC and other Rust apps. The editor sees ICU: `{$items}` is the placeholder `{items}`, a reference to another message such as `{ trash }` is the placeholder `{@trash}`, so it reads apart from a variable, and a select on a variable is a plural when its keys are plural categories or numbers:

```
copied = Copied {$items} {$items ->
    [one] item
   *[other] items
  } to {trash}
```

reads as `Copied {items} {items, plural, one {item} other {items}} to {@trash}`. A translation may refer to a message its source does not, as German does to use its own word for one the English writes inline, while dropping a reference its source has is invalid. A name is Fluent's own, so `{ $cards-per-minute }` is the placeholder `{cards-per-minute}`, and a plural may sit in another plural's variant, or a select in a select's, one level deep; a translation may nest differently from the source, as Croatian's agreement does where the source writes two plurals side by side. A translation may select on what Fluent lets it: on a value the source passes, with keys of its own (a missing one takes the `*` default), or on a term's `.gender`; a select on a variable the source never passes is a warning, since Fluent shows the default. Keys that never match are still named: a word key on a count (`[unha]`, which a number never matches; a word default such as `*[otro]` is fine), a key in another case than the source's (`[Seconds]` for `[seconds]`), and a select whose keys are all translations of the source's (`[sekunder]` for `[seconds]`). A pull writes a changed message back in that message's own layout and appends a new one at the end; everything else, comments included, stays byte for byte.

A string literal stays as written, `{"{{c1::"}`, and is text, so a translation may write its own or none; a `#` in a plural's variant, which Fluent prints, reads as `{"#"}`, since `#` alone is the count. A term, `-brand = Firefox`, is a string like any message, and `{ -brand }` in a message is the placeholder `{-brand}`; its arguments stay as written, `{-brand(case: "gen")}`, and a translation may pass its own or use a term the source does not, while dropping one the source uses is invalid. A term's attributes, such as Czech's `.gender = masculine`, are kept as the file has them, and a select on one reads as a select on `-brand.gender`. `{ NUMBER($s, minimumIntegerDigits: 2) }` reads as the ICU format `{s, number, minimumIntegerDigits: 2}` and `{ DATETIME($d) }` as `{d, date}`: a translation keeps the type and may change the options, written as Fluent's own (`name: "value"` or `name: number`), and a pull writes the function back. A message's attributes (`.title =`), any other function (`PLATFORM()`) and number literals are refused by name, a message at a time, until a project needs them: the file's other messages read, a refused source message is left out of the push as a string that does not parse is, and a refused translation is not seeded, is named by `corpus build` and as a `validate` warning, and is left by a pull as the file has it. `{""}` for an empty variant and `{"."}` for a line that starts with `.`, `[` or `*`, which Corpus writes itself, read as their text. A select whose default is not `[other]` gains an `other` branch with the default's text, since that is what ICU falls back to, and a message the translator changes is written with `*[other]` as its default.

## Angular

Angular's i18n extracts to XLIFF, which the `xliff` source reads with no converter (see [Sources and adapters](Sources-and-adapters#xliff)). The text inside a unit is ICU: `{VAR_PLURAL, plural, …}` and `{VAR_SELECT, select, …}` are checked as plurals and selects, and Angular's inline elements are placeholders and tags, `{INTERPOLATION}` and `<LINK>…</LINK>`, so the library stays `icu`. A source file `ng extract-i18n` wrote, as its `original="ng2.template"` says, or whose unit ids are mostly the ones Angular computes, is the extractor's output whatever custom `@@` ids sit beside them: Corpus reads it as generated, and refuses proposals into it, since the next extract would undo them. Where `angular.json` lists the locales it builds (`i18n.locales`), `corpus init` lists those languages, and names the target files beside them it leaves out, such as the ones a translation platform downloads but the app does not ship.

## gettext

The `gettext` source reads `.po` and `.pot` files with no converter and writes translations back in place (see [Sources and adapters](Sources-and-adapters#gettext)). Its library is `printf`: `%s`, `%d` and `%1$s` are placeholders a translation keeps, and a plural is checked branch by branch, each branch's verbs on their own. Python's `%(name)s`, with any flags, width, precision and conversion (`%(n).1f`), is a placeholder named by its key under `printf` itself, so a Django or Python `.po`'s `python-format` entries are checked with no library: a translation that renames the key, `%(typ)s` for `%(organization_type)s`, is reported, as Python would raise `KeyError`. Its `python-brace-format` entries (`{name}`) are not read as placeholders yet. A project whose msgids carry another syntax names it with `library` on the source, or `corpus init --library`: `icu` for `{name}`, where `#` in a plural branch is the number and an apostrophe is the character, or `formatjs` where an apostrophe before a brace quotes it, as FormatJS reads ICU.


### libfmt, std::format and Python's str.format

A gettext catalogue whose msgids write `{name}` fields, as a C++ program formatting with libfmt or `std::format` does (`fmt::format(_("_Show {count:L} of:"), fmt::arg("count", n))`), or Python's `str.format` (`#, python-brace-format`), is `library: "fmt"`; `corpus init` writes it when the fields outnumber printf verbs. A field is a placeholder named by its name, `{count:L}` and `{count}` the same one, so a translation may change the spec but not the name: a name the program does not pass aborts libfmt built without exceptions, and is refused. `{}` is the next argument by position, counted afresh in each plural form, and never mixed with numbered fields like `{0}`, which both libraries refuse. `{{` and `}}` are braces, and any other brace, `{%s}` or a lone `}`, is refused, since libfmt aborts on it too. A plural, `msgid` and `msgid_plural`, is one string, as under `printf`; its count is whatever field the source writes, such as `{days:L}`, never a `{count}` the program does not pass. `init` leaves a catalogue whose printf verbs and `%(name)s` outnumber its fields as `printf`, and says how many such msgids a `fmt` catalogue holds.
## iOS

A String Catalog, the default since Xcode 15, is read with no converter by the `xcstrings` source (see [Sources and adapters](Sources-and-adapters#xcstrings)). Its library is `printf`, with Foundation's verbs, `%@`, `%lld` and `%1$@`, and its plurals: a substitution's plural names the argument it formats, `{arg2, plural, …}`, so a translation may put the plurals in another order or pluralise an argument English prints plainly, and in its branches `%arg` is that argument.

Older `Localizable.strings` files are read by the `strings` source with no converter (see [Sources and adapters](Sources-and-adapters#strings)), with the same `printf` library. `.stringsdict` files have no adapter yet. An `exec` source can read them, by converting in both directions; see [Sources and adapters](Sources-and-adapters). `printf` fits text the app formats with `String(format: NSLocalizedString(…), …)`, its verbs `%@`, `%d`, `%1$@`; a converter that leaves the verbs as they are can declare `library: "printf"` on the exec source's strings, so the verbs are checked. An app that replaces `%0`, `%1` in the text itself, as Stats does with `string.replacingOccurrences(of: "%\(index)", with: param)`, writes no printf verbs: under `printf` they are text, and a translation that drops one passes. Declare `library: "qt"` for it, which reads `%0` to `%99` by number; `corpus build` says so when a printf source writes `%` and a digit that no verb reads. A `.stringsdict` plural becomes one string by writing the whole text as an ICU plural with the verbs inside each branch, `{count, plural, one {%d card} other {%d cards}}`: under `printf` that text is read as a plural, each branch's verbs are checked on their own, as an Android `<item>`'s are, and the branches the language needs are checked too. Only a text that parses as one plural from start to end is read this way; anything else, text after the plural, a brace inside a branch, a plural without `other`, is printf text as before, and `#` and angle brackets are text even inside a plural.

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
