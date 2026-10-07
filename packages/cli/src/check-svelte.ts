// `corpus check` for Svelte components (§3, #1025). A component is
// markup with `{…}` expressions, `<script>` and `<style>`: those are
// blanked, every character but a line break turned to a space so each
// finding keeps its line, and what is left is HTML, read as a Vue
// template is. `{$t('key')}`, a block (`{#if}`, `{:else}`, `{/each}`,
// `{@html …}`) and a value in braces (`title={…}`, `on:click={…}`) are
// expressions, never text.
//
// Known gap, as for Vue: a string built in `<script>` is the script's.
import {
  decoded,
  isWholeUrl,
  LETTERS,
  type Finding,
  type FindOptions,
} from "./check";
import { markupLiterals } from "./check-vue";

export const blank = (text: string) => text.replace(/[^\n]/g, " ");
// An expression's place, kept so it divides the text around it as a JSX
// expression does: `{n}% - {speed}/s` is no words (#1025).
const GAP = "\u0001";
export const gap = (text: string) => text.replace(/[^\n]/g, GAP);

// The `}` that closes the `{` at `at`, past nested braces and the
// strings an expression holds; the text's end where none does.
function closing(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      // To the closing quote, past a backslash's escape: `'it\'s'`.
      let end = i + 1;
      while (end < source.length && source[end] !== ch)
        end += source[end] === "\\" ? 2 : 1;
      if (end >= source.length) return source.length - 1;
      i = end;
    } else if (ch === "/" && source[i + 1] === "*") {
      // A comment's quote ends no string: `{x /* don't */}`.
      const end = source.indexOf("*/", i + 2);
      if (end < 0) return source.length - 1;
      i = end + 1;
    } else if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end < 0) return source.length - 1;
      i = end;
    } else if (ch === "/" && opensRegex(source, at, i)) {
      // A regex literal's quote or `/*` opens nothing: `{/'/.test(x)}`.
      const end = regexEnd(source, i);
      if (end !== undefined) i = end;
    } else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i;
  }
  return source.length - 1;
}

// Whether a `/` opens a regex literal rather than divides: where what
// comes before it, past spaces, is a block's head (`{#if`, `{:else if`,
// `{@html`), an operator, an opening bracket or separator, or the word
// `return` or `typeof`. Right after the expression's `{` it closes a
// block, `{/if}`, but in an attribute's value, `title={/'/.source}`.
function opensRegex(source: string, at: number, i: number): boolean {
  let j = i - 1;
  while (j > at && /\s/.test(source[j]!)) j--;
  // A closer is `{/word}`, never a value; the slice keeps the test short.
  if (j <= at)
    return (
      source[at - 1] === "=" && !/^\/[a-z]+\s*\}/.test(source.slice(i, i + 32))
    );
  const before = source.slice(at + 1, j + 1);
  if (/^\s*(?:[#@][a-z]+|:else\s+if)$/.test(before)) return true;
  const ch = source[j]!;
  // TypeScript's non-null assertion, `duration! / 1000`, and `i++`
  // end a value.
  if (ch === "!" && /[\w$)\]]/.test(source[j - 1] ?? "")) return false;
  if ((ch === "+" || ch === "-") && source[j - 1] === ch) return false;
  if ("([{,;:?!=&|+-*%<>~^".includes(ch)) return true;
  return /(?:^|[^\w$.])(?:return|typeof)$/.test(before);
}

// Where a regex literal opened at `i` closes, past `\` escapes and the
// `[…]` classes that may hold a `/`; undefined where a line ends first.
function regexEnd(source: string, i: number): number | undefined {
  let inClass = false;
  for (let k = i + 1; k < source.length; k++) {
    const c = source[k];
    if (c === "\n") return undefined;
    if (c === "\\") k++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return k;
  }
  return undefined;
}

// The markup alone: `<script>`, `<style>` and every expression blanked.
function markupOf(source: string): string {
  // One pass, whichever opens first: a `<!--` in a script's string is
  // the script's, a `<script>` in a comment the comment's. A comment
  // holds no expression, and a `<Script>` component is no script block.
  const scriptless = source.replace(
    /<!--[\s\S]*?-->|<(script|style)(?=[\s>/])[^>]*>[\s\S]*?<\/\1\s*>/g,
    blank,
  );
  let out = "";
  let at = 0;
  for (let open = scriptless.indexOf("{"); open >= 0;) {
    const end = closing(scriptless, open);
    out += scriptless.slice(at, open) + gap(scriptless.slice(open, end + 1));
    at = end + 1;
    open = scriptless.indexOf("{", at);
  }
  return out + scriptless.slice(at);
}

export function findSvelteLiterals(
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  return literalsIn(markupOf(source), source, file, options);
}

// The findings in markup whose expressions are gaps, each at its line
// in `source`, which the markup keeps character for character: Svelte's
// and Handlebars' (#1027).
export function literalsIn(
  markup: string,
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  const lineAt = (offset: number) => source.slice(0, offset).split("\n").length;
  const silenced = new Set<number>();
  source.split("\n").forEach((line, index) => {
    if (line.includes("corpus-ignore")) silenced.add(index + 1).add(index + 2);
  });
  const findings: Finding[] = [];
  const report = (offset: number, raw: string) => {
    const text = raw.trim();
    if (!LETTERS.test(decoded(text))) return;
    if (isWholeUrl(text)) return;
    if (options.allow?.some((pattern) => pattern.test(text))) return;
    const line = lineAt(offset);
    if (silenced.has(line)) return;
    findings.push({ file, line, text });
  };
  // Each piece between expressions on its own, at its first character;
  // `raw` starts at `offset`.
  markupLiterals(markup, 0, (offset, raw) => {
    let at = 0;
    for (const piece of raw.split(new RegExp(`${GAP}+`))) {
      const start = raw.indexOf(piece, at);
      const lead = piece.length - piece.trimStart().length;
      if (piece.trim() !== "") report(offset + start + lead, piece);
      at = start + piece.length;
    }
  });
  return findings;
}
