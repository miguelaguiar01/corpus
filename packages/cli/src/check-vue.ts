// The `<template>` half of `corpus check` for Vue single-file
// components (§3). A template is HTML, not a syntax tree the TypeScript
// parser can read, so this is a scanner over the markup: the same
// heuristic as the JSX pass, applied to the same two questions — is this
// text a person reads, and did it come from the catalogue.
//
// Known gaps, as in the JSX pass: a string built in `<script>` and bound
// with `:title` is the script's business, and text inside a slot is read
// as text wherever it sits.
import {
  decoded,
  LETTERS,
  USER_FACING_PROPS,
  type Finding,
  type FindOptions,
} from "./check";

// A catalogue call whose children are the key, as `Trans` is in React.
const CATALOGUE_ELEMENTS = new Set(["i18n-t", "i18n"]);
// Blocks whose content is never markup a person reads.
const OPAQUE = new Set(["script", "style", "pre", "code"]);

type Tag = {
  name: string;
  attributes: string;
  closing: boolean;
  selfClosing: boolean;
  end: number;
};

// `<name attrs>` from an offset that is on the `<`, or null when the
// angle bracket is text rather than a tag.
function tagAt(source: string, at: number): Tag | null {
  const match = /^<(\/?)([a-zA-Z][\w.-]*)/.exec(source.slice(at));
  if (!match) return null;
  let i = at + match[0].length;
  let quote = "";
  for (; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === ">") break;
  }
  const raw = source.slice(at + match[0].length, i);
  return {
    name: match[2]!.toLowerCase(),
    attributes: raw,
    closing: match[1] === "/",
    selfClosing: raw.trimEnd().endsWith("/"),
    end: i + 1,
  };
}

// Every `name="value"` in a tag's attribute text, with the offset of the
// value so a finding can carry the line it is on.
function* attributes(
  attrs: string,
  offset: number,
): Generator<{ name: string; value: string; at: number }> {
  const re = /([@:#]?[\w.:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(attrs)) !== null) {
    const value = match[3] ?? match[4] ?? "";
    yield {
      name: match[1]!,
      value,
      at: offset + match.index + match[0].indexOf(match[2]!) + 1,
    };
  }
}

// A bound attribute's value is an expression, as a JSX prop in braces is.
const BOUND = /^([:@#]|v-)/;

// The top-level `<template>` block, or null. Top-level blocks are not
// nested in one another, so depth counting finds the right closing tag
// even though templates nest inside the block.
function templateBlock(
  source: string,
): { body: string; offset: number } | null {
  const open = /<template(\s[^>]*)?>/i.exec(source);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  let depth = 1;
  let at = start;
  while (at < source.length && depth > 0) {
    const next = source.indexOf("<template", at);
    const close = source.indexOf("</template", at);
    if (close === -1) return null;
    if (next !== -1 && next < close) {
      depth += 1;
      at = next + 9;
      continue;
    }
    depth -= 1;
    if (depth === 0) return { body: source.slice(start, close), offset: start };
    at = close + 10;
  }
  return null;
}

export function findVueLiterals(
  source: string,
  file: string,
  options: FindOptions = {},
): Finding[] {
  const block = templateBlock(source);
  if (!block) return [];

  const lineAt = (offset: number) => source.slice(0, offset).split("\n").length;
  const silenced = new Set<number>();
  source.split("\n").forEach((line, index) => {
    if (line.includes("corpus-ignore")) silenced.add(index + 1).add(index + 2);
  });
  const findings: Finding[] = [];
  const report = (offset: number, raw: string) => {
    const text = raw.trim();
    if (!LETTERS.test(decoded(text))) return;
    if (options.allow?.some((pattern) => pattern.test(text))) return;
    const line = lineAt(offset);
    if (silenced.has(line)) return;
    findings.push({ file, line, text });
  };

  const { body, offset } = block;
  // Elements whose content is not text a person reads, by depth.
  const skip: string[] = [];
  let at = 0;
  let textFrom = 0;
  const flushText = (until: number) => {
    if (skip.length > 0) return;
    // An interpolation is a catalogue call or an expression either way;
    // what is left is the literal text around it.
    const raw = body.slice(textFrom, until).replace(/\{\{[\s\S]*?\}\}/g, " ");
    if (raw.trim()) report(offset + textFrom, raw);
  };
  while (at < body.length) {
    const lt = body.indexOf("<", at);
    if (lt === -1) break;
    if (body.startsWith("<!--", lt)) {
      flushText(lt);
      const end = body.indexOf("-->", lt);
      at = end === -1 ? body.length : end + 3;
      textFrom = at;
      continue;
    }
    const tag = tagAt(body, lt);
    if (!tag) {
      at = lt + 1;
      continue;
    }
    flushText(lt);
    if (tag.closing) {
      if (skip[skip.length - 1] === tag.name) skip.pop();
    } else {
      if (
        !tag.selfClosing &&
        (CATALOGUE_ELEMENTS.has(tag.name) || OPAQUE.has(tag.name))
      ) {
        skip.push(tag.name);
      }
      if (skip.length === 0 || skip.length === 1) {
        for (const attribute of attributes(
          tag.attributes,
          offset + lt + tag.name.length + 1,
        )) {
          if (BOUND.test(attribute.name)) continue;
          if (!USER_FACING_PROPS.has(attribute.name.toLowerCase())) continue;
          report(attribute.at, attribute.value);
        }
      }
    }
    at = tag.end;
    textFrom = at;
  }
  flushText(body.length);
  return findings;
}
