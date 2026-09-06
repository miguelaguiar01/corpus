// ICU MessageFormat subset (§5): {name} placeholders and single-level
// {arg, select, key {…} …}. Everything else — plural, nesting, other
// argument types — is rejected at push time. Braces are always
// structural; the subset has no quote-escaping.

export type IcuNode =
  | { kind: "literal"; text: string }
  | { kind: "placeholder"; name: string }
  | { kind: "select"; arg: string; branches: Record<string, IcuNode[]> };

export type IcuError = { message: string; position: number };

export type IcuParseResult =
  { ok: true; nodes: IcuNode[] } | { ok: false; errors: IcuError[] };

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A branch key is a word, or a bare number (`1 {marca} other {marcas}`).
const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;

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

  constructor(private readonly source: string) {}

  parseSequence(inBranch: boolean): IcuNode[] {
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
      if (ch === "}") {
        if (!inBranch) {
          throw new ParseFailure("unmatched '}'", this.pos);
        }
        flush();
        return nodes;
      }
      if (ch === "{") {
        flush();
        nodes.push(this.parseArgument(inBranch));
        literalStart = this.pos;
        continue;
      }
      literal += ch;
      this.pos += 1;
    }
    if (inBranch) {
      throw new ParseFailure("unclosed branch '{'", literalStart);
    }
    flush();
    return nodes;
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
    if (type === "plural") {
      throw new ParseFailure("plural is not in the v1 subset", start);
    }
    if (type !== "select") {
      throw new ParseFailure(
        `argument type ${JSON.stringify(type)} is not supported; only select is`,
        start,
      );
    }
    if (inBranch) {
      throw new ParseFailure("selects cannot nest", start);
    }
    if (!NAME_RE.test(name)) {
      throw new ParseFailure(
        `invalid select argument name ${JSON.stringify(name)}`,
        start,
      );
    }
    if (this.source[this.pos] !== ",") {
      throw new ParseFailure("select needs branches", start);
    }
    this.pos += 1; // consume ','

    const branches: Record<string, IcuNode[]> = {};
    for (;;) {
      this.skipWhitespace();
      const ch = this.source[this.pos];
      if (ch === undefined) {
        throw new ParseFailure("unclosed select", start);
      }
      if (ch === "}") {
        this.pos += 1;
        if (Object.keys(branches).length === 0) {
          throw new ParseFailure("select needs at least one branch", start);
        }
        return { kind: "select", arg: name, branches };
      }
      const key = this.readUntil(["{", "}"]).trim();
      if (this.source[this.pos] !== "{") {
        throw new ParseFailure("select needs branches", start);
      }
      if (!KEY_RE.test(key)) {
        throw new ParseFailure(
          `invalid branch key ${JSON.stringify(key)}`,
          this.pos,
        );
      }
      this.pos += 1; // consume '{'
      branches[key] = this.parseSequence(true);
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

export function parseIcu(source: string): IcuParseResult {
  try {
    return { ok: true, nodes: new Parser(source).parseSequence(false) };
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
): void {
  for (const node of nodes) {
    if (node.kind === "placeholder") placeholders.add(node.name);
    if (node.kind === "select") {
      selectArgs.add(node.arg);
      for (const branch of Object.values(node.branches)) {
        collect(branch, placeholders, selectArgs);
      }
    }
  }
}

export function placeholdersOf(source: string): Set<string> {
  const result = parseIcu(source);
  const placeholders = new Set<string>();
  if (result.ok) collect(result.nodes, placeholders, new Set());
  return placeholders;
}

export function selectArgsOf(source: string): Set<string> {
  const result = parseIcu(source);
  const selectArgs = new Set<string>();
  if (result.ok) collect(result.nodes, new Set(), selectArgs);
  return selectArgs;
}
