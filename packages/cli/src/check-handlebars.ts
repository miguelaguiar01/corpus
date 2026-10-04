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

// The markup alone: comments, `<script>`, `<style>`, `{{#tr}}` blocks
// and every expression blanked or made a gap, each character kept so a
// finding keeps its line.
function markupOf(source: string): string {
  const quiet = source.replace(
    /\{\{~?!--[\s\S]*?--~?\}\}|\{\{~?![\s\S]*?\}\}|<!--[\s\S]*?-->|<(script|style)(?=[\s>/])[^>]*>[\s\S]*?<\/\1\s*>/g,
    blank,
  );
  return withoutTr(quiet).replace(
    /\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}/g,
    gap,
  );
}

export function findHandlebarsLiterals(
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  return literalsIn(markupOf(source), source, file, options);
}
