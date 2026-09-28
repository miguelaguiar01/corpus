// ICU MessageFormat subset (§5): {name} placeholders, single-level
// {arg, select, key {…} …} and single-level {n, plural, one {…} other {…}}
// with =N exact branches and # for the number, and rich-text tags,
// <name>…</name> or <name/>, which the client renders with a component
// and a translation must keep. Everything else — nesting of select and
// plural, other argument types — is rejected at push time. Braces are
// always structural; the subset has no quote-escaping; a < that opens
// no tag is text.

import { localeOf, type Library } from "./strings";

export type IcuNode =
  | { kind: "literal"; text: string }
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
  | { kind: "plural"; arg: string; branches: Record<string, IcuNode[]> }
  // `#` inside a plural branch: the number itself.
  | { kind: "count"; arg: string }
  // <name>children</name>, or <name/> with none.
  // `attrs` is an opening tag's attribute text as written (`href="%s"`),
  // part of the tag's identity: a translation keeps it verbatim (#590).
  | { kind: "tag"; name: string; attrs?: string; children: IcuNode[] }
  // vue-i18n's pipe plural: `one | other`, positional, with no argument
  // because the count is passed at render time rather than named in the
  // string. Branches are in the order they were written.
  | { kind: "forms"; branches: IcuNode[][] };

export type PlaceholderFormat = {
  type: "number" | "date" | "time";
  style?: string;
};

export type IcuError = { message: string; position: number };

export type IcuParseResult =
  { ok: true; nodes: IcuNode[] } | { ok: false; errors: IcuError[] };

// An argument name is an identifier in any script, marks included for
// Thai and Devanagari, or, as ICU allows and older catalogues write, a
// bare number ({0}, {1}): a translated name is then a placeholder the
// source lacks, not a parse error (#653).
const NAME_RE = /^(?:[\p{L}_][\p{L}\p{M}\p{N}_]*|[0-9]+)$/u;
// A branch key is a word, or a bare number (`1 {marca} other {marcas}`).
const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;
// A plural branch is a CLDR category or an exact number (`=1 {…}`).
export const PLURAL_CATEGORIES = [
  "zero",
  "one",
  "two",
  "few",
  "many",
  "other",
] as const;
const PLURAL_KEY_RE = /^(?:zero|one|two|few|many|other|=[0-9]+)$/;
// A tag as the rich-text libraries write it: <link>, <checkoutDocs/>,
// react-i18next's <2> for an indexed Trans child, and HTML with
// attributes as Gitea writes it, <a href="%s" target="_blank"> (#590).
// The attribute group starts at one whitespace and runs lazily to the
// close, with nothing else matching spaces, so a name followed by a run
// of whitespace and no `>` is linear, not cubic; readTag trims it.
const TAG_RE = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*|[0-9]+)((?:\s[^<>]*?)?)(\/?)>/;
// HTML's void elements, read so only where the text's tags are HTML or
// its library treats them so (#643); HTML ignores their case.
const VOID_TAGS = new Set(["br", "hr", "wbr", "img"]);

export function isVoidTag(name: string): boolean {
  return VOID_TAGS.has(name.toLowerCase());
}

