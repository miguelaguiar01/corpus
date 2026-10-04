// ICU MessageFormat subset (§5): {name} placeholders, formatted ones
// ({n, number}), {arg, select, …} and {n, plural, …} with =N branches and
// # for the number, one nested in the other's branch at most (#674), and
// rich-text tags, <name>…</name> or <name/>, which the client renders
// and a translation must keep. Each library reads its own placeholder
// syntax into the same nodes; a < that opens no tag is text.

import {
  localeOf,
  PLURAL_CATEGORIES,
  readsAsIcu,
  type Library,
} from "./strings";

export type IcuNode =
  // `attrPlaceholders`: those written in the attributes of a tag the
  // text holds as prose, an unclosed one in a type read as HTML (#948).
  | { kind: "literal"; text: string; attrPlaceholders?: IcuNode[] }
  // A formatted placeholder, `{n, number}`, `{d, date, short}`, `{t,
  // time}`, keeps its type and its style (#555): a translation keeps
  // the name and the type and may change the style.
  // Under printf a placeholder is a verb, `%s` or `%[2]d`, named by its
  // position and kept as `written` for the chip and the message (#594).
  | {
      kind: "placeholder";
      name: string;
      format?: PlaceholderFormat;
      written?: string;
    }
  | { kind: "select"; arg: string; branches: Record<string, IcuNode[]> }
  | {
      kind: "plural";
      arg: string;
      branches: Record<string, IcuNode[]>;
      // ICU's selectordinal: the branch by CLDR's ordinal rules (#995).
      ordinal?: true;
    }
  // `#` inside a plural branch: the number itself.
  | { kind: "count"; arg: string }
  // <name>children</name>, or <name/> with none.
  // `attrs` is an opening tag's attribute text as written (`href="%s"`),
  // part of the tag's identity: a translation keeps it verbatim (#590).
  // `attrPlaceholders` are the placeholders written in it, which a type
  // read as HTML, whose tags a translation writes its own way, still
  // keeps apart from the text's own (#948).
  // `self`: written closed on itself, `<2/>`, which wraps nothing.
  | {
      kind: "tag";
      name: string;
      attrs?: string;
      attrPlaceholders?: IcuNode[];
      children: IcuNode[];
      self?: true;
    }
  // vue-i18n's pipe plural: `one | other`, positional, with no argument
  // because the count is passed at render time rather than named in the
  // string. Branches are in the order they were written.
  | { kind: "forms"; branches: IcuNode[][] };

export type PlaceholderFormat = {
  type: "number" | "date" | "time";
  style?: string;
};

export type IcuError = { message: string; position: number };

// A tag a text writes that the parser reads as text: an open tag no
// close matches, or a close no open tag does.
// `branch` is the plural or select branch it is in, each level's
// argument and key (`count:one`), outermost first; none at the top.
export type ProseTag = {
  name: string;
  close: boolean;
  attrs?: string;
  at: number;
  branch: string[];
};

// The tags `text` writes that i18next reads as text, as the parse in
// "markup" reads them, a whole plural's branches each its own; none for
// a text that does not parse (#986).
export function proseTagsOf(text: string, syntax: Library): ProseTag[] {
  const prose: ProseTag[] = [];
  return parseIcu(text, syntax, { html: "markup", prose }).ok ? prose : [];
}

// Whether two texts are one message as the library renders it (#1009).
// Under ICU, the same flat text for every choice of branches: a plural
// hoisted over the whole sentence, the text around it carried into its
// branches, and `#` against `{n, number}` are the same; a branch key one
// has and the other lacks, `=1` against `one`, is not. Elsewhere, the
// same bytes.
export function sameMessage(a: string, b: string, library: Library): boolean {
  if (a === b) return true;
  if (library !== "icu" && library !== "formatjs" && library !== "gen_l10n")
    return false;
  const left = parseIcu(a, library);
  const right = parseIcu(b, library);
  if (!left.ok || !right.ok) return false;
  const same = (x: Set<string>, y: Set<string> | undefined) =>
    y !== undefined && x.size === y.size && [...x].every((k) => y.has(k));
  // Every plural or select on one argument, in either text, has the same
  // keys: one keyed apart picks another branch for the same value, `=1`
  // in one and `one` in another, which no single choice stands for.
  let uneven = false;
  const choices = (nodes: IcuNode[], out: Map<string, Set<string>>) => {
    for (const node of nodes) {
      if (node.kind === "tag") choices(node.children, out);
      if (node.kind !== "select" && node.kind !== "plural") continue;
      const id = `${node.kind === "select" ? "select" : node.ordinal ? "ordinal" : "plural"}\u0000${node.arg}`;
      const keys = new Set(Object.keys(node.branches));
      const seen = out.get(id);
      if (seen && !same(seen, keys)) uneven = true;
      out.set(id, keys);
      for (const branch of Object.values(node.branches)) choices(branch, out);
    }
    return out;
  };
  const ours = choices(left.nodes, new Map());
  const theirs = choices(right.nodes, new Map());
  if (
    uneven ||
    ours.size !== theirs.size ||
    [...ours].some(([id, keys]) => !same(keys, theirs.get(id)))
  )
    return false;
  const ids = [...ours.keys()];
  const options = ids.map((id) => [...ours.get(id)!]);
  if (options.reduce((n, keys) => n * keys.length, 1) > 512) return false;
  const render = (nodes: IcuNode[], chosen: Map<string, string>): string =>
    nodes
      .map((node): string => {
        switch (node.kind) {
          case "literal":
            return node.text;
          case "placeholder":
            return node.format
              ? `\u0000{${node.name}, ${node.format.type}${node.format.style ? `, ${node.format.style}` : ""}}`
              : `\u0000{${node.name}}`;
          case "count":
            return `\u0000{${node.arg}, number}`;
          case "tag":
            return `\u0001<${node.name}${node.attrs ? ` ${node.attrs}` : ""}${node.self ? "/" : ""}>${render(node.children, chosen)}\u0001</${node.name}>`;
          case "select":
          case "plural": {
            const id = `${node.kind === "select" ? "select" : node.ordinal ? "ordinal" : "plural"}\u0000${node.arg}`;
            const key = chosen.get(id)!;
            return render(node.branches[key]!, chosen);
          }
          case "forms":
            return JSON.stringify(node);
        }
      })
      .join("");
  const chosen = new Map<string, string>();
  const every = (i: number): boolean => {
    if (i === ids.length)
      return render(left.nodes, chosen) === render(right.nodes, chosen);
    return options[i]!.every((key) => {
      chosen.set(ids[i]!, key);
      return every(i + 1);
    });
  };
  return every(0);
}

export type IcuParseResult =
  { ok: true; nodes: IcuNode[] } | { ok: false; errors: IcuError[] };

// An argument name is an identifier in any script, marks included for
// Thai and Devanagari, or, as ICU allows and older catalogues write, a
// bare number ({0}, {1}): a translated name is then a placeholder the
// source lacks, not a parse error (#653).
const NAME_RE = /^(?:[\p{L}_][\p{L}\p{M}\p{N}_]*|[0-9]+)$/u;
// vue-i18n's own (@intlify/message-compiler's isNamedIdentifier and its
// list index): ASCII, a hyphen or `$` inside, or a number (#1017).
const VUE_NAME_RE = /^(?:[A-Za-z_][A-Za-z0-9_$-]*|-?[0-9]+)$/;
// Fluent's Identifier (fluent.ebnf): ASCII, a letter first, hyphens
// inside, as `{ $cards-per-minute }` writes it, `-` first for a term
// and `@` for a message reference (#1083); a plural and a format are on
// a variable, and a select on one or on a term's attribute,
// `-brand.gender` (#990).
const FLUENT_NAME_RE = /^[-@]?[A-Za-z][A-Za-z0-9_-]*$/;
const FLUENT_VARIABLE_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const FLUENT_SELECTOR_RE =
  /^(?:[A-Za-z][A-Za-z0-9_-]*|-[A-Za-z][A-Za-z0-9_-]*\.[A-Za-z][A-Za-z0-9_-]*)$/;
// A Fluent function's options, which a format's style is under the
// fluent reading since the writer passes them to NUMBER() or DATETIME():
// `name: "value"` or `name: number`, comma-separated, spaces alone
// between them as the writer keeps them on one line (#990).
export const FLUENT_OPTIONS_RE =
  /^[A-Za-z][\w-]* *: *(?:"[^"\\{}\n\t]*"|-?\d+(?:\.\d+)?)(?: *, *[A-Za-z][\w-]* *: *(?:"[^"\\{}\n\t]*"|-?\d+(?:\.\d+)?))*$/;
