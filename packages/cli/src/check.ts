// `corpus check` (§3): a heuristic lint for user-facing string literals
// outside the declared sources. It walks the real syntax tree, so it can
// tell JSX text and user-facing props from code strings; it cannot know
// intent, hence the allow list and `corpus-ignore` comments.
//
// Known gaps, by design of a heuristic: a plain string variable used as
// a JSX child, template literals with substitutions, calls such as
// toast("Saved"), and the `value` prop are not findings; HTML entity
// text can be a false positive.
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
    if (!LETTERS.test(text)) return;
    if (options.allow?.some((pattern) => pattern.test(text))) return;
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
    if (silenced.has(line)) return;
    findings.push({ file, line, text });
  };
  const visit = (node: ts.Node) => {
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
        ts.isNoSubstitutionTemplateLiteral(node.expression))
    ) {
      report(node.expression.getStart(sf), node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
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

export function checkFiles(root: string, options: CheckOptions): Finding[] {
  const ignored = ignoreMatcher(options.ignore ?? []);
  const findings: Finding[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (ignored(rel)) continue;
      if (statSync(abs).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs);
      } else if (/\.[jt]sx$/.test(name)) {
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
      if (statSync(abs).isDirectory()) walk(abs);
    } catch {
      // A configured directory that does not exist is simply empty.
    }
  }
  return findings;
}
