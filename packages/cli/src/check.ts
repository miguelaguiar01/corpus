// `corpus check` (§3): a heuristic lint for user-facing string literals
// outside the declared sources. It walks the real syntax tree, so it can
// tell JSX text and user-facing props from code strings; it cannot know
// intent, hence the allow list and `corpus-ignore` comments.
//
// Known gaps, by design of a heuristic: a plain string variable used as
// a JSX child, template literals with substitutions, calls such as
// toast("Saved"), and the `value` prop are not findings. A
// react-i18next `Trans` element is a
// catalogue call: its children are the key, so nothing under it is one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export type Finding = { file: string; line: number; text: string };
export type FindOptions = { allow?: RegExp[] };
export type CheckOptions = {
  include: string[];
  ignore?: string[];
  allow?: RegExp[];
};

const USER_FACING_PROPS = new Set([
  "title",
  "placeholder",
  "aria-label",
  "alt",
  "label",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);
const LETTERS = /\p{L}.*\p{L}/su;

// An entity is markup, not letters: without this `&nbsp;` and `&middot;`
// read as words and a spacing-only text is a finding (43 of Outline's
// 142). Only the letters test sees the decoded text; a finding still
// carries the line as the author wrote it. An entity this table does not
// know, or one that stands for a letter, is left as written, so text
// made of those still reads as words.
const ENTITIES: Record<string, string> = {
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwj: "",
  zwnj: "",
  shy: "-",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  times: "×",
  divide: "÷",
  deg: "°",
  plusmn: "±",
  laquo: "«",
  raquo: "»",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  dagger: "†",
  permil: "‰",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
};
const ENTITY_RE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

function decoded(text: string): string {
  return text.replace(ENTITY_RE, (whole, body: string) => {
    if (!body.startsWith("#")) return ENTITIES[body] ?? whole;
    const digits = body.slice(body[1] === "x" || body[1] === "X" ? 2 : 1);
    const code = parseInt(digits, body[1] === "x" || body[1] === "X" ? 16 : 10);
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

export function findLiterals(
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const silenced = new Set<number>();
  source.split("\n").forEach((line, index) => {
    if (line.includes("corpus-ignore")) silenced.add(index + 1).add(index + 2);
  });
  const findings: Finding[] = [];
  const report = (pos: number, raw: string) => {
    const text = raw.trim();
    if (!LETTERS.test(decoded(text))) return;
    if (options.allow?.some((pattern) => pattern.test(text))) return;
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
    if (silenced.has(line)) return;
    findings.push({ file, line, text });
  };
  const visit = (node: ts.Node) => {
    if (isTransElement(node)) return;
    if (ts.isJsxText(node)) {
      const leading = node.text.length - node.text.trimStart().length;
      report(node.getStart(sf) + leading, node.text);
    } else if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      USER_FACING_PROPS.has(node.name.getText(sf))
    ) {
      report(node.initializer.getStart(sf), node.initializer.text);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isStringLiteral(node.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.expression)) &&
      // A string in braces is text only as a child; as a prop's value
      // (`size={"sm"}`, `align={"start"}`) it is the prop's, and only a
      // user-facing prop carries text a person reads.
      (!ts.isJsxAttribute(node.parent) ||
        USER_FACING_PROPS.has(node.parent.name.getText(sf)))
    ) {
      report(node.expression.getStart(sf), node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function isTransElement(node: ts.Node): boolean {
  const tag = ts.isJsxElement(node)
    ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node)
      ? node.tagName
      : undefined;
  if (!tag) return false;
  const name = ts.isPropertyAccessExpression(tag) ? tag.name : tag;
  return ts.isIdentifier(name) && name.text === "Trans";
}

// An ignore entry is a path prefix, or a glob when it has * or ?: **/
// matches zero or more directories, a trailing /** a whole subtree, *
// stays within one segment, ? is one character. One pass over the
// pattern, so no expansion is ever re-read as a pattern.
const GLOB_TOKEN = /(\*\*\/|\/\*\*|\*\*|\*|\?)/;
const GLOB_REGEX: Record<string, string> = {
  "**/": "(?:.*/)?",
  "/**": "(?:/.*)?",
  "**": ".*",
  "*": "[^/]*",
  "?": "[^/]",
};

export function ignoreMatcher(patterns: string[]): (rel: string) => boolean {
  const tests = patterns.map((raw) => {
    const p = raw.replace(/\/$/, "");
    if (!/[*?]/.test(p)) {
      return (rel: string) => rel === p || rel.startsWith(`${p}/`);
    }
    const source = p
      .split(GLOB_TOKEN)
      .map(
        (part) => GLOB_REGEX[part] ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
      )
      .join("");
    const re = new RegExp(`^${source}$`);
    return (rel: string) => re.test(rel);
  });
  return (rel) => tests.some((test) => test(rel));
}

// `scanned` is the included directories that exist, each with how many
// files the walk read under it: the caller says so when a directory
// parsed none, since a clean bill over unread code is a lie.
export type Scanned = { dir: string; parsed: number };
export type CheckResult = { findings: Finding[]; scanned: Scanned[] };

// This is a syntax-tree lint, and only JSX carries the markup it reads.
const EXTENSIONS = [".jsx", ".tsx"] as const;
export const READS = EXTENSIONS.join(" and ");
const PARSES = new RegExp(`(?:${EXTENSIONS.map((e) => `\\${e}`).join("|")})$`);

export function checkFiles(root: string, options: CheckOptions): CheckResult {
  const ignored = ignoreMatcher(options.ignore ?? []);
  const findings: Finding[] = [];
  const scanned: Scanned[] = [];
  let parsed = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (ignored(rel)) continue;
      if (statSync(abs).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs);
      } else if (PARSES.test(name)) {
        parsed += 1;
        for (const f of findLiterals(readFileSync(abs, "utf8"), rel, {
          allow: options.allow,
        })) {
          findings.push(f);
        }
      }
    }
  };
  for (const inc of options.include) {
    const abs = path.join(root, inc);
    try {
      if (statSync(abs).isDirectory()) {
        parsed = 0;
        walk(abs);
        scanned.push({ dir: inc, parsed });
      }
    } catch {
      // A configured directory that does not exist is not scanned; the
      // caller says so when that leaves nothing.
    }
  }
  return { findings, scanned };
}
