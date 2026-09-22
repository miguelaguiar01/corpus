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

// A single-file component's blocks sit at the top level, which in
// practice means column zero: both ends are anchored there, so a
// `<template>` inside a script comment or a string does not start the
// block and a `</template>` inside an expression does not end it.
const BLOCK_OPEN = /^<template([^>]*)>/m;
const BLOCK_CLOSE = /^<\/template>/m;
// A template in another language is not HTML and this scanner would
// read its source as prose.
const NOT_HTML = /\blang\s*=\s*["']?(?!html)([a-z]+)/i;

function templateBlock(
  source: string,
): { body: string; offset: number } | null {
  const open = BLOCK_OPEN.exec(source);
  if (!open || open.index === undefined) return null;
  if (NOT_HTML.test(open[1] ?? "")) return null;
  const start = open.index + open[0].length;
  const rest = source.slice(start);
  // A closing tag at column zero ends the block. A component written on
  // one line has none, so the last closing tag stands in: the block is
  // the outermost, and a nested `<template v-if>` closes before it.
  const anchored = BLOCK_CLOSE.exec(rest);
  const end = anchored?.index ?? rest.lastIndexOf("</template>");
  if (end === undefined || end < 0) return null;
  return { body: rest.slice(0, end), offset: start };
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
    const raw = body
      .slice(textFrom, until)
      .replace(/\{\{[\s\S]*?\}\}/g, (match) => " ".repeat(match.length));
    const first = raw.search(/\S/);
    if (first !== -1) report(offset + textFrom + first, raw);
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
