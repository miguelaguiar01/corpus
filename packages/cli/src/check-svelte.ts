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

const blank = (text: string) => text.replace(/[^\n]/g, " ");
// An expression's place, kept so it divides the text around it as a JSX
// expression does: `{n}% - {speed}/s` is no words (#1025).
const GAP = "\u0001";
const gap = (text: string) => text.replace(/[^\n]/g, GAP);

// The `}` that closes the `{` at `at`, past nested braces and the
// strings an expression holds; the text's end where none does.
function closing(source: string, at: number): number {
  let depth = 0;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = source.indexOf(ch, i + 1);
      if (end < 0) return source.length - 1;
      i = end;
    } else if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return i;
  }
  return source.length - 1;
}

// The markup alone: `<script>`, `<style>` and every expression blanked.
function markupOf(source: string): string {
  const scriptless = source.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
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
  // Each piece between expressions on its own, at its first character.
  markupLiterals(markupOf(source), 0, (offset, raw) => {
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
