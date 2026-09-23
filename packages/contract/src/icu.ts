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

// An argument name is an identifier or, as ICU allows and older
// catalogues write, a bare number ({0}, {1}).
const NAME_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;
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
// HTML's void elements: <br> opens nothing and </br> is never right.
const VOID_TAGS = new Set(["br", "hr", "wbr", "img"]);

export function isVoidTag(name: string): boolean {
  return VOID_TAGS.has(name);
}

// A tag's identity for a chip and for the check that a translation
// keeps it: the name, with its attribute text when it has one.
export function tagIdentity(tag: { name: string; attrs?: string }): string {
  return tag.attrs ? `${tag.name} ${tag.attrs}` : tag.name;
}
// i18next's interpolation name: an identifier, dotted into an object
// ({{user.name}}); a format after a comma ({{date, short}}) is ignored.
const I18NEXT_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_.$]*$/;

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

// printf's verb: Go's `%[n]verb` or C's `%n$verb` index, then flags,
// width and precision, then the verb letter. `%%` is a literal percent.
// The space flag is left out: "50% off" is prose, not a verb.
const PRINTF_VERB_RE =
  /^%(?:\[(\d+)\]|(\d+)\$)?([-+0#]*(?:\d+|\*)?(?:\.(?:\d+|\*))?)([a-zA-Z])/;

class Parser {
  private pos = 0;
  // The next verb's position when none is written (#594).
  private printfNext = 1;

  constructor(
    private readonly source: string,
    private readonly syntax: Library,
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
      if (ch === "}" && this.syntax === "icu") {
        if (!inBranch) {
          throw new ParseFailure("unmatched '}'", this.pos);
        }
        if (closing !== undefined) {
          throw new ParseFailure(`unclosed <${closing}>`, literalStart);
        }
        flush();
        return nodes;
      }
      // printf: braces, angle brackets and `#` are text; `%` opens a verb.
      if (this.syntax === "printf") {
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
            const position = explicit ? Number(explicit) : this.printfNext;
            this.printfNext = position + 1;
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
        literal += ch;
        this.pos += 1;
        continue;
      }
      if (ch === "<") {
        const tag = this.readTag();
        if (tag === undefined) {
          literal += ch;
          this.pos += 1;
          continue;
        }
        flush();
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
        if (this.syntax === "i18next") {
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
      if (ch === "#" && pluralArg !== undefined) {
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
    const kind =
      match[1] === "/"
        ? "close"
        : match[4] === "/" || VOID_TAGS.has(name)
          ? "self"
          : "open";
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

export function parseIcu(
  source: string,
  syntax: Library = "icu",
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
        new Parser(part.trim(), syntax).parseSequence(false),
      );
      return {
        ok: true,
        nodes:
          branches.length === 1 ? branches[0]! : [{ kind: "forms", branches }],
      };
    }
    return { ok: true, nodes: new Parser(source, syntax).parseSequence(false) };
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
    if (node.kind === "placeholder" && node.written && !written.has(node.name))
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
export function pluralCategoriesOf(language: string): string[] {
  if (!known(language)) return [];
  const has = new Set(
    new Intl.PluralRules(localeOf(language)).resolvedOptions().pluralCategories,
  );
  return PLURAL_CATEGORIES.filter((category) => has.has(category));
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
    return {
      cause: "tag",
      advice: `; a <name> is a rich-text tag: close it with </${unclosed[1]}>, or write the brackets so they do not open a tag`,
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
      advice: isVoidTag(stray[1]!)
        ? `; <${stray[1]}> needs no closing tag: remove it`
        : `; a <name> is a rich-text tag: remove it, or open a matching <${stray[1]}>`,
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
