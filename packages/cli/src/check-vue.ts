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

// A single-file component is a list of top-level blocks. They are
// found by walking the markup rather than by column or by a bare
// search: a `<template>` inside a `<script>` comment, a string, an
// HTML comment or a `<docs>` example must not become the block, and an
// indented one or a file with a byte-order mark must still be found.
const NOT_HTML = /(?:^|\s)lang\s*=\s*["']?(?!html\b)([a-z]+)/i;
// A block whose content is not markup: its closing tag ends it, and
// nothing inside is scanned for tags.
const RAW_BLOCKS = new Set(["script", "style", "docs", "i18n"]);

function skipComment(source: string, at: number): number {
  const end = source.indexOf("-->", at);
  return end === -1 ? source.length : end + 3;
}

function templateBlock(
  source: string,
): { body: string; offset: number } | null {
  let at = 0;
  while (at < source.length) {
    const lt = source.indexOf("<", at);
    if (lt === -1) return null;
    if (source.startsWith("<!--", lt)) {
      at = skipComment(source, lt);
      continue;
    }
    const tag = tagAt(source, lt);
    if (!tag || tag.closing) {
      at = tag ? tag.end : lt + 1;
      continue;
    }
    if (RAW_BLOCKS.has(tag.name)) {
      if (tag.selfClosing) {
        at = tag.end;
        continue;
      }
      const close = source.indexOf(`</${tag.name}`, tag.end);
      at = close === -1 ? source.length : close + tag.name.length + 2;
      continue;
    }
    if (tag.name !== "template" || tag.selfClosing) {
      at = tag.end;
      continue;
    }
    // A template in another language is not HTML, and this scanner
    // would read its source as prose.
    if (NOT_HTML.test(tag.attributes)) return null;
    const start = tag.end;
    let depth = 1;
    let scan = start;
    while (scan < source.length) {
      const next = source.indexOf("<", scan);
      if (next === -1) break;
      if (source.startsWith("<!--", next)) {
        scan = skipComment(source, next);
        continue;
      }
      const inner = tagAt(source, next);
      if (!inner) {
        scan = next + 1;
        continue;
      }
      if (inner.name === "template" && !inner.selfClosing) {
        depth += inner.closing ? -1 : 1;
        if (depth === 0)
          return { body: source.slice(start, next), offset: start };
      }
      scan = inner.end;
    }
    return null;
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
    // An interpolation is a catalogue call or an expression either way.
    // It is blanked rather than removed so every later character keeps
    // its offset, and the finding is reported at the first character of
    // the text rather than at the tag that preceded it.
    const slice = body.slice(textFrom, until);
    // Blanked for the offset, so every later character keeps the
    // position its line number comes from; collapsed for the text, so a
    // finding reads as the words around the interpolation.
    const blanked = slice.replace(/\{\{[\s\S]*?\}\}/g, (match) =>
      " ".repeat(match.length),
    );
    const first = blanked.search(/\S/);
    if (first === -1) return;
    report(offset + textFrom + first, slice.replace(/\{\{[\s\S]*?\}\}/g, " "));
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
      if (skip.length <= 1) {
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