// A term reference with its arguments, `{-brand(case: "gen")}`.
const FLUENT_TERM_CALL_RE =
  /^\{\s*(-[A-Za-z][A-Za-z0-9_-]*)\((?:[^()"\n]|"(?:[^"\\\n]|\\.)*")*\)\s*\}/;

// A Fluent string literal at the start of `text`, `{"…"}`, as its text
// and the length it spans; undefined where `text` opens no literal.
// Fluent escapes `\"`, `\\` and `\uXXXX` or `\UXXXXXX`, nothing else.
function fluentLiteral(
  text: string,
  at: number,
): { text: string; length: number } | undefined {
  if (!/^\{\s*"/.test(text)) return undefined;
  const read = /^\{\s*"((?:[^"\\\n]|\\.)*)"\s*\}/.exec(text);
  if (!read) throw new ParseFailure("unclosed string literal", at);
  const value = read[1]!.replace(
    /\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{6})|(["\\])|(.))/g,
    (_, u4: string, u6: string, plain: string, other: string) => {
      if (other !== undefined)
        throw new ParseFailure(
          `unknown escape \\${other} in a string literal`,
          at,
        );
      if (plain !== undefined) return plain;
      const point = parseInt(u4 ?? u6, 16);
      if (point > 0x10ffff)
        throw new ParseFailure(
          `\\U${u6} is past the last Unicode code point`,
          at,
        );
      // A lone surrogate is no character: @fluent/bundle reads U+FFFD.
      return point >= 0xd800 && point <= 0xdfff
        ? "\uFFFD"
        : String.fromCodePoint(point);
    },
  );
  return { text: value, length: read[0].length };
}
// A branch key is a word, or a bare number (`1 {marca} other {marcas}`).
const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;
// A plural branch is a CLDR category or an exact number (`=1 {…}`).
export { PLURAL_CATEGORIES };
const PLURAL_KEY_RE = /^(?:zero|one|two|few|many|other|=[0-9]+)$/;
// A tag as the rich-text libraries write it: <link>, <checkoutDocs/>,
// react-i18next's <2> for an indexed Trans child, and HTML with
// attributes as Gitea writes it, <a href="%s" target="_blank"> (#590).
// The attribute group starts at one whitespace and runs lazily to the
// close, with nothing else matching spaces, so a name followed by a run
// of whitespace and no `>` is linear, not cubic; readTag trims it.
const TAG_RE = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*|[0-9]+)((?:\s[^<>]*?)?)(\/?)>/;
// The libraries that read tags and whose placeholders are named or
// numbered, so one in a tag's attribute is read as a placeholder (#948);
// Android's verb takes its place in the argument order, as `getString`
// formats the text before `fromHtml` reads its tags (#956).
const ATTR_PLACEHOLDER_LIBRARIES: ReadonlySet<Library> = new Set([
  "icu",
  "formatjs",
  "android",
  "fluent",
  "i18next",
  "rails",
  "counterpart",
  "chrome",
  "qt",
]);
// Every closing tag of a text, by TAG_RE's names.
const CLOSE_RE = /<\/([A-Za-z][A-Za-z0-9_-]*|[0-9]+)>/g;
// HTML's void elements, read so only where the text's tags are HTML or
// its library treats them so (#643); HTML ignores their case.
const VOID_TAGS = new Set(["br", "hr", "wbr", "img"]);

export function isVoidTag(name: string): boolean {
  return VOID_TAGS.has(name.toLowerCase());
}

// HTML's elements, whose names in a translation's unclosed tag are
// markup broken rather than prose like `<sans titre>` (#986).
const HTML_ELEMENTS = new Set(
  "a abbr address article aside b bdi bdo blockquote body br button caption cite code col colgroup dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i img input ins kbd label legend li link main mark nav ol option p pre q s samp section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr".split(
    " ",
  ),
);

export function isHtmlElement(name: string): boolean {
  return HTML_ELEMENTS.has(name.toLowerCase());
}

// A tag's identity for a chip and for the check that a translation
// keeps it: the name, with its attribute text when it has one.
function tagIdentity(tag: { name: string; attrs?: string }): string {
  return tag.attrs ? `${tag.name} ${tag.attrs}` : tag.name;
}
// A tag's identity with each printf verb in its attributes written by
// the position it takes, so Android's `href="%s"` at position 1 and
// `href="%1$s"` are one tag, and `href="%d"` another (#956).
function positionedIdentity(tag: {
  name: string;
  attrs?: string;
  attrPlaceholders?: IcuNode[];
}): string {
  const verbs = (tag.attrPlaceholders ?? []).filter(
    (node) =>
      node.kind === "placeholder" &&
      /^\d+$/.test(node.name) &&
      node.written !== undefined &&
      PRINTF_VERB_RE.test(node.written),
  );
  if (!tag.attrs || verbs.length === 0) return tagIdentity(tag);
  let at = 0;
  const attrs = tag.attrs.replace(
    new RegExp(`%%|${PRINTF_VERB_RE.source.slice(1)}`, "g"),
    (verb) => {
      const node = verbs[at];
      if (verb === "%%" || node?.kind !== "placeholder") return verb;
      at += 1;
      return verb.replace(/^%(?:\[\d+\]|\d+\$)?/, `%${node.name}$`);
    },
  );
  return at === verbs.length
    ? tagIdentity({ name: tag.name, attrs })
    : tagIdentity(tag);
}
// i18next's interpolation name: an identifier, dotted into an object
// ({{user.name}}); a format after a comma ({{date, short}}) is ignored.
const I18NEXT_NAME_RE = /^[\p{L}_$][\p{L}\p{M}\p{N}_.$]*$/u;

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

// printf's verb: Go's `%[n]verb` or C's `%n$verb` index, then flags,
// width and precision, then C's length modifier (`%ld`, `%zu`, `%lld`)
// and the verb letter, `@` being Objective-C's object verb (#614).
// `%%` is a literal percent. The space flag is left out: "50% off" is
// prose, not a verb.
const PRINTF_VERB_RE =
  /^%(?:\[(\d+)\]|(\d+)\$)?([-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?)((?:hh|h|ll|l|z|j|t|L|q)?[a-zA-Z@])/;

// Whether a printf verb starts at `at`, as the printf reading takes one;
// a Python `%(key)` the reading tries first is no verb here.
export function printfVerbAt(text: string, at: number): boolean {
  return PRINTF_VERB_RE.test(text.slice(at));
}

// sprintf-js's verb, as its parser reads one: a `n$` position or a
// `(name)`, then `+`, a `0` or `'x` pad, `-`, width and precision.
const SPRINTF_JS_RE =
  /^%(?:([1-9]\d*)\$|\(([^)]+)\))?\+?(?:0|'[^$])?-?\d*(?:\.\d+)?[b-gijostTuvxX]/;

// Python's `%` operator: a mapping key in parentheses, then printf's
// flags, width and precision and its conversion (#1012). The space flag
// stays out, so "50%(approx) of" is prose.
const PYTHON_KEY_RE =
  /^%\(([^()\s]+)\)([-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?)([hlL]?[diouxXeEfFgGcrsa])/;

// counterpart's `%(name)s` (#663), as Element's matrix-web-i18n writes
// it: the name in parentheses, then `s` or `d`.
const COUNTERPART_PLACEHOLDER_RE = /^%\(([^()\s]+)\)[sd]/;

// easy_localization (#664): `{}` positional or `{name}`, and a link to
// another key, `@:key` or `@.upper:key`, whose key is word characters,
// hyphens, `|` and dots as the package's own pattern reads it, a nested
// `@:chat.changeFormat.bullet` included, or parenthesised; a dot that
// ends the sentence is not the key's.
const EASY_PLACEHOLDER_RE = /^\{([\p{L}_][\p{L}\p{M}\p{N}_]*)?\}/u;
const EASY_LINK_RE = /^@(?:\.[a-z]+)?:(?:\([\w|.-]+\)|[\w|.-]*[\w|-])/;

// Qt's `%1`–`%99`, `%0` and `%01` among them as Qt reads at most two
// digits, localised `%L1`, and `%n`, the numerus count (#666).
const QT_PLACEHOLDER_RE = /^%(L?)([0-9][0-9]?|n)/;

// Rails I18n's `%{name}` and its format style `%<count>d`,
// `%<amount>.2f` (#665); `%%` is a literal `%`.
const RAILS_PLACEHOLDER_RE =
  /^%(?:\{([^{}\s]+)\}|<([^<>\s]+)>[-+ 0#]*\d*(?:\.\d+)?[a-zA-Z])/;

// Chrome i18n's `$NAME$` (#595): letters, digits, `_` and `@`, matched
// case-insensitively against the `placeholders` map, so the name is
// lowercased and the written form kept.
export const CHROME_PLACEHOLDER_RE = /^\$([A-Za-z0-9_@]+)\$/;

// The verb of a printf placeholder as written, modifier and letter
// (`ld` of `%2$-8ld`): what a translation must keep at the position,
// and what the index form names. Undefined for text that is not a verb.
export function printfVerbOf(written: string): string | undefined {
  return PRINTF_VERB_RE.exec(written)?.[4] ?? PYTHON_KEY_RE.exec(written)?.[3];
}

// The libraries whose text has no ICU arguments of its own, so a text
// that is one plural from end to end is read as that plural.
export const WHOLE_PLURAL_LIBRARIES: ReadonlySet<Library> = new Set([
  "printf",
  "i18next",
  "counterpart",
  "easy_localization",
  "rails",
  "qt",
  "fmt",
]);

// The libraries whose lexer reads a `{` as text, so a pair of them in a
// plural read whole is a form's text (#1052); i18next's `{{name}}`,
// easy_localization's `{}` and fmt's fields are read as their own.
const TEXT_BRACES: ReadonlySet<Library> = new Set([
  "printf",
  "rails",
  "counterpart",
  "qt",
]);

// A printf or i18next text that is one ICU plural from end to end
// (#652, #662): a converter's gettext plural, or a plural object read
// as one string, its forms written in the library's own syntax.
const PRINTF_PLURAL_OPENS_RE =
  /^\s*\{\s*[\p{L}_][\p{L}\p{M}\p{N}_.-]*\s*,\s*plural\s*,/u;
const PRINTF_PLURAL_RE = new RegExp(
  `${PRINTF_PLURAL_OPENS_RE.source}[\\s\\S]*\\}\\s*$`,
  "u",
);

// A String Catalog's substitutions (#726): plurals on `argN`, the Nth
// printf argument, among printf text, `%arg` in a branch that argument.
const ARG_PLURAL_RE = /^\{\s*arg(\d+)\s*,\s*plural\s*,/;

// The position a substitution's `argN` names, or undefined for any
// other argument.
export function argIndexOf(name: string): string | undefined {
  return /^arg(\d+)$/.exec(name)?.[1];
}

function argPlurals(
  source: string,
  html: boolean | "markup",
  syntax: Library,
): IcuNode[] | undefined {
  if (syntax !== "printf" || !/\{\s*arg\d+\s*,\s*plural\s*,/.test(source))
    return undefined;
  try {
    return new Parser(source, syntax, html, "argPlurals").parseSequence(false);
  } catch (error) {
    if (error instanceof ParseFailure) return undefined;
    throw error;
  }
}

// Why a printf text that opens as a plural is not one (#652), for a
// translation of a plural, where falling back to text would hide it.
export function printfPluralError(
  text: string,
  html: boolean | "markup",
  syntax: Library,
  layers: readonly Library[] = [],
): IcuError | undefined {
  if (!PRINTF_PLURAL_OPENS_RE.test(text)) return undefined;
  return withLayers(layers, () => {
    if (argPlurals(text, html, syntax)) return undefined;
    const read = readPrintfPlural(text, html, syntax);
    return "error" in read ? read.error : undefined;
  });
}

// Where the text after a whole plural starts, as the parser reads the
// plural: its first character past the plural, whitespace skipped, or
// 0 where text comes before it.
function pluralEnd(
  source: string,
  html: boolean | "markup",
  syntax: Library,
): number {
  const start = source.search(/\S/);
  if (source[start] !== "{") return 0;
  const end = new Parser(source, syntax, html, "wholePlural").argumentEnd(
    start,
  );
  return end + (/^\s*/.exec(source.slice(end))?.[0].length ?? 0);
}

function readPrintfPlural(
  source: string,
  html: boolean | "markup",
  syntax: Library,
  prose?: ProseTag[],
): { nodes: IcuNode[] } | { error: IcuError } {
  try {
    const nodes = new Parser(
      source,
      syntax,
      html,
      "wholePlural",
      prose,
    ).parseSequence(false);
    const kept = nodes.filter(
      (node) => !(node.kind === "literal" && node.text.trim() === ""),
    );
    if (kept.length === 1 && kept[0]!.kind === "plural") return { nodes };
    const after = pluralEnd(source, html, syntax);
    return {
      error: {
        message: "text after the plural: a plural read whole is the whole text",
        position: after,
      },
    };
  } catch (error) {
    if (error instanceof ParseFailure)
      return { error: { message: error.message, position: error.position } };
    throw error;
  }
}

// What a sequence has read so far: its nodes, the text not yet a node,
// and where that text starts.
type Sequence = {
  nodes: IcuNode[];
  literal: string;
  literalStart: number;
  attrPlaceholders: IcuNode[];
};

const MAX_DEPTH = 200;

// The skeletons gen-l10n formats a date or a time by, its
// `validDateFormats`: intl's DateFormat constructors (#1038).
const GEN_L10N_DATE_FORMATS = new Set(
  (
    "d E EEEE LLL LLLL M Md MEd MMM MMMd MMMEd MMMM MMMMd MMMMEEEEd QQQ QQQQ " +
    "y yM yMd yMEd yMMM yMMMd yMMMEd yMMMM yMMMMd yMMMMEEEEd yQQQ yQQQQ " +
    "H Hm Hms j jm jms jmv jmz jv jz m ms s"
  ).split(" "),
);

// A libfmt or str.format replacement field (#1002): an index or a name,
// Python's `.attr` and `[key]` after it, a `!r` conversion and a spec
// with no brace in it.
const FMT_FIELD_RE =
  /^\{(\d+|[A-Za-z_][A-Za-z0-9_]*)?((?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]{}]*\])*)(?:![rsa])?(?::[^{}]*)?\}/;

// How many of the braces starting at `at` are literal, `}}` pairs, in a
// fmt text (#1002); undefined where the run is not pairs. In a plural
// read whole, a gettext plural's forms, the run's last brace closes the
// branch where a branch key follows it, and its last two the branch and
// the plural at the text's end: its forms' own braces stay as written.
export function fmtLiteralBraces(
  text: string,
  at: number,
  inBranch: boolean,
): number | undefined {
  const run = /^\}+/.exec(text.slice(at))![0].length;
  const after = text.slice(at + run);
  // The plural's own `}` may stand apart, after space or a line break.
  const closing = !inBranch
    ? 0
    : /^\s*$/.test(after)
      ? 2
      : /^\s*(?:(?:=\d+|zero|one|two|few|many|other)\s*\{|\}\s*$)/.test(after)
        ? 1
        : 0;
  const literal = run - Math.min(closing, run);
  return literal % 2 === 0 ? literal : undefined;
}

// The plural cases gen-l10n's `pluralCases` takes (#1038).
const GEN_L10N_PLURAL_KEYS = new Set([
  "=0",
  "=1",
  "=2",
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
]);

class Parser {
  private pos = 0;
  // The next verb's position when none is written (#594).
  private printfNext = 1;
  // The position the next `{}` takes under fmt, from 0, and whether the
  // format string numbers its fields itself, which libfmt and Python
  // refuse to mix with `{}` (#1002).
  private fmtNext = 0;
  private fmtIndexing?: "automatic" | "manual";
  // Whether a substitution's branch has yet to write its argument (#726).
  private ownFree = false;
  // The next `{}`'s position under easy_localization (#664).
  private positional = 0;
  // Under "markup", the tags a browser would read as text: an open tag
  // no closing tag matches and a closing tag with no open tag, found in
  // one pass over the text (#755).
  private proseTags?: Set<number>;

  // Where each tag name's last `</name>` is, found in one pass (#896).
  private closes?: Map<string, number>;
  // Open tags already found not to close, where the one pass could not
  // tell (a close in another branch): tried once, so never exponential.
  private readonly unclosed = new Set<number>();
  // The select and plural whose branches the cursor is in, outermost first.
  private readonly within: ("select" | "plural")[] = [];
  // Those branches, each its argument and key (#986).
  private readonly branchPath: string[] = [];
  // Hostile input stays bounded (#861): nesting past any catalogue, and
  // markup retries past a budget of the text's length, fail the parse
  // rather than the stack or the clock.
  private depth = 0;
  private steps = 0;

  constructor(
    private readonly source: string,
    private readonly syntax: Library,
    // True reads HTML's void tags; "markup", a type read as HTML (#755),
    // also reads a tag that never closes, or a stray closing tag, as text,
    // as a browser does.
    private readonly html: boolean | "markup",
    // "wholePlural": printf text that is wholly one ICU plural, as a
    // gettext or String Catalog converter writes it (#652), its braces
    // the plural's, its branches printf. "argPlurals": printf text with
    // plurals on `argN` in it (#726).
    private readonly mode: "text" | "wholePlural" | "argPlurals" = "text",
    // Where the tags read as text go, for a validation that tells a
    // source's prose from a translation's broken tag (#986).
    private readonly proseOut?: ProseTag[],
  ) {}

  // The placeholder syntaxes a source layers on its library (#1049),
  // set for one parse by `parseWith`.
  private readonly layers = layering;

  // A layered syntax's token, where the base would read text: i18next's
  // `{{name}}`, printf's verbs by position, fmt's `{name}` fields and
  // Chrome's `$NAME$`. It adds a placeholder and never structure.
  private lexLayers(seq: Sequence, ch: string): boolean {
    for (const layer of this.layers) {
      const rest = this.source.slice(this.pos);
      if (layer === "i18next" && rest.startsWith("{{")) {
        const start = this.pos;
        const node = this.parseDoubleBrace();
        // Written as the text writes it, for the base's own messages; a
        // `:suffix` names no other value, as uBlock's `i18n.render` strips
        // `{{input:number}}` to `{{input}}`.
        this.node(
          seq,
          node.kind === "placeholder"
            ? {
                ...node,
                name: node.name.split(":")[0]!,
                written: this.source.slice(start, this.pos),
              }
            : node,
        );
        return true;
      }
      if (layer === "printf" && ch === "%") {
        if (rest.startsWith("%%")) return this.text(seq, "%", 2);
        const verb = SPRINTF_JS_RE.exec(rest);
        // As sprintf-js reads them, so `% of` and Hungarian `50%-a` are
        // text, and so is an example's `%email%`, a name of two ASCII
        // characters or more whose closing `%` starts no verb or `%%`, where
        // `%d%%`, `%s%s`, `%dx%d` and `%s件中%d件` are verbs.
        const example = /^%[A-Za-z_][A-Za-z0-9_]+(?=%)/.exec(rest);
        if (
          !verb ||
          (example &&
            !/^%%/.test(rest.slice(example[0].length)) &&
            !SPRINTF_JS_RE.test(rest.slice(example[0].length)))
        )
          continue;
        if (verb[2] !== undefined)
          return this.placeholder(seq, verb[2], verb[0]);
        const position = verb[1] ? Number(verb[1]) : this.printfNext;
        this.printfNext = position + 1;
        return this.placeholder(seq, String(position), verb[0]);
      }
      if (layer === "fmt" && (rest.startsWith("{{") || rest.startsWith("}}")))
        return this.text(seq, ch, 2);
      if (layer === "fmt" && ch === "{") {
        const field = FMT_FIELD_RE.exec(rest);
        if (!field) continue;
        const name =
          field[1] === undefined
            ? String(this.fmtNext++)
            : `${field[1]}${field[2] ?? ""}`;
        return this.placeholder(seq, name, field[0]);
      }
      if (layer === "chrome" && ch === "$") {
        const named = CHROME_PLACEHOLDER_RE.exec(rest);
        if (named)
          return this.placeholder(seq, named[1]!.toLowerCase(), named[0]);
      }
    }
    return false;
  }

  // Inside a plural's branch, `#` is the number; anywhere else it is text.
  // Inside a tag, the sequence ends at its closing tag.
  parseSequence(
    inBranch: boolean,
    pluralArg?: string,
    closing?: string,
  ): IcuNode[] {
    if (++this.depth > MAX_DEPTH)
      throw new ParseFailure(`nested more than ${MAX_DEPTH} deep`, this.pos);
    try {
      return this.readSequence(inBranch, pluralArg, closing);
    } finally {
      this.depth--;
    }
  }

  private readSequence(
    inBranch: boolean,
    pluralArg?: string,
    closing?: string,
  ): IcuNode[] {
    const seq: Sequence = {
      nodes: [],
      literal: "",
      literalStart: this.pos,
      attrPlaceholders: [],
    };
    // In a plural read whole, under a library whose `{` is text, the
    // braces a form writes in pairs are its text: Godot's `{num}`, which
    // String::format fills after the lookup, and only a `}` past them
    // closes the branch, as the writers' pluralBranches counts (#1052).
    const textBraces =
      this.mode === "wholePlural" && inBranch && TEXT_BRACES.has(this.syntax);
    let braces = 0;

    while (this.pos < this.source.length) {
      if (++this.steps > 4 * this.source.length + 10_000)
        throw new ParseFailure(
          "too many tags left open to read the text",
          this.pos,
        );
      const ch = this.source[this.pos]!;
      // FormatJS's apostrophe (#1010): `''` is one, and one before a
      // brace, a tag or a plural's `#` quotes the text to the next lone
      // one, or to the end; any other is the character.
      if (ch === "'" && this.syntax === "formatjs") {
        const next = this.source[this.pos + 1];
        if (next === "'") {
          this.text(seq, "'", 2);
          continue;
        }
        if (
          next === "{" ||
          next === "}" ||
          next === "<" ||
          next === ">" ||
          (next === "#" && pluralArg !== undefined)
        ) {
          let quoted = "";
          let at = this.pos + 1;
          while (at < this.source.length) {
            if (this.source[at] === "'") {
              at += 1;
              if (this.source[at] !== "'") break;
            }
            quoted += this.source[at];
            at += 1;
          }
          this.text(seq, quoted, at - this.pos);
          continue;
        }
      }
      // A run of braces in a fmt plural read whole: the closing ones are
      // the branch's and the plural's, the rest literal pairs (#1002).
      if (ch === "}" && this.syntax === "fmt") {
        const literal = fmtLiteralBraces(this.source, this.pos, inBranch);
        if (literal === undefined)
          throw new ParseFailure(
            "a } that closes no fmt field: write }} for a brace",
            this.pos,
          );
        if (literal > 0) {
          this.text(seq, "}".repeat(literal / 2), literal);
          continue;
        }
      }
      if (ch === "}" && textBraces && braces > 0) {
        braces -= 1;
        this.text(seq, ch);
        continue;
      }
      if (
        ch === "}" &&
        (readsAsIcu(this.syntax) ||
          this.syntax === "android" ||
          (this.mode !== "text" && inBranch))
      ) {
        if (!inBranch) {
          throw new ParseFailure("unmatched '}'", this.pos);
        }
        if (closing !== undefined) {
          throw new ParseFailure(`unclosed <${closing}>`, seq.literalStart);
        }
        this.flush(seq);
        return seq.nodes;
      }
      // A plural read whole opens with the text's first brace.
      const opensPlural =
        this.mode === "wholePlural" && !inBranch && ch === "{";
      if (!opensPlural && this.lexLayers(seq, ch)) continue;
      if (ch === "{" && textBraces) {
        braces += 1;
        this.text(seq, ch);
        continue;
      }
      if (this.lexLibrary(seq, ch, inBranch, opensPlural, pluralArg)) continue;
      // vue-i18n has no tag syntax: a `<` is text (#644).
      if (ch === "<" && this.syntax !== "vue") {
        const tag = this.readTag();
        if (tag === undefined) {
          this.text(seq, ch);
          continue;
        }
        const after = this.pos;
        const raw = this.source.slice(tag.start, after);
        if (
          this.html === "markup" &&
          (this.prose().has(tag.start) ||
            this.unclosed.has(tag.start) ||
            (tag.kind === "close" &&
              (closing === undefined || tag.name !== closing)))
        ) {
          this.proseTag(seq, raw, tag, tag.start);
          continue;
        }
        this.flush(seq);
        if (tag.kind === "open" && this.html === "markup") {
          // A tag whose close sits in another branch, which the one pass
          // cannot tell, is text too; what it read is undone.
          const counters = [
            this.printfNext,
            this.ownFree,
            this.positional,
          ] as const;
          const read = this.proseOut?.length ?? 0;
          try {
            // The attributes first: their verbs come before the text's.
            const attrs = this.tagAttrs(tag.attrs, tag.start);
            const children = this.parseSequence(inBranch, pluralArg, tag.name);
            seq.nodes.push({ kind: "tag", name: tag.name, ...attrs, children });
          } catch (error) {
            if (
              !(error instanceof ParseFailure) ||
              error.message !== `unclosed <${tag.name}>`
            )
              throw error;
            this.pos = after;
            [this.printfNext, this.ownFree, this.positional] = counters;
            // What the abandoned child read as text is read again.
            if (this.proseOut) this.proseOut.length = read;
            this.unclosed.add(tag.start);
            this.proseTag(seq, raw, tag, tag.start);
          }
          seq.literalStart = this.pos;
          continue;
        }
        if (tag.kind === "close") {
          if (closing === undefined || tag.name !== closing) {
            throw new ParseFailure(
              closing === undefined
                ? `unexpected </${tag.name}>`
                : `unexpected </${tag.name}>; <${closing}> is open`,
              tag.start,
            );
          }
          return seq.nodes;
        }
        seq.nodes.push({
          kind: "tag",
          name: tag.name,
          ...this.tagAttrs(tag.attrs, tag.start),
          children:
            tag.kind === "self"
              ? []
              : this.parseSequence(inBranch, pluralArg, tag.name),
          // A void element is one whatever its form, `<br>`, `<br/>`
          // or `<br></br>`.
          ...(tag.kind === "self" &&
            !isVoidTag(tag.name) && { self: true as const }),
        });
        seq.literalStart = this.pos;
        continue;
      }
      if (ch === "{" && this.syntax === "fluent") {
        // Fluent's string literal is its text (#990), written as read.
        const literal = fluentLiteral(this.source.slice(this.pos), this.pos);
        if (literal) {
          this.text(seq, literal.text, literal.length);
          continue;
        }
        // A term's arguments are the locale's: the placeholder is the
        // term, written with them (#990).
        const call = FLUENT_TERM_CALL_RE.exec(this.source.slice(this.pos));
        if (call) {
          this.placeholder(seq, call[1]!, call[0]);
          continue;
        }
      }
      if (ch === "{") {
        // vue-i18n: `{name}` is a placeholder and `{'…'}` is the escape
        // for a literal `@`, `|` or `{`, which the language would
        // otherwise read as syntax.
        if (this.syntax === "vue") {
          this.node(seq, this.parseVueBrace());
          continue;
        }
        // i18next: {{name}} is a placeholder, a single brace is text,
        // and there are no arguments, so nothing else opens here.
        // A plural read whole opens with a single brace (#662).
        if (this.syntax === "i18next" && !opensPlural) {
          if (this.source[this.pos + 1] !== "{") {
            this.text(seq, ch);
            continue;
          }
          this.node(seq, this.parseDoubleBrace());
          continue;
        }
        this.node(seq, this.parseArgument(inBranch));
        continue;
      }
      // gen-l10n's lexer takes `#` as text: it prints as written (#1038).
      if (
        ch === "#" &&
        pluralArg !== undefined &&
        this.syntax !== "i18next" &&
        this.syntax !== "gen_l10n"
      ) {
        this.flush(seq);
        seq.nodes.push({ kind: "count", arg: pluralArg });
        this.pos += 1;
        seq.literalStart = this.pos;
        continue;
      }
      this.text(seq, ch);
    }
    if (closing !== undefined) {
      throw new ParseFailure(`unclosed <${closing}>`, seq.literalStart);
    }
    if (inBranch) {
      throw new ParseFailure("unclosed branch '{'", seq.literalStart);
    }
    this.flush(seq);
    return seq.nodes;
  }

  private flush(seq: Sequence): void {
    if (seq.literal !== "") {
      seq.nodes.push({
        kind: "literal",
        text: seq.literal,
        ...(seq.attrPlaceholders.length > 0
          ? { attrPlaceholders: seq.attrPlaceholders }
          : {}),
      });
      seq.literal = "";
      seq.attrPlaceholders = [];
    }
  }

  // Text at the cursor, `length` characters of the source read as `text`.
  private text(seq: Sequence, text: string, length = text.length): true {
    seq.literal += text;
    this.pos += length;
    return true;
  }

  // A node the reader that made it has already consumed.
  private node(seq: Sequence, node: IcuNode): void {
    this.flush(seq);
    seq.nodes.push(node);
    seq.literalStart = this.pos;
  }

  // A placeholder written as `written` at the cursor, consumed.
  private placeholder(seq: Sequence, name: string, written: string): true {
    this.flush(seq);
    seq.nodes.push({ kind: "placeholder", name, written });
    this.pos += written.length;
    seq.literalStart = this.pos;
    return true;
  }

  // A library's own syntax at the cursor: true where it read something.
  private lexLibrary(
    seq: Sequence,
    ch: string,
    inBranch: boolean,
    opensPlural: boolean,
    pluralArg: string | undefined,
  ): boolean {
    switch (this.syntax) {
      case "counterpart":
        return this.lexCounterpart(seq, ch, opensPlural);
      case "easy_localization":
        return this.lexEasy(seq, ch, opensPlural, pluralArg);
      case "rails":
        return this.lexRails(seq, ch, opensPlural);
      case "qt":
        return this.lexQt(seq, ch, opensPlural);
      case "chrome":
        return this.lexChrome(seq, ch);
      case "printf":
      case "android":
        return this.lexPrintf(seq, ch, inBranch, opensPlural, pluralArg);
      case "fmt":
        return this.lexFmt(seq, ch, inBranch, opensPlural);
      default:
        return false;
    }
  }

  // counterpart (#663): `%(name)s` is a placeholder, braces and `#` are
  // text but for a plural read whole, and tags are substitutions.
  private lexCounterpart(
    seq: Sequence,
    ch: string,
    opensPlural: boolean,
  ): boolean {
    if (ch === "%") {
      const match = COUNTERPART_PLACEHOLDER_RE.exec(
        this.source.slice(this.pos),
      );
      if (match) return this.placeholder(seq, match[1]!, match[0]);
    }
    if (ch === "#" || (ch === "{" && !opensPlural)) return this.text(seq, ch);
    return false;
  }

  // easy_localization (#664): `{}` and `{name}` are placeholders, a link
  // must be kept, and braces around anything else, `#` and angle
  // brackets are text, but for a plural read whole.
  private lexEasy(
    seq: Sequence,
    ch: string,
    opensPlural: boolean,
    pluralArg: string | undefined,
  ): boolean {
    const rest = this.source.slice(this.pos);
    const link = ch === "@" ? EASY_LINK_RE.exec(rest) : null;
    if (link) return this.placeholder(seq, link[0], link[0]);
    const brace =
      ch === "{" && !opensPlural ? EASY_PLACEHOLDER_RE.exec(rest) : null;
    // In a plural's form, `{}` is the count.
    if (brace)
      return this.placeholder(
        seq,
        brace[1] ?? pluralArg ?? String(this.positional++),
        brace[0],
      );
    if (ch === "#" || ch === "<" || (ch === "{" && !opensPlural))
      return this.text(seq, ch);
    return false;
  }

  // Rails I18n (#665): `%{name}` is a placeholder, `%%{` a literal,
  // braces and `#` text but for a plural read whole; tags as ICU's.
  private lexRails(seq: Sequence, ch: string, opensPlural: boolean): boolean {
    const rest = this.source.slice(this.pos);
    if (rest.startsWith("%%")) return this.text(seq, "%%");
    const match = ch === "%" ? RAILS_PLACEHOLDER_RE.exec(rest) : null;
    if (match) return this.placeholder(seq, (match[1] ?? match[2])!, match[0]);
    // A `%{` no name closes is a placeholder mistyped, which Rails prints
    // as it is (`%{dana]`); `%%{` writes the text (#948).
    if (rest.startsWith("%{"))
      throw new ParseFailure(
        "%{ opens no placeholder here: one is a name without spaces and a closing }; write %%{ for the text itself",
        this.pos,
      );
    if (ch === "#" || (ch === "{" && !opensPlural)) return this.text(seq, ch);
    return false;
  }

  // Qt (#666): a placeholder is its number, `%L1` being `%1` shown in the
  // locale's digits; any other `%`, braces and `#` are text, and angle
  // brackets too unless the type is read as HTML.
  private lexQt(seq: Sequence, ch: string, opensPlural: boolean): boolean {
    const match =
      ch === "%" ? QT_PLACEHOLDER_RE.exec(this.source.slice(this.pos)) : null;
    if (match) {
      // Named by its value: `%01` is Qt's `%1`.
      const digits = match[2]!;
      return this.placeholder(
        seq,
        digits === "n" ? "n" : String(Number(digits)),
        match[0],
      );
    }
    if (
      ch === "#" ||
      (ch === "<" && !this.html) ||
      (ch === "{" && !opensPlural)
    )
      return this.text(seq, ch);
    return false;
  }

  private lexChrome(seq: Sequence, ch: string): true {
    if (ch === "$") {
      const rest = this.source.slice(this.pos);
      // A run of n dollars shows n - 1, and what follows it is text, save
      // a `$NAME$` its last dollar opens, as Chrome's first pass reads
      // `$$NAME$` (#631).
      const run = /^\$+/.exec(rest)![0].length;
      if (run > 1) {
        const named = CHROME_PLACEHOLDER_RE.test(rest.slice(run - 1));
        return this.text(seq, "$".repeat(run - 1), named ? run - 1 : run);
      }
      const match = CHROME_PLACEHOLDER_RE.exec(rest);
      if (match)
        return this.placeholder(seq, match[1]!.toLowerCase(), match[0]);
      // Its second pass fills $1–$9 from the arguments; `$40` is text,
      // which the source is told of.
      const bare = /^\$[1-9](?![0-9])/.exec(rest);
      if (bare) return this.placeholder(seq, bare[0], bare[0]);
    }
    return this.text(seq, ch);
  }

  // printf: braces, angle brackets and `#` are text; `%` opens a verb.
  // android (#596): the verbs, with ICU's plural and tags around them.
  // libfmt and Python's str.format (#1002): a replacement field is its
  // field, `{}` the next position; `{{` and `}}` are braces; any other
  // brace aborts libfmt built without exceptions, as Transmission's is.
  private lexFmt(
    seq: Sequence,
    ch: string,
    inBranch: boolean,
    opensPlural: boolean,
  ): boolean {
    if (ch === "{") {
      if (this.source[this.pos + 1] === "{") return this.text(seq, "{", 2);
      if (opensPlural) return false;
      const field = FMT_FIELD_RE.exec(this.source.slice(this.pos));
      if (!field)
        throw new ParseFailure(
          "a { that opens no fmt field: write {{ for a brace",
          this.pos,
        );
      const indexing =
        field[1] === undefined
          ? "automatic"
          : /^\d+$/.test(field[1])
            ? "manual"
            : undefined;
      if (indexing) {
        if (this.fmtIndexing && this.fmtIndexing !== indexing)
          throw new ParseFailure(
            "fmt cannot mix {} with numbered fields such as {0}: number them all or none",
            this.pos,
          );
        this.fmtIndexing = indexing;
      }
      const name =
        field[1] === undefined
          ? String(this.fmtNext++)
          : `${field[1]}${field[2] ?? ""}`;
      return this.placeholder(seq, name, field[0]);
    }
    if (opensPlural) return false;
    return this.text(seq, ch);
  }

  private lexPrintf(
    seq: Sequence,
    ch: string,
    inBranch: boolean,
    opensPlural: boolean,
    pluralArg: string | undefined,
  ): boolean {
    // A substitution's own value, its argument's verb whatever type the
    // catalogue formats it with.
    const own = argIndexOf(pluralArg ?? "");
    if (
      this.mode === "argPlurals" &&
      own !== undefined &&
      this.source.startsWith("%arg", this.pos)
    ) {
      this.ownFree = false;
      return this.placeholder(seq, own, "%arg");
    }
    const argPlural =
      this.mode === "argPlurals" &&
      !inBranch &&
      ch === "{" &&
      ARG_PLURAL_RE.exec(this.source.slice(this.pos));
    if (argPlural) {
      const node = this.parseArgument(inBranch);
      // Named by its position, as the verb it stands for is.
      this.printfNext = Number(argPlural[1]) + 1;
      this.node(seq, node);
      return true;
    }
    if (ch === "%") {
      if (this.source[this.pos + 1] === "%") return this.text(seq, "%", 2);
      // A Python key is named by itself, never counted by position.
      const key =
        this.syntax === "printf" &&
        PYTHON_KEY_RE.exec(this.source.slice(this.pos));
      if (key) return this.placeholder(seq, key[1]!, key[0]);
      const verb = PRINTF_VERB_RE.exec(this.source.slice(this.pos));
      if (verb) {
        const explicit = verb[1] ?? verb[2];
        // In a substitution's branch the first unindexed verb is its
        // argument, as `%arg` is, and the rest count on after it (#726).
        const substituted =
          this.mode === "argPlurals" &&
          own !== undefined &&
          !explicit &&
          this.ownFree;
        if (substituted) this.ownFree = false;
        const position = explicit
          ? Number(explicit)
          : substituted
            ? Number(own)
            : this.printfNext;
        if (!substituted) this.printfNext = position + 1;
        return this.placeholder(seq, String(position), verb[0]);
      }
    }
    if ((this.syntax === "printf" && !opensPlural) || ch === "%" || ch === "#")
      return this.text(seq, ch);
    return false;
  }

  // {{ name }} or {{name, format}} at the cursor, consumed (i18next).
  // The unescaped form {{- name}} inserts its value raw where {{name}}
  // escapes it, so the dash stays in the name: a translation must keep
  // the form, and a chip writes it back.
  private parseDoubleBrace(): IcuNode {
    const start = this.pos;
    const end = this.source.indexOf("}}", this.pos + 2);
    if (end < 0) throw new ParseFailure("unclosed '{{'", start);
    const inner = this.source.slice(this.pos + 2, end);
    const unescaped = inner.startsWith("-");
    const key = (
      (unescaped ? inner.slice(1) : inner).split(",")[0] ?? ""
    ).trim();
    this.pos = end + 2;
    if (I18NEXT_NAME_RE.test(key))
      return { kind: "placeholder", name: unescaped ? `-${key}` : key };
    // i18next prints a {{…}} it is passed no value for as written, a Go
    // template's `{{ define "<NAME>" }}` (#1008): its content names it, so
    // a translation keeps it, and the chip writes it as the source does.
    // A brace inside is an ICU branch read under the wrong library, which
    // is refused so the refusal can say so.
    // A dash before a name that is not `{{-name}}`'s own, `{{ -name }}`,
    // is a slip that would otherwise meet that name, and is refused.
    const content = inner.trim();
    if (
      key === "" ||
      /[{}]/.test(content) ||
      (key.startsWith("-") && I18NEXT_NAME_RE.test(key.slice(1).trim()))
    )
      throw new ParseFailure(
        `invalid placeholder name ${JSON.stringify(key)}`,
        start,
      );
    return {
      kind: "placeholder",
      name: content,
      written: this.source.slice(start, end + 2),
    };
  }

  private lastClose(name: string): number {
    if (!this.closes) {
      this.closes = new Map();
      for (const m of this.source.matchAll(CLOSE_RE))
        this.closes.set(m[1]!, m.index);
    }
    return this.closes.get(name) ?? -1;
  }

  // vue-i18n's braces: `{name}` names a value, `{'…'}` is a literal
  // whose quoted text is kept as text (#496), which is how a catalogue
  // writes an `@`, a `|` or a brace that the language reads as syntax.
  private parseVueBrace(): IcuNode {
    const start = this.pos;
    const end = closingBrace(this.source, this.pos);
    if (end < 0) throw new ParseFailure("unclosed '{'", start);
    const inner = this.source.slice(this.pos + 1, end).trim();
    const quoted = /^'((?:[^'\\]|\\.)*)'$/.exec(inner);
    this.pos = end + 1;
    // A backslash inside the quotes escapes the next character, as
    // vue-i18n's own compiler reads it.
    if (quoted) {
      return { kind: "literal", text: quoted[1]!.replace(/\\(.)/g, "$1") };
    }
    if (!VUE_NAME_RE.test(inner)) {
      // A one-word name in another script, `{aquí}`, compiles to nothing:
      // vue-i18n shows the whole message raw (#1017).
      throw new ParseFailure(
        `invalid placeholder name ${JSON.stringify(inner)}${/^\S+$/.test(inner) ? `: {${inner}} is not a name vue-i18n compiles (a–z, digits, _, $, -); the whole message shows raw` : ""}`,
        start,
      );
    }
    return { kind: "placeholder", name: inner };
  }

  private prose(): Set<number> {
    if (this.proseTags) return this.proseTags;
    const prose = new Set<number>();
    const open: { name: string; at: number }[] = [];
    // Each name's open tags, as indexes into `open`, so a close finds its
    // own without reading the stack through (#924).
    const byName = new Map<string, number[]>();
    for (
      let at = this.source.indexOf("<");
      at >= 0;
      at = this.source.indexOf("<", at + 1)
    ) {
      const match = TAG_RE.exec(this.source.slice(at));
      if (!match) continue;
      const name = match[2]!;
      // Void elements and self-closed tags open nothing, and a closing
      // tag with attributes is text, as readTag reads it.
      if (isVoidTag(name) || match[4] === "/") continue;
      if (match[1] === "/" && match[3]!.trim() !== "") continue;
      if (match[1] !== "/") {
        const own = byName.get(name);
        if (own) own.push(open.length);
        else byName.set(name, [open.length]);
        open.push({ name, at });
        continue;
      }
      const index = byName.get(name)?.at(-1);
      if (index === undefined) {
        prose.add(at);
        continue;
      }
      // It closes the one at `index`; those opened inside it and never
      // closed are text.
      while (open.length > index) {
        const closed = open.pop()!;
        byName.get(closed.name)!.pop();
        if (open.length > index) prose.add(closed.at);
      }
    }
    for (const unclosed of open) prose.add(unclosed.at);
    this.proseTags = prose;
    return prose;
  }

  // A tag at the cursor, consumed, or nothing when the < is text.
  private readTag():
    | {
        kind: "open" | "close" | "self";
        name: string;
        attrs?: string;
        start: number;
      }
    | undefined {
    const match = TAG_RE.exec(this.source.slice(this.pos));
    if (!match) return undefined;
    const attrs = match[3]!.trim();
    // A closing tag carries no attributes: `</a href>` is text.
    if (match[1] === "/" && attrs !== "") return undefined;
    const start = this.pos;
    this.pos += match[0].length;
    const name = match[2]!;
    const voided = this.html && match[4] !== "/" && isVoidTag(name);
    // counterpart substitutes a bare `<pill>` with no close (#663).
    const bare =
      this.syntax === "counterpart" &&
      match[1] !== "/" &&
      match[4] !== "/" &&
      this.lastClose(name) < this.pos;
    const kind =
      match[1] === "/"
        ? "close"
        : match[4] === "/" || voided || bare
          ? "self"
          : "open";
    // `<br></br>` is one tag here: react-i18next reads it so, and a
    // browser renders the `</br>` as a second break, which is still no
    // unclosed tag.
    const close = `</${name}>`;
    if (
      voided &&
      this.source.slice(this.pos, this.pos + close.length).toLowerCase() ===
        close.toLowerCase()
    )
      this.pos += close.length;
    return { kind, name, ...(attrs ? { attrs } : {}), start };
  }

  // A tag's attribute text, and the placeholders written in it where the
  // library names or numbers its placeholders: a positional one (printf's
  // `%s`, easy_localization's `{}`) in an attribute would move every
  // position after it (#948).
  private tagAttrs(
    attrs: string | undefined,
    start: number,
  ): {
    attrs?: string;
    attrPlaceholders?: IcuNode[];
  } {
    if (!attrs) return {};
    if (!ATTR_PLACEHOLDER_LIBRARIES.has(this.syntax)) return { attrs };
    let nodes: IcuNode[];
    const parser = new Parser(attrs, this.syntax, false);
    // Android's verbs count on through the attribute.
    parser.printfNext = this.printfNext;
    try {
      nodes = parser.parseSequence(false);
      this.printfNext = parser.printfNext;
    } catch (error) {
      // Brace CSS in an ICU attribute is text; Rails reads only `%{`, so
      // a mistyped one there is refused as it is in the text.
      if (!(error instanceof ParseFailure)) throw error;
      if (this.syntax === "rails") throw new ParseFailure(error.message, start);
      return { attrs };
    }
    const placeholders = nodes.filter((node) => node.kind === "placeholder");
    return placeholders.length > 0
      ? { attrs, attrPlaceholders: placeholders }
      : { attrs };
  }

  // A tag read as prose: its text, and the placeholders its attributes
  // write, which the runtime fills whether the tag closes or not.
  private proseTag(
    seq: Sequence,
    raw: string,
    tag: { kind: string; name: string; attrs?: string },
    start: number,
  ): void {
    this.proseOut?.push({
      name: tag.name,
      close: tag.kind === "close",
      ...(tag.attrs && { attrs: tag.attrs }),
      at: start,
      branch: [...this.branchPath],
    });
    // Where a tag's attributes hold no placeholders of their own, or
    // Android's verbs, a prose tag is text through and through: Android's
    // `<Unknown %s>` prints its verb, which counts by position with the
    // rest (#987).
    if (
      !ATTR_PLACEHOLDER_LIBRARIES.has(this.syntax) ||
      this.syntax === "android"
    ) {
      seq.literal += "<";
      this.pos = start + 1;
      return;
    }
    seq.literal += raw;
    seq.attrPlaceholders.push(
      ...(this.tagAttrs(tag.attrs, start).attrPlaceholders ?? []),
    );
  }

  // Where the argument at `at` ends.
  argumentEnd(at: number): number {
    this.pos = at;
    this.parseArgument(false);
    return this.pos;
  }

  private parseArgument(inBranch: boolean): IcuNode {
    const start = this.pos;
    this.pos += 1;
    const body = this.readUntil(["}", ","]);
    const next = this.source[this.pos];
    if (next === undefined) {
      throw new ParseFailure("unclosed '{'", start);
    }

    const name = body.trim();
    const checkName = (what: string) => {
      const re =
        this.syntax !== "fluent"
          ? NAME_RE
          : what === "placeholder"
            ? FLUENT_NAME_RE
            : what === "select argument"
              ? FLUENT_SELECTOR_RE
              : FLUENT_VARIABLE_RE;
      if (!re.test(name))
        throw new ParseFailure(
          `invalid ${what} name ${JSON.stringify(name)}`,
          start,
        );
    };
    if (next === "}") {
      checkName("placeholder");
      this.pos += 1;
      return { kind: "placeholder", name };
    }

    // '{arg, type, ...}'
    this.pos += 1;
    const type = this.readUntil([",", "}"]).trim();
    if (type === "number" || type === "date" || type === "time") {
      checkName("format argument");
      let style: string | undefined;
      if (this.source[this.pos] === ",") {
        this.pos += 1;
        style = this.readUntil(["}"]).trim();
        if (style === "") {
          throw new ParseFailure(`${type} has an empty style`, start);
        }
      }
      if (this.source[this.pos] !== "}") {
        throw new ParseFailure(`unclosed ${type}`, start);
      }
      // Flutter's gen-l10n formats a date or a time by an ICU skeleton
      // and nothing else (#1038).
      if (
        this.syntax === "gen_l10n" &&
        (type === "number" || !style?.startsWith("::"))
      )
        throw new ParseFailure(
          `gen-l10n formats only date and time, with a ::skeleton such as {d, date, ::yMd}; write {${name}} and format it in the code`,
          start,
        );
      // Its skeleton is one of intl's DateFormat constructors; only an
      // `@key` placeholder's format joins several by +, never the text.
      if (
        this.syntax === "gen_l10n" &&
        !GEN_L10N_DATE_FORMATS.has(style!.slice(2).trim())
      )
        throw new ParseFailure(
          `gen-l10n has no DateFormat for ${JSON.stringify(style)}: a skeleton is one of intl's named formats, yMd, yMMMd, jm and the like`,
          start,
        );
      // Fluent formats through NUMBER() and DATETIME(), whose options a
      // style is; DATETIME formats a date, so there is no time (#990).
      if (this.syntax === "fluent" && type === "time")
        throw new ParseFailure(
          "a Fluent text has no time format: DATETIME formats a date",
          start,
        );
      if (
        this.syntax === "fluent" &&
        style !== undefined &&
        !FLUENT_OPTIONS_RE.test(style)
      )
        throw new ParseFailure(
          `a Fluent ${type}'s style is its options, name: "value" or name: number`,
          start,
        );
      this.pos += 1;
      return {
        kind: "placeholder",
        name,
        format: style === undefined ? { type } : { type, style },
      };
    }
    if (type !== "select" && type !== "plural" && type !== "selectordinal") {
      throw new ParseFailure(
        `argument type ${JSON.stringify(type)} is not supported; only select, plural, selectordinal, number, date and time are`,
        start,
      );
    }
    if (type === "selectordinal" && this.syntax === "gen_l10n")
      throw new ParseFailure(
        "gen-l10n has no selectordinal: its plurals are cardinal",
        start,
      );
    // Fluent counts an ordinal with NUMBER's option, in a select.
    if (type === "selectordinal" && this.syntax === "fluent")
      throw new ParseFailure(
        `a Fluent text writes an ordinal as { NUMBER($${name}, type: "ordinal") -> … }, which Corpus does not read yet`,
        start,
      );
    // selectordinal is a plural by the ordinal rules, nesting as one.
    const kind = type === "select" ? "select" : "plural";
    if (inBranch) this.checkNesting(kind, start);
    checkName(`${kind} argument`);
    if (this.source[this.pos] !== ",") {
      throw new ParseFailure(`${type} needs branches`, start);
    }
    this.pos += 1;
    const node = this.parseBranches(kind, name, start, type);
    return type === "selectordinal" && node.kind === "plural"
      ? { ...node, ordinal: true }
      : node;
  }

  // One level of nesting, a plural in a select's branch or a select in
  // a plural's (#674), and under Fluent, whose selects nest freely, a
  // plural in a plural's or a select in a select's (#990); a printf
  // plural's braces are the plural's own, and an Android item is a
  // string with no select.
  private checkNesting(type: "select" | "plural", start: number): void {
    const outer = this.within.at(-1);
    if (
      this.mode !== "text" ||
      this.syntax === "android" ||
      outer === undefined
    )
      throw new ParseFailure(`${type}s cannot nest`, start);
    if (outer === type && this.syntax !== "fluent")
      throw new ParseFailure(
        `a ${type} cannot nest in a ${type}'s branch`,
        start,
      );
    if (this.within.length > 1)
      throw new ParseFailure(
        `select and plural nest one level deep: this ${type} is inside ${[
          ...this.within,
        ]
          .reverse()
          .map((kind) => `a ${kind}`)
          .join(" inside ")}`,
        start,
      );
  }

  private parseBranches(
    type: "select" | "plural",
    name: string,
    start: number,
    // The argument type as written, for the messages: selectordinal's.
    label: string = type,
  ): IcuNode {
    // A branch key is data: `__proto__` is a key like any other (#846).
    const branches = Object.create(null) as Record<string, IcuNode[]>;
    const own = this.mode === "argPlurals" ? argIndexOf(name) : undefined;
    for (;;) {
      this.skipWhitespace();
      const ch = this.source[this.pos];
      if (ch === undefined) {
        throw new ParseFailure(`unclosed ${label}`, start);
      }
      if (ch === "}") {
        this.pos += 1;
        if (Object.keys(branches).length === 0) {
          throw new ParseFailure(`${label} needs at least one branch`, start);
        }
        if (type === "plural" && !("other" in branches)) {
          throw new ParseFailure(`${label} needs an other branch`, start);
        }
        return { kind: type, arg: name, branches };
      }
      const key = this.readUntil(["{", "}"]).trim();
      if (this.source[this.pos] !== "{") {
        throw new ParseFailure(`${label} needs branches`, start);
      }
      if (this.syntax === "gen_l10n" && type === "plural") {
        if (key.startsWith("offset:"))
          throw new ParseFailure("gen-l10n has no offset", this.pos);
        if (!GEN_L10N_PLURAL_KEYS.has(key))
          throw new ParseFailure(
            `invalid plural branch key ${JSON.stringify(key)}: gen-l10n's plural keys are =0, =1, =2, zero, one, two, few, many and other`,
            this.pos,
          );
      }
      if (!(type === "plural" ? PLURAL_KEY_RE : KEY_RE).test(key)) {
        throw new ParseFailure(
          type === "plural"
            ? `invalid ${label} branch key ${JSON.stringify(key)}: a category (${PLURAL_CATEGORIES.join(", ")}) or =N`
            : `invalid branch key ${JSON.stringify(key)}`,
          this.pos,
        );
      }
      this.pos += 1;
      // Each Android plural item is a string of its own: its verbs count
      // from 1.
      if (this.syntax === "android" || this.mode === "wholePlural") {
        this.printfNext = 1;
        // Each gettext form is a format string of its own (#1002).
        this.fmtNext = 0;
        this.fmtIndexing = undefined;
      }
      if (own !== undefined) {
        this.printfNext = Number(own) + 1;
        this.ownFree = true;
      }
      this.within.push(type);
      this.branchPath.push(`${name}:${key}`);
      try {
        branches[key] = this.parseSequence(
          true,
          type === "plural" ? name : undefined,
        );
      } finally {
        this.within.pop();
        this.branchPath.pop();
      }
      this.pos += 1;
    }
  }

  private readUntil(stops: string[]): string {
    const from = this.pos;
    while (
      this.pos < this.source.length &&
      !stops.includes(this.source[this.pos] as string)
    ) {
      this.pos += 1;
    }
    return this.source.slice(from, this.pos);
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.pos] ?? "")) this.pos += 1;
  }
}

