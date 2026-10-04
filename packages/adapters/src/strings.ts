import type { StringEntry } from "@corpus/contract";
import type { SourceOp } from "./write";

// Apple's old-style plist string table, `Localizable.strings` (#1037):
// `"key" = "value";` pairs, quoted or bare, between `/* */` and `//`
// comments. The comment directly above a key, as genstrings writes it,
// is the string's note.

type Pair = {
  key: string;
  value: string;
  note?: string;
  // Where the entry's text begins, its note included, and where its line
  // ends: a removal takes both.
  start: number;
  end: number;
  // The value's token, quotes included.
  valueStart: number;
  valueEnd: number;
};

// What genstrings writes for a string the code gives no comment.
const NO_COMMENT = /^No comment provided by engineer\.?$/i;
const BARE = /[A-Za-z0-9_.$:/-]/;

export function parseStrings(text: string): Pair[] {
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  let at = text.startsWith("\uFEFF") ? 1 : 0;
  // The last comment and where it ended, while only space follows it.
  let comment: { text: string; start: number; end: number } | undefined;
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length;
  const fail = (message: string, offset: number): never => {
    throw new Error(`strings: line ${lineOf(offset)}: ${message}`);
  };

  const space = () => {
    for (;;) {
      const start = at;
      while (at < text.length && /\s/.test(text[at]!)) at++;
      const gap = text.slice(start, at);
      // A blank line parts a comment from the entry below it.
      if (comment && (gap.match(/\n/g)?.length ?? 0) > 1) comment = undefined;
      if (text.startsWith("/*", at)) {
        const close = text.indexOf("*/", at + 2);
        if (close < 0) fail("a /* comment that never closes", at);
        const body = text.slice(at + 2, close).trim();
        comment = comment
          ? {
              text: `${comment.text}\n${body}`,
              start: comment.start,
              end: close + 2,
            }
          : { text: body, start: at, end: close + 2 };
        at = close + 2;
      } else if (text.startsWith("//", at)) {
        const eol = text.indexOf("\n", at);
        const stop = eol < 0 ? text.length : eol;
        const body = text.slice(at + 2, stop).trim();
        // Consecutive comment lines are one note; a blank line has
        // already parted an earlier one.
        comment = comment
          ? {
              text: `${comment.text}\n${body}`,
              start: comment.start,
              end: stop,
            }
          : { text: body, start: at, end: stop };
        at = stop;
      } else return;
    }
  };

  const token = (): { value: string; start: number; end: number } => {
    const start = at;
    if (text[at] === '"') {
      let value = "";
      at++;
      for (;;) {
        if (at >= text.length) fail("a string that never closes", start);
        const c = text[at]!;
        if (c === '"') break;
        if (c === "\\") {
          const next = text[at + 1];
          if (next === undefined) fail("a string that never closes", start);
          if (next === "U" || next === "u") {
            const hex = text.slice(at + 2, at + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex))
              fail(`\\${next} takes four hex digits`, at);
            value += String.fromCharCode(parseInt(hex, 16));
            at += 6;
            continue;
          }
          value +=
            { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "'": "'" }[
              next!
            ] ?? next;
          at += 2;
          continue;
        }
        value += c;
        at++;
      }
      at++;
      return { value, start, end: at };
    }
    while (at < text.length && BARE.test(text[at]!)) at++;
    if (at === start) fail(`unexpected ${JSON.stringify(text[at])}`, at);
    return { value: text.slice(start, at), start, end: at };
  };

  for (;;) {
    space();
    if (at >= text.length) break;
    const note = comment;
    comment = undefined;
    const key = token();
    space();
    let value = key;
    if (text[at] === "=") {
      at++;
      space();
      value = token();
      space();
    }
    if (text[at] !== ";") fail(`${JSON.stringify(key.value)} lacks its ;`, at);
    at++;
    if (seen.has(key.value))
      fail(`${JSON.stringify(key.value)} is written twice`, key.start);
    seen.add(key.value);
    // The rest of the line, a trailing // tag included, is the entry's.
    const eol = text.indexOf("\n", at);
    const rest = text.slice(at, eol < 0 ? text.length : eol);
    const end = /^\s*(\/\/.*)?\r?$/.test(rest)
      ? eol < 0
        ? text.length
        : eol + 1
      : at;
    comment = undefined;
    pairs.push({
      key: key.value,
      value: value.value,
      ...(note &&
        !NO_COMMENT.test(note.text) &&
        note.text !== "" && {
          note: note.text,
        }),
      start: lineStart(text, note ? note.start : key.start),
      end,
      valueStart: value.start,
      valueEnd: value.end,
    });
    if (end > at) at = end;
  }
  return pairs;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

export function stringsToEntries(
  text: string,
  options: { type: string },
): StringEntry[] {
  return parseStrings(text).map((pair) => ({
    id: pair.key,
    type: options.type,
    source: pair.value,
    ...(pair.note && { note: pair.note }),
  }));
}

export function stringsTranslations(text: string): StringEntry[] {
  return parseStrings(text).map((pair) => ({
    id: pair.key,
    type: "",
    source: pair.value,
  }));
}

function quote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// A pull (§8): each changed value rewritten in place, every other byte
// kept; a key the file lacks goes after the nearest key before it in the
// source; a new file is the source's, its values the translations where
// there are some, as Xcode writes every key into each language.
export function entriesToStrings(
  template: string,
  translations: Record<string, string>,
  existing?: string,
): string {
  const fresh = existing === undefined || existing.trim() === "";
  let text = fresh ? template : existing;
  const pairs = parseStrings(text);
  const held = new Map(pairs.map((p) => [p.key, p]));
  // Back to front, so earlier offsets hold.
  for (const pair of [...pairs].reverse()) {
    if (!Object.hasOwn(translations, pair.key)) continue;
    const next = translations[pair.key]!;
    if (next === pair.value) continue;
    text =
      text.slice(0, pair.valueStart) + quote(next) + text.slice(pair.valueEnd);
  }
  const order = parseStrings(template).map((p) => p.key);
  const eol = eolOf(text);
  for (const [key, value] of Object.entries(translations)) {
    if (held.has(key)) continue;
    const line = `${quote(key)} = ${quote(value)};`;
    const current = parseStrings(text);
    const index = order.indexOf(key);
    const before = order
      .slice(0, Math.max(index, 0))
      .reverse()
      .map((k) => current.find((p) => p.key === k))
      .find((p) => p !== undefined);
    if (before) {
      const at = before.end;
      const lineEnd = text.slice(0, at).endsWith("\n") ? "" : eol;
      text = text.slice(0, at) + lineEnd + line + eol + text.slice(at);
    } else {
      const last = current.at(-1);
      const at = last ? last.end : text.length;
      const lead = at > 0 && !text.slice(0, at).endsWith("\n") ? eol : "";
      text = text.slice(0, at) + lead + line + eol + text.slice(at);
    }
  }
  return text;
}

// Proposals into the source file (§8, §11).
export function applyStringsOps(text: string, ops: SourceOp[]): string {
  let out = text;
  const eol = eolOf(text);
  for (const op of ops) {
    const pair = parseStrings(out).find((p) => p.key === op.id);
    if (op.kind === "delete") {
      if (pair) out = out.slice(0, pair.start) + out.slice(pair.end);
    } else if (pair) {
      out =
        out.slice(0, pair.valueStart) +
        quote(op.text) +
        out.slice(pair.valueEnd);
    } else {
      const lead = out.length > 0 && !out.endsWith("\n") ? eol : "";
      out = `${out}${lead}${quote(op.id)} = ${quote(op.text)};${eol}`;
    }
  }
  return out;
}
