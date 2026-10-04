// `corpus check` for Handlebars templates (§3, #1027), as Zulip writes
// them. Text outside `{{…}}` is text; `{{…}}`, `{{{…}}}` and a block's
// tags are expressions, and `{{!…}}` and `{{!--…--}}` are comments. The
// catalogue's calls are Zulip's, as its makemessages extracts them:
// `{{t "…"}}`, an expression like any other, and a `{{#tr}}…{{/tr}}`
// block, whose content is the key, as `Trans`'s children are. What is
// left is HTML, read as a Svelte component's markup is.
//
// Known gap, as for Vue: a string a helper or a partial builds is its
// code's.
import type { Finding, FindOptions } from "./check";
import { blank, gap, literalsIn } from "./check-svelte";

// A block's open or close, `~` whitespace control allowed.
const TR = /\{\{~?\s*([#/])\s*tr\b[^}]*\}\}/g;

// Every `{{#tr}}` block, nested ones in it, as one gap: its content is a
// catalogue key, never text.
function withoutTr(source: string): string {
  let out = "";
  let at = 0;
  let depth = 0;
  let from = 0;
  for (const match of source.matchAll(TR)) {
    if (match[1] === "#") {
      if (depth === 0) {
        out += source.slice(at, match.index);
        from = match.index;
      }
      depth += 1;
    } else if (depth > 0 && --depth === 0) {
      const end = match.index + match[0].length;
      out += gap(source.slice(from, end));
      at = end;
    }
  }
  // An unclosed block runs to the end, as Handlebars would refuse it.
  return depth > 0 ? out + gap(source.slice(from)) : out + source.slice(at);
}

// Where the mustache that opens at `at` ends, past `}}` in the strings
// it holds, an ICU plural in Zulip's `{{t "…"}}` among them: after its
// `}}`, or `}}}` for a triple one; the text's end where it never closes.
function mustacheEnd(source: string, at: number): number {
  const close = source.startsWith("{{{", at) ? "}}}" : "}}";
  for (let i = at + close.length; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < source.length && source[end] !== ch)
        end += source[end] === "\\" ? 2 : 1;
      i = end;
    } else if (source.startsWith(close, i)) return i + close.length;
  }
  return source.length;
}

// Every mustache a gap.
function gapped(source: string): string {
  let out = "";
  let at = 0;
  for (let open = source.indexOf("{{"); open >= 0;) {
    const end = mustacheEnd(source, open);
    out += source.slice(at, open) + gap(source.slice(open, end));
    at = end;
    open = source.indexOf("{{", at);
  }
  return out + source.slice(at);
}

// The markup alone: comments, `<script>`, `<style>`, `{{#tr}}` blocks
// and every expression blanked or made a gap, each character kept so a
// finding keeps its line.
function markupOf(source: string): string {
  const quiet = source.replace(
    /\{\{~?!--[\s\S]*?--~?\}\}|\{\{~?![\s\S]*?\}\}|<!--[\s\S]*?-->|<(script|style)(?=[\s>/])[^>]*>[\s\S]*?<\/\1\s*>/g,
    blank,
  );
  return gapped(withoutTr(quiet));
}

export function findHandlebarsLiterals(
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  return literalsIn(markupOf(source), source, file, options);
}