// A text read for what it holds (its slots, its tags, a preview), not
// for whether it is valid: the reading parseIcu gives, or, where that
// fails, a type read as HTML's, whose unclosed tags are text (#755).
// Validation, which knows the type, is what refuses a text.
export function readIcu(
  source: string,
  syntax: Library = "icu",
  placeholders?: readonly Library[],
): IcuParseResult {
  const read = parseIcu(source, syntax, { placeholders });
  if (read.ok) return read;
  const markup = parseIcu(source, syntax, { html: "markup", placeholders });
  return markup.ok ? markup : read;
}

// `html` reads `<br>`, `<hr>`, `<wbr>` and `<img>` as void elements
// (#643): without it, where a component renders each tag, `<br></br>` is
// a pair like any other and a lone `<br>` is unclosed. Validation passes
// it for the text in hand; reading a source for its parts leaves it
// unset, which takes whatever either reading takes.
export function parseIcu(
  source: string,
  syntax: Library = "icu",
  // `prose`, where the tags read as text go (#986); `placeholders`, the
  // syntaxes the source layers on the library (#1049).
  options: {
    html?: boolean | "markup";
    prose?: ProseTag[];
    placeholders?: readonly Library[];
  } = {},
): IcuParseResult {
  const layers = options.placeholders ?? [];
  if (options.html === undefined) {
    const lenient = parseWith(source, syntax, true, undefined, layers);
    if (lenient.ok) return lenient;
    const strict = parseWith(source, syntax, false, undefined, layers);
    return strict.ok ? strict : lenient;
  }
  return parseWith(source, syntax, options.html, options.prose, layers);
}