// A tag's identity for a chip and for the check that a translation
// keeps it: the name, with its attribute text when it has one.
export function tagIdentity(tag: { name: string; attrs?: string }): string {
  return tag.attrs ? `${tag.name} ${tag.attrs}` : tag.name;
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

// Chrome i18n's `$NAME$` (#595): letters, digits and `_`, matched
// case-insensitively against the `placeholders` map, so the name is
// lowercased and the written form kept.
const CHROME_PLACEHOLDER_RE = /^\$([A-Za-z0-9_]+)\$/;

// The verb of a printf placeholder as written, modifier and letter
// (`ld` of `%2$-8ld`): what a translation must keep at the position,
// and what the index form names. Undefined for text that is not a verb.
export function printfVerbOf(written: string): string | undefined {
  return PRINTF_VERB_RE.exec(written)?.[4];
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
const ARG_PLURAL_RE = /\{\s*arg\d+\s*,\s*plural\s*,/;

function argPlurals(
  source: string,
  html: boolean | "markup",
  syntax: Library,
): IcuNode[] | undefined {
  if (syntax !== "printf" || !ARG_PLURAL_RE.test(source)) return undefined;
  try {
    return new Parser(source, syntax, html, false, true).parseSequence(false);
  } catch (error) {
    if (error instanceof ParseFailure) return undefined;
    throw error;
  }
}

// The printf text read as one plural, or undefined where it is not one
// from end to end, or does not parse as one: then it is printf text as
// before (#652).
function printfPlural(
  source: string,
  html: boolean | "markup",
  syntax: Library,
): IcuNode[] | undefined {
  const read = readPrintfPlural(source, html, syntax);
  return "nodes" in read ? read.nodes : undefined;
}

// Why a printf text that opens as a plural is not one (#652), for a
// translation of a plural, where falling back to text would hide it.
export function printfPluralError(
  text: string,
  html: boolean | "markup" = false,
  syntax: Library = "printf",
): IcuError | undefined {
  if (!PRINTF_PLURAL_OPENS_RE.test(text)) return undefined;
  if (argPlurals(text, html, syntax)) return undefined;
  const read = readPrintfPlural(text, html, syntax);
  return "error" in read ? read.error : undefined;
}

function readPrintfPlural(
  source: string,
  html: boolean | "markup",
  syntax: Library,
): { nodes: IcuNode[] } | { error: IcuError } {
  try {
    const nodes = new Parser(source, syntax, html, true).parseSequence(false);
    const kept = nodes.filter(
      (node) => !(node.kind === "literal" && node.text.trim() === ""),
    );
    if (kept.length === 1 && kept[0]!.kind === "plural") return { nodes };
    const after = source.search(/\}[^}]*$/) + 1;
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

class Parser {
  private pos = 0;
  // The next verb's position when none is written (#594).
  private printfNext = 1;
  // Whether a substitution's branch has yet to write its argument (#726).
  private ownFree = false;
  // The next `{}`'s position under easy_localization (#664).
  private positional = 0;

  constructor(
    private readonly source: string,
    private readonly syntax: Library,
    // True reads HTML's void tags; "markup", a type read as HTML (#755),
    // also reads a tag that never closes, or a stray closing tag, as text,
    // as a browser does.
    private readonly html: boolean | "markup",
    // printf text that is wholly one ICU plural, as a gettext or String
    // Catalog converter writes it (#652): its braces are the plural's,
    // its branches printf.
    private readonly printfPlural = false,
    // printf text with plurals on `argN` in it (#726).
    private readonly argPlurals = false,
  ) {}

  // Inside a plural's branch, `#` is the number; anywhere else it is text.
  // Inside a tag, the sequence ends at its closing tag.
  parseSequence(
    inBranch: boolean,
    pluralArg?: string,
    closing?: string,
  ): IcuNode[] {
    const nodes: IcuNode[] = [];
    let literal = "";
    let literalStart = this.pos;

    const flush = () => {
      if (literal !== "") {
        nodes.push({ kind: "literal", text: literal });
        literal = "";
      }
    };

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (
        ch === "}" &&
        (this.syntax === "icu" ||
          this.syntax === "android" ||
          ((this.printfPlural || this.argPlurals) && inBranch))
      ) {
        if (!inBranch) {
          throw new ParseFailure("unmatched '}'", this.pos);
        }
        if (closing !== undefined) {
          throw new ParseFailure(`unclosed <${closing}>`, literalStart);
        }
        flush();
        return nodes;
      }
      // counterpart (#663): `%(name)s` is a placeholder, braces and `#`
      // are text but for a plural read whole, and tags are substitutions.
      if (this.syntax === "counterpart") {
        if (ch === "%") {
          const match = COUNTERPART_PLACEHOLDER_RE.exec(
            this.source.slice(this.pos),
          );
          if (match) {
            flush();
            nodes.push({
              kind: "placeholder",
              name: match[1]!,
              written: match[0],
            });
            this.pos += match[0].length;
            literalStart = this.pos;
            continue;
          }
        }
        if (ch === "#" || (ch === "{" && !(this.printfPlural && !inBranch))) {
          literal += ch;
          this.pos += 1;
          continue;
        }
      }
      // easy_localization (#664): `{}` and `{name}` are placeholders, a
      // link must be kept, and braces around anything else, `#` and
      // angle brackets are text, but for a plural read whole.
      if (this.syntax === "easy_localization") {
        const rest = this.source.slice(this.pos);
        const link = ch === "@" ? EASY_LINK_RE.exec(rest) : null;
        if (link) {
          flush();
          nodes.push({ kind: "placeholder", name: link[0], written: link[0] });
          this.pos += link[0].length;
          literalStart = this.pos;
          continue;
        }
        const opensPlural = this.printfPlural && !inBranch && ch === "{";
        const brace =
          ch === "{" && !opensPlural ? EASY_PLACEHOLDER_RE.exec(rest) : null;
        if (brace) {
          flush();
          // In a plural's form, `{}` is the count.
          const name = brace[1] ?? pluralArg ?? String(this.positional++);
          nodes.push({ kind: "placeholder", name, written: brace[0] });
          this.pos += brace[0].length;
          literalStart = this.pos;
          continue;
        }
        if (ch === "#" || ch === "<" || (ch === "{" && !opensPlural)) {
          literal += ch;
          this.pos += 1;
          continue;
        }
      }
      // Rails I18n (#665): `%{name}` is a placeholder, `%%{` a literal,
      // braces and `#` text but for a plural read whole; tags as ICU's.
      if (this.syntax === "rails") {
        const rest = this.source.slice(this.pos);
        if (rest.startsWith("%%")) {
          literal += "%%";
          this.pos += 2;
          continue;
        }
        const match = ch === "%" ? RAILS_PLACEHOLDER_RE.exec(rest) : null;
        if (match) {
          flush();
          nodes.push({
            kind: "placeholder",
            name: (match[1] ?? match[2])!,
            written: match[0],
          });
          this.pos += match[0].length;
          literalStart = this.pos;
          continue;
        }
        if (ch === "#" || (ch === "{" && !(this.printfPlural && !inBranch))) {
          literal += ch;
          this.pos += 1;
          continue;
        }
      }
      // Qt (#666): a placeholder is its number, `%L1` being `%1` shown
      // in the locale's digits; any other `%`, braces and `#` are text,
      // and angle brackets too unless the type is read as HTML.
      if (this.syntax === "qt") {
        const match =
          ch === "%"
            ? QT_PLACEHOLDER_RE.exec(this.source.slice(this.pos))
            : null;
        if (match) {
          flush();
          // Named by its value: `%01` is Qt's `%1`.
          const digits = match[2]!;
          nodes.push({
            kind: "placeholder",
            name: digits === "n" ? "n" : String(Number(digits)),
            written: match[0],
          });
          this.pos += match[0].length;
          literalStart = this.pos;
          continue;
        }
        if (
          ch === "#" ||
          (ch === "<" && !this.html) ||
          (ch === "{" && !(this.printfPlural && !inBranch))
        ) {
          literal += ch;
          this.pos += 1;
          continue;
        }
      }
      if (this.syntax === "chrome") {
        if (ch === "$") {
          if (this.source[this.pos + 1] === "$") {
            literal += "$";
            this.pos += 2;
            continue;
          }
          const match = CHROME_PLACEHOLDER_RE.exec(this.source.slice(this.pos));
          if (match) {
            flush();
            nodes.push({
              kind: "placeholder",
              name: match[1]!.toLowerCase(),
              written: match[0],
            });
            this.pos += match[0].length;
            literalStart = this.pos;
            continue;
          }
        }
        literal += ch;
        this.pos += 1;
        continue;
      }
      // printf: braces, angle brackets and `#` are text; `%` opens a verb.
      // android (#596): the verbs, with ICU's plural and tags around them.
      if (this.syntax === "printf" || this.syntax === "android") {
        // A substitution's own value, its argument's verb whatever type
        // the catalogue formats it with.
        const own = /^arg(\d+)$/.exec(pluralArg ?? "")?.[1];
        if (
          this.argPlurals &&
          own !== undefined &&
          this.source.startsWith("%arg", this.pos)
        ) {
          flush();
          nodes.push({ kind: "placeholder", name: own, written: "%arg" });
          this.ownFree = false;
          this.pos += 4;
          literalStart = this.pos;
          continue;
        }
        const argPlural =
          this.argPlurals &&
          !inBranch &&
          ch === "{" &&
          /^\{\s*arg(\d+)\s*,\s*plural\s*,/.exec(this.source.slice(this.pos));
        if (argPlural) {
          flush();
          const position = Number(argPlural[1]);
          const node = this.parseArgument(inBranch);
          // Named by its position, as the verb it stands for is.
          this.printfNext = position + 1;
          nodes.push(node);
          literalStart = this.pos;
          continue;
        }
        if (ch === "%") {
          if (this.source[this.pos + 1] === "%") {
            literal += "%";
            this.pos += 2;
            continue;
          }
          const verb = PRINTF_VERB_RE.exec(this.source.slice(this.pos));
          if (verb) {
            flush();
            const explicit = verb[1] ?? verb[2];
            // In a substitution's branch the first unindexed verb is its
            // argument, as `%arg` is, and the rest count on after it (#726).
            const substituted =
              this.argPlurals && own !== undefined && !explicit && this.ownFree;
            if (substituted) this.ownFree = false;
            const position = explicit
              ? Number(explicit)
              : substituted
                ? Number(own)
                : this.printfNext;
            if (!substituted) this.printfNext = position + 1;
            nodes.push({
              kind: "placeholder",
              name: String(position),
              written: verb[0],
            });
            this.pos += verb[0].length;
            literalStart = this.pos;
            continue;
          }
        }
        const opensPlural = this.printfPlural && !inBranch && ch === "{";
        if (
          (this.syntax === "printf" && !opensPlural) ||
          ch === "%" ||
          ch === "#"
        ) {
          literal += ch;
          this.pos += 1;
          continue;
        }
      }
      // vue-i18n has no tag syntax: a `<` is text (#644).
      if (ch === "<" && this.syntax !== "vue") {
        const tag = this.readTag();
        if (tag === undefined) {
          literal += ch;
          this.pos += 1;
          continue;
        }
        const after = this.pos;
        const raw = this.source.slice(tag.start, after);
        if (
          this.html === "markup" &&
          tag.kind === "close" &&
          (closing === undefined || tag.name !== closing)
        ) {
          literal += raw;
          continue;
        }
        flush();
        if (tag.kind === "open" && this.html === "markup") {
          try {
            const children = this.parseSequence(inBranch, pluralArg, tag.name);
            nodes.push({
              kind: "tag",
              name: tag.name,
              ...(tag.attrs ? { attrs: tag.attrs } : {}),
              children,
            });
          } catch (error) {
            if (
              !(error instanceof ParseFailure) ||
              error.message !== `unclosed <${tag.name}>`
            )
              throw error;
            this.pos = after;
            literal += raw;
          }
          literalStart = this.pos;
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
          return nodes;
        }
        nodes.push({
          kind: "tag",
          name: tag.name,
          ...(tag.attrs ? { attrs: tag.attrs } : {}),
          children:
            tag.kind === "self"
              ? []
              : this.parseSequence(inBranch, pluralArg, tag.name),
        });
        literalStart = this.pos;
        continue;
      }
      if (ch === "{") {
        // vue-i18n: `{name}` is a placeholder and `{'…'}` is the escape
        // for a literal `@`, `|` or `{`, which the language would
        // otherwise read as syntax.
        if (this.syntax === "vue") {
          flush();
          nodes.push(this.parseVueBrace());
          literalStart = this.pos;
          continue;
        }
        // i18next: {{name}} is a placeholder, a single brace is text,
        // and there are no arguments, so nothing else opens here.
        // A plural read whole opens with a single brace (#662).
        if (this.syntax === "i18next" && !(this.printfPlural && !inBranch)) {
          if (this.source[this.pos + 1] !== "{") {
            literal += ch;
            this.pos += 1;
            continue;
          }
          flush();
          nodes.push(this.parseDoubleBrace());
          literalStart = this.pos;
          continue;
        }
        flush();
        nodes.push(this.parseArgument(inBranch));
        literalStart = this.pos;
        continue;
      }
      if (ch === "#" && pluralArg !== undefined && this.syntax !== "i18next") {
        flush();
        nodes.push({ kind: "count", arg: pluralArg });
        this.pos += 1;
        literalStart = this.pos;
        continue;
      }
      literal += ch;
      this.pos += 1;
    }
    if (closing !== undefined) {
      throw new ParseFailure(`unclosed <${closing}>`, literalStart);
    }
    if (inBranch) {
      throw new ParseFailure("unclosed branch '{'", literalStart);
    }
    flush();
    return nodes;
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
    if (!I18NEXT_NAME_RE.test(key)) {
      throw new ParseFailure(
        `invalid placeholder name ${JSON.stringify(key)}`,
        start,
      );
    }
    this.pos = end + 2;
    return { kind: "placeholder", name: unescaped ? `-${key}` : key };
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
    if (!NAME_RE.test(inner)) {
      throw new ParseFailure(
        `invalid placeholder name ${JSON.stringify(inner)}`,
        start,
      );
    }
    return { kind: "placeholder", name: inner };
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
      !this.source.slice(this.pos).includes(`</${name}>`);
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

  private parseArgument(inBranch: boolean): IcuNode {
    const start = this.pos;
    this.pos += 1; // consume '{'
    const body = this.readUntil(["}", ","]);
    const next = this.source[this.pos];
    if (next === undefined) {
      throw new ParseFailure("unclosed '{'", start);
    }

    const name = body.trim();
    if (next === "}") {
      if (!NAME_RE.test(name)) {
        throw new ParseFailure(
          `invalid placeholder name ${JSON.stringify(name)}`,
          start,
        );
      }
      this.pos += 1;
      return { kind: "placeholder", name };
    }

    // '{arg, type, ...}'
    this.pos += 1; // consume ','
    const type = this.readUntil([",", "}"]).trim();
    if (type === "number" || type === "date" || type === "time") {
      if (!NAME_RE.test(name)) {
        throw new ParseFailure(
          `invalid placeholder name ${JSON.stringify(name)}`,
          start,
        );
      }
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
      this.pos += 1;
      return {
        kind: "placeholder",
        name,
        format: style === undefined ? { type } : { type, style },
      };
    }
    if (type !== "select" && type !== "plural") {
      throw new ParseFailure(
        `argument type ${JSON.stringify(type)} is not supported; only select, plural, number, date and time are`,
        start,
      );
    }
    if (inBranch) {
      throw new ParseFailure(`${type}s cannot nest`, start);
    }
    if (!NAME_RE.test(name)) {
      throw new ParseFailure(
        `invalid ${type} argument name ${JSON.stringify(name)}`,
        start,
      );
    }
    if (this.source[this.pos] !== ",") {
      throw new ParseFailure(`${type} needs branches`, start);
    }
    this.pos += 1; // consume ','

    const branches: Record<string, IcuNode[]> = {};
    for (;;) {
      this.skipWhitespace();
      const ch = this.source[this.pos];
      if (ch === undefined) {
        throw new ParseFailure(`unclosed ${type}`, start);
      }
      if (ch === "}") {
        this.pos += 1;
        if (Object.keys(branches).length === 0) {
          throw new ParseFailure(`${type} needs at least one branch`, start);
        }
        if (type === "plural" && !("other" in branches)) {
          throw new ParseFailure("plural needs an other branch", start);
        }
        return { kind: type, arg: name, branches };
      }
      const key = this.readUntil(["{", "}"]).trim();
      if (this.source[this.pos] !== "{") {
        throw new ParseFailure(`${type} needs branches`, start);
      }
      if (!(type === "plural" ? PLURAL_KEY_RE : KEY_RE).test(key)) {
        throw new ParseFailure(
          type === "plural"
            ? `invalid plural branch key ${JSON.stringify(key)}: a category (${PLURAL_CATEGORIES.join(", ")}) or =N`
            : `invalid branch key ${JSON.stringify(key)}`,
          this.pos,
        );
      }
      this.pos += 1; // consume '{'
      // Each Android plural item is a string of its own: its verbs count
      // from 1.
      if (this.syntax === "android" || this.printfPlural) this.printfNext = 1;
      const own = this.argPlurals ? /^arg(\d+)$/.exec(name)?.[1] : undefined;
      if (own !== undefined) {
        this.printfNext = Number(own) + 1;
        this.ownFree = true;
      }
      branches[key] = this.parseSequence(
        true,
        type === "plural" ? name : undefined,
      );
      this.pos += 1; // consume '}'
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

// `html` reads `<br>`, `<hr>`, `<wbr>` and `<img>` as void elements
// (#643): without it, where a component renders each tag, `<br></br>` is
// a pair like any other and a lone `<br>` is unclosed. Validation passes
// it for the text in hand; reading a source for its parts leaves it
// unset, which takes whatever either reading takes.
export function parseIcu(
  source: string,
  syntax: Library = "icu",
  options: { html?: boolean | "markup" } = {},
): IcuParseResult {
  if (options.html === undefined) {
    const lenient = parseWith(source, syntax, true);
    if (lenient.ok) return lenient;
    const strict = parseWith(source, syntax, false);
    return strict.ok ? strict : lenient;
  }
  return parseWith(source, syntax, options.html);
}

function parseWith(
  source: string,
  syntax: Library,
  html: boolean | "markup",
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
      const plural = printfPlural(source, html, syntax);
      if (plural) return { ok: true, nodes: plural };
    }
    return {
      ok: true,
      nodes: new Parser(source, syntax, html).parseSequence(false),
    };
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

// vue-i18n separates plural forms with a top-level `|`. The source is
// split before it is parsed, so a pipe inside a `{'…'}` literal is
// text: that escape is exactly how a catalogue writes one (#496).
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

function splitVueSource(source: string): string[] {
  const parts: string[] = [];
  let current = "";
  let at = 0;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "{") {
      const end = closingBrace(source, at);
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

function collect(
  nodes: IcuNode[],
  placeholders: Set<string>,
  selectArgs: Set<string>,
  pluralArgs: Set<string> = new Set(),
  tags: Set<string> = new Set(),
): void {
  for (const node of nodes) {
    if (node.kind === "placeholder") placeholders.add(node.name);
    if (node.kind === "select" || node.kind === "plural") {
      (node.kind === "select" ? selectArgs : pluralArgs).add(node.arg);
      for (const branch of Object.values(node.branches)) {
        collect(branch, placeholders, selectArgs, pluralArgs, tags);
      }
    }
    if (node.kind === "tag") {
      tags.add(tagIdentity(node));
      collect(node.children, placeholders, selectArgs, pluralArgs, tags);
    }
    // A form's placeholders are the message's: without this an agent is
    // told a pipe plural has none, drafts without them, and is refused.
    if (node.kind === "forms") {
      for (const branch of node.branches) {
        collect(branch, placeholders, selectArgs, pluralArgs, tags);
      }
    }
  }
}

// The select and plural nodes of a tree in source order, through tags,
// which may wrap them; a branch's own nodes are not entered, since
// select and plural do not nest.
export function branchingNodes(
  nodes: IcuNode[],
): Extract<IcuNode, { kind: "select" | "plural" }>[] {
  const out: Extract<IcuNode, { kind: "select" | "plural" }>[] = [];
  for (const node of nodes) {
    if (node.kind === "select" || node.kind === "plural") out.push(node);
    else if (node.kind === "tag") out.push(...branchingNodes(node.children));
    else if (node.kind === "forms")
      for (const branch of node.branches) out.push(...branchingNodes(branch));
  }
  return out;
}

export function tagsOf(source: string, syntax: Library = "icu"): Set<string> {
  const result = parseIcu(source, syntax);
  const tags = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), new Set(), new Set(), tags);
  return tags;
}

// Each formatted placeholder's format as the source wrote it,
// `number, ::percent`, so a chip inserts the source's form (#555).
export function placeholderFormatsOf(
  source: string,
  syntax: Library = "icu",
): Map<string, string> {
  const formats = new Map<string, string>();
  const result = parseIcu(source, syntax);
  if (result.ok) collectFormats(result.nodes, formats);
  return formats;
}

// Each placeholder as the source writes it, for a library whose verbs
// are not their names (printf): position to `%[2]s`.
export function placeholderWrittenOf(
  source: string,
  syntax: Library = "icu",
): Map<string, string> {
  const written = new Map<string, string>();
  const result = parseIcu(source, syntax);
  if (result.ok) collectWritten(result.nodes, written);
  return written;
}

function collectWritten(nodes: IcuNode[], written: Map<string, string>): void {
  for (const node of nodes) {
    // `%arg` stands in only inside a substitution's branch: another verb
    // at its position is what a chip writes (#726).
    if (
      node.kind === "placeholder" &&
      node.written &&
      (!written.has(node.name) || written.get(node.name) === "%arg")
    )
      written.set(node.name, node.written);
    else if (node.kind === "tag") collectWritten(node.children, written);
    else if (node.kind === "select" || node.kind === "plural") {
      for (const branch of Object.values(node.branches))
        collectWritten(branch, written);
    } else if (node.kind === "forms") {
      for (const branch of node.branches) collectWritten(branch, written);
    }
  }
}

// A format as the source writes it after the name: "number, ::percent".
export function placeholderFormatText(format: PlaceholderFormat): string {
  return format.style === undefined
    ? format.type
    : `${format.type}, ${format.style}`;
}

function collectFormats(nodes: IcuNode[], formats: Map<string, string>) {
  for (const node of nodes) {
    if (node.kind === "placeholder" && node.format && !formats.has(node.name)) {
      formats.set(node.name, placeholderFormatText(node.format));
    } else if (node.kind === "tag") collectFormats(node.children, formats);
    else if (node.kind === "forms") {
      for (const branch of node.branches) collectFormats(branch, formats);
    } else if (node.kind === "select" || node.kind === "plural") {
      for (const branch of Object.values(node.branches)) {
        collectFormats(branch, formats);
      }
    }
  }
}

export function placeholdersOf(
  source: string,
  syntax: Library = "icu",
): Set<string> {
  const result = parseIcu(source, syntax);
  const placeholders = new Set<string>();
  if (result.ok) collect(result.nodes, placeholders, new Set());
  return placeholders;
}

export function selectArgsOf(
  source: string,
  syntax: Library = "icu",
): Set<string> {
  const result = parseIcu(source, syntax);
  const selectArgs = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), selectArgs);
  return selectArgs;
}

// How many vue-i18n pipe forms a source has (#660): `no posts | one post
// | {n} posts` is 3, anything else 0.
export function formsOf(source: string, syntax: Library = "icu"): number {
  const result = parseIcu(source, syntax);
  const only =
    result.ok && result.nodes.length === 1 ? result.nodes[0] : undefined;
  return only?.kind === "forms" ? only.branches.length : 0;
}

export function pluralArgsOf(
  source: string,
  syntax: Library = "icu",
): Set<string> {
  const result = parseIcu(source, syntax);
  const pluralArgs = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), new Set(), pluralArgs);
  return pluralArgs;
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

export function pluralCategoriesOf(language: string): string[] {
  const cached = categoriesByLanguage.get(language);
  if (cached) return [...cached];
  let categories: string[] = [];
  if (known(language)) {
    const has = new Set(
      new Intl.PluralRules(localeOf(language)).resolvedOptions()
        .pluralCategories,
    );
    categories = PLURAL_CATEGORIES.filter((category) => has.has(category));
  }
  categoriesByLanguage.set(language, categories);
  return [...categories];
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
): boolean {
  if (exact.size === 0 || !known(language)) return false;
  let samples = samplesByLanguage.get(language);
  if (!samples) {
    const rules = new Intl.PluralRules(localeOf(language));
    samples = new Map();
    for (const n of SAMPLES) {
      const key = rules.select(n);
      const values = samples.get(key);
      if (values) values.push(n);
      else samples.set(key, [n]);
    }
    samplesByLanguage.set(language, samples);
  }
  const values = samples.get(category);
  return values !== undefined && values.every((n) => n <= 100 && exact.has(n));
}

// The branch a plural takes for a value (§7): an exact `=N` first, then
// the language's category, then `other`.
export function pluralBranch(
  branches: Record<string, unknown>,
  value: string,
  language?: string,
): string {
  const exact = `=${value.trim()}`;
  if (exact in branches) return exact;
  const n = Number(value);
  if (Number.isFinite(n) && (language === undefined || known(language))) {
    const category = new Intl.PluralRules(
      language === undefined ? undefined : localeOf(language),
    ).select(n);
    if (category in branches) return category;
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
  const badName = /^invalid placeholder name "(.*)"$/.exec(message);
  // `{}` is easy_localization's positional placeholder (#664).
  if (library !== "easy_localization" && badName && badName[1] === "") {
    return {
      cause: "library",
      advice: `; {} is easy_localization's positional placeholder: declare library: "easy_localization" on the source`,
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
    library !== "icu" &&
    badName &&
    /(?<!\{)\{\s*[^{},\s][^{},]*\s*,\s*[a-z]+/.test(source)
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
    const n = /^arg(\d+)$/.exec(node.arg)?.[1];
    return node.kind === "plural" && n !== undefined
      ? { ...node, arg: n, branches }
      : { ...node, branches };
  });
}
