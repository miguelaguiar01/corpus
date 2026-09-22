// `corpus check` (§3): a heuristic lint for user-facing string literals
// outside the declared sources. It walks the real syntax tree, so it can
// tell JSX text and user-facing props from code strings; it cannot know
// intent, hence the allow list and `corpus-ignore` comments.
//
// Known gaps, by design of a heuristic: a plain string variable used as
// a JSX child, template literals with substitutions, calls such as
// toast("Saved"), and the `value` prop are not findings. A react-i18next
// `Trans` element is a catalogue call: its children are the key, so
// nothing under it is one.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { findVueLiterals } from "./check-vue";

export type Finding = { file: string; line: number; text: string };
export type FindOptions = { allow?: RegExp[] };
export type CheckOptions = {
  include: string[];
  ignore?: string[];
  allow?: RegExp[];
};

export const USER_FACING_PROPS = new Set([
  "title",
  "placeholder",
  "aria-label",
  "alt",
  "label",
]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git"]);
export const LETTERS = /\p{L}.*\p{L}/su;

// An entity is markup, not letters: without this `&nbsp;` and `&middot;`
// read as words and a spacing-only text is a finding (43 of Outline's
// 142). Only the letters test sees the decoded text; a finding still
// carries the line as the author wrote it. A named entity this table
// does not know is left as written, so text made of those still reads as
// words; a numeric reference always decodes, letter or not. JSX decodes
// entities in text and in a quoted attribute, and not inside braces, so
// neither does this.
const ENTITIES: Record<string, string> = {
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  zwj: "",
  zwnj: "",
  shy: "\u00ad",
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
  harr: "↔",
  minus: "−",
  Dagger: "‡",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  sbquo: "\u201a",
  bdquo: "\u201e",
  prime: "\u2032",
  Prime: "\u2033",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  frac14: "¼",
  frac12: "½",
  frac34: "¾",
  iexcl: "¡",
  iquest: "¿",
  micro: "µ",
  hearts: "♥",
  diams: "♦",
  clubs: "♣",
  spades: "♠",
  loz: "◊",
  starf: "★",
  check: "✓",
  cross: "✗",
  infin: "∞",
  ne: "≠",
  le: "≤",
  ge: "≥",
};
const ENTITY_RE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decoded(text: string): string {
  return text.replace(ENTITY_RE, (whole, body: string) => {
    if (!body.startsWith("#")) return ENTITIES[body] ?? whole;
    const hex = body[1] === "x" || body[1] === "X";
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (code < 1 || code > 0x10ffff) return whole;
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
  // `markup` is false for a string literal in braces, which React
  // renders as written, entities and all.
  const report = (pos: number, raw: string, markup = true) => {
    const text = raw.trim();
    if (!LETTERS.test(markup ? decoded(text) : text)) return;
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
      report(node.expression.getStart(sf), node.expression.text, false);
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
// An include entry that could not be scanned, and why (#499): one that
// is missing or is a file narrows the lint silently while another entry
// keeps the run green.
export type Unscanned = {
  dir: string;
  reason: "missing" | "not-a-directory" | "unreadable";
};
export type CheckResult = {
  findings: Finding[];
  scanned: Scanned[];
  unscanned: Unscanned[];
};

// JSX carries its markup in the syntax tree; a Vue single-file
// component carries it in a `<template>` block, scanned separately.
export const EXTENSIONS = [".jsx", ".tsx", ".vue"] as const;
// "a, b and c", so the message reads as a sentence; there are always
// at least two.
export const READS =
  EXTENSIONS.slice(0, -1).join(", ") +
  " and " +
  EXTENSIONS[EXTENSIONS.length - 1];
const PARSES = new RegExp(`(?:${EXTENSIONS.map((e) => `\\${e}`).join("|")})$`);

export function checkFiles(root: string, options: CheckOptions): CheckResult {
  const ignored = ignoreMatcher(options.ignore ?? []);
  const findings: Finding[] = [];
  const scanned: Scanned[] = [];
  let parsed = 0;
  const unscanned: Unscanned[] = [];
  // An entry that cannot be read — a dangling symlink, a directory
  // without permission — is skipped and named, not thrown and not
  // silently taken with the rest of the tree.
  const walk = (dir: string): boolean => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      unscanned.push({
        dir: path.relative(root, dir).split(path.sep).join("/"),
        reason: "unreadable",
      });
      return false;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (ignored(rel)) continue;
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        unscanned.push({ dir: rel, reason: "unreadable" });
        continue;
      }
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs);
      } else if (PARSES.test(name)) {
        let source;
        try {
          source = readFileSync(abs, "utf8");
        } catch {
          unscanned.push({ dir: rel, reason: "unreadable" });
          continue;
        }
        parsed += 1;
        const find = name.endsWith(".vue") ? findVueLiterals : findLiterals;
        for (const f of find(source, rel, {
          allow: options.allow,
        })) {
          findings.push(f);
        }
      }
    }
    return true;
  };
  for (const inc of options.include) {
    const abs = path.join(root, inc);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      unscanned.push({ dir: inc, reason: "missing" });
      continue;
    }
    if (!stat.isDirectory()) {
      unscanned.push({ dir: inc, reason: "not-a-directory" });
      continue;
    }
    parsed = 0;
    if (walk(abs)) scanned.push({ dir: inc, parsed });
  }
  return { findings, scanned, unscanned };
}