// The layered placeholder syntaxes of the parse in progress (#1049): a
// parse is synchronous, and every Parser it makes reads them.
let layering: readonly Library[] = [];

function parseWith(
  source: string,
  syntax: Library,
  html: boolean | "markup",
  prose?: ProseTag[],
  layers: readonly Library[] = [],
): IcuParseResult {
  return withLayers(layers, () => parseLayered(source, syntax, html, prose));
}

function withLayers<T>(layers: readonly Library[], read: () => T): T {
  const outer = layering;
  layering = layers;
  try {
    return read();
  } finally {
    layering = outer;
  }
}

function parseLayered(
  source: string,
  syntax: Library,
  html: boolean | "markup",
  prose?: ProseTag[],
): IcuParseResult {
  try {
    if (syntax === "vue") {
      const parts = splitVueSource(source);
      // vue-i18n trims each form, so the space around a separator is
      // not part of the text.
      if (parts.length > 1) {
        const empty = parts.findIndex((part) => part.trim() === "");
        if (empty >= 0) {
          throw new ParseFailure(
            "a plural form is empty; every form between two | must have text",
            parts.slice(0, empty).join("|").length,
          );
        }
        // A form of nothing but punctuation is not a plural form but a
        // pipe the catalogue meant literally: "Pipe (|)" is a label for
        // the character, and vue-i18n would render "Pipe (" (#539). A
        // form is kept when it holds a word, a number, a symbol (an
        // emoji plural, "⭐ | ⭐⭐", is a form) or a brace.
        const wordless = parts.findIndex(
          (part) => !/[\p{L}\p{N}\p{S}{]/u.test(part),
        );
        if (wordless >= 0) {
          const form = parts[wordless]!;
          throw new ParseFailure(
            `a plural form has no words: ${JSON.stringify(form.trim())}; a pipe meant literally is written {'|'}`,
            parts.slice(0, wordless).join("|").length +
              (wordless > 0 ? 1 : 0) +
              form.indexOf(form.trim()),
          );
        }
      }
      const branches = parts.map((part) =>
        new Parser(part.trim(), syntax, html).parseSequence(false),
      );
      return {
        ok: true,
        nodes:
          branches.length === 1 ? branches[0]! : [{ kind: "forms", branches }],
      };
    }
    const substituted = argPlurals(source, html, syntax);
    if (substituted) return { ok: true, nodes: substituted };
    if (WHOLE_PLURAL_LIBRARIES.has(syntax) && PRINTF_PLURAL_RE.test(source)) {
      // Where it does not parse as one plural it is text as before (#652).
      const read: ProseTag[] = [];
      const plural = readPrintfPlural(source, html, syntax, read);
      if ("nodes" in plural) {
        prose?.push(...read);
        return { ok: true, nodes: plural.nodes };
      }
    }
    const read: ProseTag[] = [];
    const nodes = new Parser(source, syntax, html, "text", read).parseSequence(
      false,
    );
    prose?.push(...read);
    return { ok: true, nodes };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return {
        ok: false,
        errors: [{ message: error.message, position: error.position }],
      };
    }
    throw error;
  }
}

