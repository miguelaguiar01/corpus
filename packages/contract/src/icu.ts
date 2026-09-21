// ICU MessageFormat subset (§5): {name} placeholders, single-level
// {arg, select, key {…} …} and single-level {n, plural, one {…} other {…}}
// with =N exact branches and # for the number, and rich-text tags,
// <name>…</name> or <name/>, which the client renders with a component
// and a translation must keep. Everything else — nesting of select and
// plural, other argument types — is rejected at push time. Braces are
// always structural; the subset has no quote-escaping; a < that opens
// no tag is text.

import { localeOf, type Syntax } from "./strings";

export type IcuNode =
  | { kind: "literal"; text: string }
  | { kind: "placeholder"; name: string }
  | { kind: "select"; arg: string; branches: Record<string, IcuNode[]> }
  | { kind: "plural"; arg: string; branches: Record<string, IcuNode[]> }
  // `#` inside a plural branch: the number itself.
  | { kind: "count"; arg: string }
  // <name>children</name>, or <name/> with none.
  | { kind: "tag"; name: string; children: IcuNode[] };

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
// and react-i18next's <2> for an indexed Trans child.
const TAG_RE = /^<(\/?)([A-Za-z][A-Za-z0-9_-]*|[0-9]+)(\/?)>/;
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

class Parser {
  private pos = 0;

  constructor(
    private readonly source: string,
    private readonly syntax: Syntax,
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
          children:
            tag.kind === "self"
              ? []
              : this.parseSequence(inBranch, pluralArg, tag.name),
        });
        literalStart = this.pos;
        continue;
      }
      if (ch === "{") {
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

  // {{ name }}, {{name, format}} or the unescaped {{- name}} at the
  // cursor, consumed (i18next).
  private parseDoubleBrace(): IcuNode {
    const start = this.pos;
    const end = this.source.indexOf("}}", this.pos + 2);
    if (end < 0) throw new ParseFailure("unclosed '{{'", start);
    const inner = this.source.slice(this.pos + 2, end).replace(/^\s*-/, "");
    const name = (inner.split(",")[0] ?? "").trim();
    if (!I18NEXT_NAME_RE.test(name)) {
      throw new ParseFailure(
        `invalid placeholder name ${JSON.stringify(name)}`,
        start,
      );
    }
    this.pos = end + 2;
    return { kind: "placeholder", name };
  }

  // A tag at the cursor, consumed, or nothing when the < is text.
  private readTag():
    | { kind: "open" | "close" | "self"; name: string; start: number }
    | undefined {
    const match = TAG_RE.exec(this.source.slice(this.pos));
    if (!match) return undefined;
    const start = this.pos;
    this.pos += match[0].length;
    const kind =
      match[1] === "/" ? "close" : match[3] === "/" ? "self" : "open";
    return { kind, name: match[2]!, start };
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
    if (type !== "select" && type !== "plural") {
      throw new ParseFailure(
        `argument type ${JSON.stringify(type)} is not supported; only select and plural are`,
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
  syntax: Syntax = "icu",
): IcuParseResult {
  try {
    return {
      ok: true,
      nodes: new Parser(source, syntax).parseSequence(false),
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
      tags.add(node.name);
      collect(node.children, placeholders, selectArgs, pluralArgs, tags);
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
  }
  return out;
}

export function tagsOf(source: string, syntax: Syntax = "icu"): Set<string> {
  const result = parseIcu(source, syntax);
  const tags = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), new Set(), new Set(), tags);
  return tags;
}

export function placeholdersOf(
  source: string,
  syntax: Syntax = "icu",
): Set<string> {
  const result = parseIcu(source, syntax);
  const placeholders = new Set<string>();
  if (result.ok) collect(result.nodes, placeholders, new Set());
  return placeholders;
}

export function selectArgsOf(
  source: string,
  syntax: Syntax = "icu",
): Set<string> {
  const result = parseIcu(source, syntax);
  const selectArgs = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), selectArgs);
  return selectArgs;
}

export function pluralArgsOf(
  source: string,
  syntax: Syntax = "icu",
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