// The `}` that closes a vue brace, skipping one inside the quotes of a
// `{'…'}` literal: `{'}'}` is a literal closing brace.
function closingBrace(source: string, at: number): number {
  let quoted = false;
  for (let i = at + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\" && quoted) {
      i += 1;
      continue;
    }
    if (ch === "'") quoted = !quoted;
    else if (ch === "}" && !quoted) return i;
  }
  return -1;
}

// `closingBrace` for every position at once, in one pass from the end
// (#896): the brace that closes a `{` at i is the entry at i + 1, and a
// text of unclosed braces is linear, not quadratic. Each position has
// two answers, outside quotes and in them.
function braceClosers(source: string): Int32Array {
  const n = source.length;
  const plain = new Int32Array(n + 2).fill(-1);
  const quoted = new Int32Array(n + 2).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch === "'") {
      const outside = quoted[i + 1]!;
      quoted[i] = plain[i + 1]!;
      plain[i] = outside;
    } else if (ch === "}") {
      plain[i] = i;
      quoted[i] = quoted[i + 1]!;
    } else {
      plain[i] = plain[i + 1]!;
      quoted[i] = ch === "\\" ? quoted[i + 2]! : quoted[i + 1]!;
    }
  }
  return plain;
}

// vue-i18n separates plural forms with a top-level `|`. The source is
// split before it is parsed, so a pipe inside a `{'…'}` literal is
// text: that escape is exactly how a catalogue writes one (#496).
function splitVueSource(source: string): string[] {
  const closer = braceClosers(source);
  const parts: string[] = [];
  let current = "";
  let at = 0;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "{") {
      const end = closer[at + 1]!;
      if (end >= 0) {
        current += source.slice(at, end + 1);
        at = end + 1;
        continue;
      }
    }
    if (ch === "|") {
      parts.push(current);
      current = "";
      at += 1;
      continue;
    }
    current += ch;
    at += 1;
  }
  parts.push(current);
  return parts;
}

// The select and plural nodes of a tree in source order, through tags,
// which may wrap them, and, `deep`, branches, which may hold one (#764).
export function branchingNodes(
  nodes: IcuNode[],
  deep = true,
): Extract<IcuNode, { kind: "select" | "plural" }>[] {
  const out: Extract<IcuNode, { kind: "select" | "plural" }>[] = [];
  for (const node of nodes) {
    if (node.kind === "select" || node.kind === "plural") {
      out.push(node);
      if (deep)
        for (const branch of Object.values(node.branches))
          out.push(...branchingNodes(branch));
    } else if (node.kind === "tag")
      out.push(...branchingNodes(node.children, deep));
    else if (node.kind === "forms")
      for (const branch of node.branches)
        out.push(...branchingNodes(branch, deep));
  }
  return out;
}

// A format as the source writes it after the name: "number, ::percent".
export function placeholderFormatText(format: PlaceholderFormat): string {
  return format.style === undefined
    ? format.type
    : `${format.type}, ${format.style}`;
}

export type Shape = {
  placeholders: Set<string>;
  formats: Map<string, PlaceholderFormat>;
  selects: Map<string, Set<string>>;
  plurals: Map<string, Set<string>>;
  // The same keys by kind: a cardinal plural's and a selectordinal's,
  // one argument holding both apart (#995).
  cardinalPlurals: Map<string, Set<string>>;
  ordinalPlurals: Map<string, Set<string>>;
  tags: Set<string>;
  // The tags that wrap text, a pair and not closed on itself, and those
  // written as a pair, whatever they hold (#986).
  pairs: Set<string>;
  opened: Set<string>;
  // The placeholders written in tags' attributes, each as written where
  // the library writes it (#948).
  attrPlaceholders: Map<string, string | undefined>;
  // The tag each of them is written in, the first (#1022).
  attrTags: Map<string, string>;
  // Each tag's identities with its attribute verbs written by position,
  // which is how two tags compare, where they differ from it (#956).
  tagKeys: Map<string, Set<string>>;
  // The same of the occurrences that wrap text, every pair's.
  pairKeys: Map<string, Set<string>>;
  // Those written in the attributes of tags read as text (#986).
  proseAttrPlaceholders: Map<string, string | undefined>;
  // printf: each verb as written, by position (#594).
  written: Map<string, string>;
  // Every verb as written, a position repeated in each plural branch
  // included (#596).
  verbs: [string, string][];
  // How many placeholders the text writes, positions repeated included:
  // fewer than the source's is what a dropped verb looks like (#614).
  count: number;
};

export function shapeOf(
  nodes: IcuNode[],
  shape: Shape = {
    placeholders: new Set(),
    formats: new Map(),
    selects: new Map(),
    plurals: new Map(),
    cardinalPlurals: new Map(),
    ordinalPlurals: new Map(),
    tags: new Set(),
    pairs: new Set(),
    opened: new Set(),
    attrPlaceholders: new Map(),
    attrTags: new Map(),
    tagKeys: new Map(),
    pairKeys: new Map(),
    proseAttrPlaceholders: new Map(),
    written: new Map(),
    verbs: [],
    count: 0,
  },
): Shape {
  for (const node of nodes) {
    if (node.kind === "placeholder") {
      shape.placeholders.add(node.name);
      shape.count += 1;
      if (node.written) {
        if (!shape.written.has(node.name))
          shape.written.set(node.name, node.written);
        shape.verbs.push([node.name, node.written]);
      }
      if (node.format && !shape.formats.has(node.name)) {
        shape.formats.set(node.name, node.format);
      }
    }
    if (node.kind === "tag" || node.kind === "literal")
      for (const attr of node.attrPlaceholders ?? [])
        if (
          attr.kind === "placeholder" &&
          !shape.attrPlaceholders.has(attr.name)
        )
          shape.attrPlaceholders.set(attr.name, attr.written);
    if (node.kind === "literal")
      for (const attr of node.attrPlaceholders ?? [])
        if (
          attr.kind === "placeholder" &&
          !shape.proseAttrPlaceholders.has(attr.name)
        )
          shape.proseAttrPlaceholders.set(attr.name, attr.written);
    if (node.kind === "tag") {
      for (const attr of node.attrPlaceholders ?? [])
        if (attr.kind === "placeholder" && !shape.attrTags.has(attr.name))
          shape.attrTags.set(attr.name, tagIdentity(node));
      shape.tags.add(tagIdentity(node));
      const key = positionedIdentity(node);
      if (key !== tagIdentity(node)) {
        const keys = shape.tagKeys.get(tagIdentity(node)) ?? new Set();
        shape.tagKeys.set(tagIdentity(node), keys.add(key));
      }
      if (!node.self) shape.opened.add(tagIdentity(node));
      if (!node.self && node.children.length > 0) {
        shape.pairs.add(tagIdentity(node));
        const keys = shape.pairKeys.get(tagIdentity(node)) ?? new Set();
        shape.pairKeys.set(tagIdentity(node), keys.add(key));
      }
      shapeOf(node.children, shape);
    }
    // A form's placeholders are the message's; how many forms there are
    // is the project's rule to decide, not Corpus's (#495).
    if (node.kind === "forms") {
      for (const branch of node.branches) shapeOf(branch, shape);
    }
    if (node.kind === "select" || node.kind === "plural") {
      const map = node.kind === "select" ? shape.selects : shape.plurals;
      if (node.kind === "plural") {
        const byKind = node.ordinal
          ? shape.ordinalPlurals
          : shape.cardinalPlurals;
        const own = byKind.get(node.arg) ?? new Set<string>();
        for (const key of Object.keys(node.branches)) own.add(key);
        byKind.set(node.arg, own);
      }
      const keys = map.get(node.arg) ?? new Set<string>();
      for (const key of Object.keys(node.branches)) keys.add(key);
      map.set(node.arg, keys);
      for (const branch of Object.values(node.branches)) shapeOf(branch, shape);
    }
  }
  return shape;
}

// What a source's text holds, read once: its placeholders, each one's
// format as the source wrote it (`number, ::percent`, for a chip, #555)
// and its verb as written (printf's `%[2]s`, `%arg` only where no other
// verb takes the position, #726), the arguments it selects and
// pluralises on, its tags, and its vue-i18n pipe forms (#660), `no posts
// | one post | {n} posts` being 3. A text that does not parse holds
// nothing.
export type Parts = {
  placeholders: Set<string>;
  formats: Map<string, string>;
  written: Map<string, string>;
  selects: Set<string>;
  plurals: Set<string>;
  tags: Set<string>;
  // The tags the text writes closed on themselves, `<0/>`, as a chip
  // inserts them (#986).
  selfClosed: Set<string>;
  // The placeholders a tag's attributes hold, by name, which a type read
  // as HTML still requires (#948, #1030); and those of a tag read as
  // prose, which `tags` does not carry.
  attributePlaceholders: Set<string>;
  proseAttributePlaceholders: Set<string>;
  forms: number;
};

export function partsOf(
  source: string,
  syntax: Library = "icu",
  placeholders?: readonly Library[],
): Parts {
  const result = readIcu(source, syntax, placeholders);
  const nodes = result.ok ? result.nodes : [];
  const shape = shapeOf(nodes);
  const written = new Map<string, string>();
  for (const [name, verb] of shape.verbs)
    if (!written.has(name) || written.get(name) === "%arg")
      written.set(name, verb);
  const only = nodes.length === 1 ? nodes[0] : undefined;
  return {
    placeholders: shape.placeholders,
    formats: new Map(
      [...shape.formats].map(([name, format]) => [
        name,
        placeholderFormatText(format),
      ]),
    ),
    written,
    selects: new Set(shape.selects.keys()),
    plurals: new Set(shape.plurals.keys()),
    tags: shape.tags,
    selfClosed: new Set(
      [...shape.tags].filter((tag) => !shape.opened.has(tag)),
    ),
    attributePlaceholders: new Set(shape.attrPlaceholders.keys()),
    proseAttributePlaceholders: new Set(shape.proseAttrPlaceholders.keys()),
    forms: only?.kind === "forms" ? only.branches.length : 0,
  };
}

// Whether the runtime has plural data for a tag: a well-formed tag it
// lacks (`tlh`, `qaa`) would otherwise resolve to the default locale.
function known(language: string): boolean {
  try {
    return Intl.PluralRules.supportedLocalesOf([localeOf(language)]).length > 0;
  } catch {
    return false;
  }
}

// The plural categories a language uses, by the runtime's CLDR data, in
// CLDR order whatever order the runtime lists them; none for a tag the
// runtime does not know, so nothing is enforced.
// Asked once per language: building the rules costs more than the rest
// of a validation, which a push runs for every seed (#646).
const categoriesByLanguage = new Map<string, string[]>();

export function pluralCategoriesOf(
  language: string,
  ordinal = false,
): string[] {
  const id = ordinal ? `${language} ordinal` : language;
  const cached = categoriesByLanguage.get(id);
  if (cached) return [...cached];
  let categories: string[] = [];
  if (known(language)) {
    const has = new Set(
      new Intl.PluralRules(localeOf(language), {
        type: ordinal ? "ordinal" : "cardinal",
      }).resolvedOptions().pluralCategories,
    );
    categories = PLURAL_CATEGORIES.filter((category) => has.has(category));
  }
  categoriesByLanguage.set(id, categories);
  return [...categories];
}

// The categories an integer below a million reaches (#997): what a
// count picks, where CLDR's `many` for exact millions (French, Spanish,
// Italian, Portuguese, Catalan) or for decimals (Czech, Slovak) is one
// a runtime's older data lacks, and `other` serves those numbers right.
const integerCategoriesByLanguage = new Map<string, string[]>();

function integerCategoriesOf(language: string): string[] {
  const cached = integerCategoriesByLanguage.get(language);
  if (cached) return [...cached];
  const cldr = pluralCategoriesOf(language);
  let found: string[] = [];
  if (cldr.length > 0) {
    const rules = new Intl.PluralRules(localeOf(language));
    const reached = new Set<string>(["other"]);
    for (let n = 0; n <= 1000; n++) reached.add(rules.select(n));
    for (const n of [10_000, 100_000, 999_999]) reached.add(rules.select(n));
    found = cldr.filter((c) => reached.has(c));
  }
  integerCategoriesByLanguage.set(language, found);
  return [...found];
}

// The categories CLDR has removed that runtimes still ship (#997):
// Hebrew `many`, gone in CLDR 42 and picked by Android 6 to 13.
const REMOVED_CATEGORIES: Record<string, readonly string[]> = {
  he: ["many"],
};

function removedCategoriesOf(language: string): readonly string[] {
  try {
    return (
      REMOVED_CATEGORIES[new Intl.Locale(localeOf(language)).language] ?? []
    );
  } catch {
    return [];
  }
}

import {
  easyLocalizationCategories,
  easyLocalizationCategory,
} from "./easy-plural";

// The categories a translation's plural must hold, and those it may,
// by the rule its library picks a form by (#951): counterpart's is
// English's in every language, `zero` when written; easy_localization's,
// by default, the value itself, 0, 1 and 2 reading `zero`, `one` and
// `two` where written and anything else `other`, so `few` and `many`
// are never read. Every other library picks by CLDR's rule, or by
// `picked`, the source's own: a gettext file's `Plural-Forms`, the
// categories it reads a form for, and `other`, a form for any other
// being one the file cannot hold (#973); rails-i18n's rule for a Rails
// catalogue's locale (#983), beside `zero`. pluralBranch picks by the
// same rules, so a preview shows the form the runtime does (#963).
export function pluralCategoriesFor(
  language: string,
  library: Library,
  picked?: readonly string[],
  // A selectordinal's: CLDR's ordinal rule, whatever the library (#995).
  ordinal = false,
  // The source's named rule: "cldr", easy_localization picking by CLDR
  // where `ignorePluralRules: false` (#961).
  rules?: "default" | "cldr",
): { required: string[]; allowed: string[] } {
  if (ordinal) {
    const ordinals = pluralCategoriesOf(language, true);
    return { required: ordinals, allowed: ordinals };
  }
  if (library === "counterpart")
    return { required: ["one", "other"], allowed: ["zero", "one", "other"] };
  const cldr = pluralCategoriesOf(language);
  // Ruby's I18n and I18n.js pick `zero` for 0 wherever a plural writes
  // it, in every language (#983), and so does i18next (#985).
  const zero = (c: string) =>
    (library === "rails" || library === "i18next") && c === "zero";
  if (picked && cldr.length > 0)
    return {
      required: [...picked],
      allowed: PLURAL_CATEGORIES.filter(
        (c) => picked.includes(c) || c === "other" || zero(c),
      ),
    };
  // With `ignorePluralRules: false`, intl's table where it has the
  // language, by value where it does not (#961).
  const table =
    library === "easy_localization" && rules === "cldr"
      ? easyLocalizationCategories(language)
      : undefined;
  if (table) return table;
  if (library === "easy_localization" && cldr.length > 0)
    return {
      required: cldr.filter((c) => c !== "few" && c !== "many"),
      allowed: ["zero", "one", "two", "other"],
    };
  // CLDR's, as tolerant as the runtimes that ship older data (#997).
  const removed = removedCategoriesOf(language);
  return {
    required: integerCategoriesOf(language),
    allowed: PLURAL_CATEGORIES.filter(
      (c) =>
        cldr.includes(c) || zero(c) || (cldr.length > 0 && removed.includes(c)),
    ),
  };
}

// The values a category is tried on: integers to a thousand, millions
// (Spanish and French `many`), and fractions (French `one` holds 1.5).
const SAMPLES = [
  ...Array.from({ length: 1001 }, (_, i) => i),
  1e6,
  2e6,
  0.1,
  0.5,
  1.1,
  1.5,
  2.5,
];
const samplesByLanguage = new Map<string, Map<string, number[]>>();

// The whole numbers to a thousand a language puts in a cardinal
// category, in order (#1039).
export function integersOf(language: string, category: string): number[] {
  if (!known(language)) return [];
  const rules = new Intl.PluralRules(localeOf(language));
  const out: number[] = [];
  for (let n = 0; n <= 1000; n++) if (rules.select(n) === category) out.push(n);
  return out;
}

// Whether a plural's `=N` branches reach every value the language puts
// in a category, so the category's own branch would never be taken
// (#650): `=1` is German's `one`, not French's, which holds 0 and 1.5,
// nor Russian's, which holds 21. Only a category bounded within the
// samples can be covered: Spanish `many` holds every million, Slovenian
// `one` 101 and 1001, and no finite list of `=N` names them all.
export function pluralCategoryCovered(
  language: string,
  category: string,
  exact: ReadonlySet<number>,
  ordinal = false,
): boolean {
  if (exact.size === 0 || !known(language)) return false;
  const id = ordinal ? `${language} ordinal` : language;
  let samples = samplesByLanguage.get(id);
  if (!samples) {
    const rules = new Intl.PluralRules(localeOf(language), {
      type: ordinal ? "ordinal" : "cardinal",
    });
    samples = new Map();
    for (const n of SAMPLES) {
      const key = rules.select(n);
      const values = samples.get(key);
      if (values) values.push(n);
      else samples.set(key, [n]);
    }
    samplesByLanguage.set(id, samples);
  }
  const values = samples.get(category);
  return values !== undefined && values.every((n) => n <= 100 && exact.has(n));
}

// The branch a plural takes for a value (§7): an exact `=N` first, then
// the category the library's runtime picks (#963), then `other`, by the
// rules pluralCategoriesFor checks: counterpart and easy_localization
// read no `=N` (#964) and pick by their own rules; Rails and i18next
// take `zero` for 0 where it is written; the rest CLDR's category, or
// `other` where `picked`, the source's own forms (a gettext file's
// `Plural-Forms`, rails-i18n's table), has none for it.
export function pluralBranch(
  branches: Record<string, unknown>,
  value: string,
  language?: string,
  {
    ordinal = false,
    library,
    picked,
    rules,
  }: {
    ordinal?: boolean;
    library?: Library;
    picked?: readonly string[];
    rules?: "default" | "cldr";
  } = {},
): string {
  // An empty value is no count at all, not zero (#859).
  if (value.trim() === "") return "other";
  // easy_localization with `ignorePluralRules: false` picks by intl's
  // table, a written zero no more than any other, and by value where the
  // table has no rule for the language (#961).
  const table =
    library === "easy_localization" && rules === "cldr" && language
      ? (n: number) => easyLocalizationCategory(language, n)
      : undefined;
  const own = library === "counterpart" || library === "easy_localization";
  const exact = `=${value.trim()}`;
  if (!own && Object.hasOwn(branches, exact)) return exact;
  const n = Number(value);
  const written = (category: string | undefined) =>
    category !== undefined && Object.hasOwn(branches, category)
      ? category
      : "other";
  if (Number.isFinite(n) && !ordinal) {
    if (library === "counterpart")
      return written(n === 0 ? "zero" : n === 1 ? "one" : undefined);
    if (library === "easy_localization") {
      const category = table?.(n);
      return written(category ?? ["zero", "one", "two"][n]);
    }
    if (
      (library === "rails" || library === "i18next") &&
      n === 0 &&
      Object.hasOwn(branches, "zero")
    )
      return "zero";
  }
  if (Number.isFinite(n) && (language === undefined || known(language))) {
    const category = new Intl.PluralRules(
      language === undefined ? undefined : localeOf(language),
      { type: ordinal ? "ordinal" : "cardinal" },
    ).select(n);
    if (!ordinal && picked && !picked.includes(category)) return "other";
    if (Object.hasOwn(branches, category)) return category;
    // gen-l10n's `=0`, `=1`, `=2` are its zero, one and two (#1039).
    const exactOf = (
      { zero: "=0", one: "=1", two: "=2" } as Record<string, string | undefined>
    )[category];
    if (
      library === "gen_l10n" &&
      !ordinal &&
      exactOf !== undefined &&
      Object.hasOwn(branches, exactOf)
    )
      return exactOf;
  }
  return "other";
}

// What to do about a refusal, where the text alone does not say it
// (#486, #505): the clause the CLI and the server both append to a
// parse error, so every client reads the same advice. A catalogue in
// the wrong library is refused string by string, and prose that spells
// a tag (`https://example.com/<baseurl>`) reads as one. The tag shapes
// are tested first: `{{` is i18next's interpolation but also an ICU
// branch that opens with a placeholder (`{n, plural, other {{count}
// apples}}`), and that catalogue is not in the wrong library.
const ICU_ARGUMENT_TYPES = new Set([
  "number",
  "date",
  "time",
  "selectordinal",
  "spellout",
  "ordinal",
  "duration",
  "choice",
]);

export type RefusalCause = "tag" | "library";

function refusal(
  source: string,
  library: Library,
  message: string,
): { cause: RefusalCause; advice: string } | undefined {
  const unclosed = /^unclosed <([^>]+)>$/.exec(message);
  if (unclosed) {
    // `</br>` would render a second break in HTML; `<br/>` closes itself
    // for a component and for HTML alike (#643).
    return {
      cause: "tag",
      advice: isVoidTag(unclosed[1]!)
        ? `; write <${unclosed[1]}/>, which closes itself, or declare the string's type richText: "html" if the app renders it as HTML`
        : `; a <name> is a rich-text tag: close it with </${unclosed[1]}>, or write the brackets so they do not open a tag`,
    };
  }
  const mismatched = /^unexpected <\/([^>]+)>; <([^>]+)> is open$/.exec(
    message,
  );
  if (mismatched) {
    return {
      cause: "tag",
      advice: `; a <name> is a rich-text tag: <${mismatched[2]}> is open here, so write </${mismatched[2]}>, or remove both tags`,
    };
  }
  const stray = /^unexpected <\/([^>]+)>$/.exec(message);
  if (stray) {
    return {
      cause: "tag",
      advice: `; a <name> is a rich-text tag: remove it, or open a matching <${stray[1]}>`,
    };
  }
  // The library hints fire on the error the wrong library produces and
  // on nothing else (#557): a placeholder name that starts with `{` is
  // `{{name}}` read as ICU, an argument type ICU lacks is `{{date,
  // short}}` read as ICU, and a name holding an ICU argument is `{n,
  // plural, …}` read under a library without arguments. An unclosed or
  // nested plural, or a type ICU has (`{n, number}`, #555), is ICU
  // whatever else the string holds, though a branch that opens with a
  // placeholder puts `{{` in it.
  const badName = /^invalid placeholder name "((?:[^"\\]|\\.)*)"(?::|$)/.exec(
    message,
  );
  // `{}` is easy_localization's positional placeholder (#664).
  if (library !== "easy_localization" && badName && badName[1] === "") {
    return {
      cause: "library",
      advice: `; {} is easy_localization's positional placeholder: declare library: "easy_localization" on the source`,
    };
  }
  // `{'@'}` is vue-i18n's literal interpolation (#1046), spaced or
  // escaped as vue reads it, in a text vue reads whole: not ICU's
  // apostrophe quoting of a brace (`'{'0'}'`), not a Fluent text, whose
  // literal is `{"@"}`.
  // The literal refused, where it is one, else the first; the message
  // writes the name as JSON does.
  const literals = [
    ...source.matchAll(/(?<!')\{\s*'(?:[^'\\\n]|\\.)*'\s*\}/g),
  ].map(([text]) => text);
  let refused = badName?.[1];
  try {
    refused = JSON.parse(`"${refused}"`) as string;
  } catch {
    // As written, then.
  }
  const literal =
    literals.find((text) => text.slice(1, -1).trim() === refused) ??
    literals[0];
  if (
    library !== "vue" &&
    library !== "fluent" &&
    badName &&
    /^\s*'/.test(badName[1]!) &&
    literal &&
    parseIcu(source, "vue").ok
  ) {
    return {
      cause: "library",
      advice: `; ${literal.replace(/\s+/g, " ")} is vue-i18n's literal interpolation: declare library: "vue" on the source`,
    };
  }
  const unsupported = /^argument type "([^"]+)" is not supported/.exec(message);
  if (
    library !== "i18next" &&
    ((badName && badName[1]!.startsWith("{")) ||
      (unsupported && !ICU_ARGUMENT_TYPES.has(unsupported[1]!)))
  ) {
    return {
      cause: "library",
      advice: `; {{ }} is i18next's interpolation: declare library: "i18next" on the source`,
    };
  }
  // The mirror: an ICU catalogue read under a library that has no
  // arguments. The brace must be single, or i18next's own
  // `{{date, short}}` matches, and a string refused for some other
  // reason would draw the wrong advice for holding one. i18next is
  // included because a branch that opens with a placeholder puts `{{`
  // in the string, which that reader refuses: an ICU catalogue's plain
  // strings push and its nested ones do not, which is the least
  // obvious way to get this wrong.
  if (
    !readsAsIcu(library) &&
    badName &&
    /(?<!\{)\{\s*[^{},\s][^{},]*,\s*[a-z]+/.test(source)
  ) {
    return {
      cause: "library",
      advice: `; {name, plural, …} is an ICU argument: declare library: "icu" on the source, or leave the field out`,
    };
  }
  return undefined;
}

// The clause the CLI and the server append to a parse error (#486,
// #505), or "" when the text alone says it.
export function refusalAdvice(
  source: string,
  library: Library,
  message: string,
): string {
  return refusal(source, library, message)?.advice ?? "";
}

// What a refusal is put down to, for counting: a tag written as prose,
// or a catalogue read under the wrong library, whichever advice it
// drew (#549). Five of one cause stop a build; four and one do not.
export function refusalCause(
  source: string,
  library: Library,
  message: string,
): RefusalCause | undefined {
  return refusal(source, library, message)?.cause;
}

// A String Catalog's `argN` plural is the Nth printf argument, named as
// the verb it replaces is, so the two meet by position (#726).
export function argPositions(nodes: IcuNode[]): IcuNode[] {
  return nodes.map((node): IcuNode => {
    if (node.kind === "tag")
      return { ...node, children: argPositions(node.children) };
    if (node.kind !== "plural" && node.kind !== "select") return node;
    const branches = Object.fromEntries(
      Object.entries(node.branches).map(([k, b]) => [k, argPositions(b)]),
    );
    const n = argIndexOf(node.arg);
    return node.kind === "plural" && n !== undefined
      ? { ...node, arg: n, branches }
      : { ...node, branches };
  });
}
