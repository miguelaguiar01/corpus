import type { StringEntry } from "@corpus/contract";
import type { SourceOp } from "./write";
import { applied, eolOf, type Patch } from "./text";

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
  // The value's token, quotes included; a `"key";` alone has none, its
  // key its value, and a value goes in after the key.
  valueStart: number;
  valueEnd: number;
  shorthand: boolean;
  keyEnd: number;
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
          // As CoreFoundation reads them: up to three octal digits, \U and
          // up to four hex digits, the C letters; any other character is
          // itself, a lowercase \u a u.
          const next = text[at + 1];
          if (next === undefined) fail("a string that never closes", start);
          const octal = /^[0-7]{1,3}/.exec(text.slice(at + 1, at + 4));
          if (octal) {
            value += String.fromCharCode(parseInt(octal[0], 8));
            at += 1 + octal[0].length;
            continue;
          }
          if (next === "U") {
            const hex = /^[0-9a-fA-F]{0,4}/.exec(
              text.slice(at + 2, at + 6),
            )![0];
            value += String.fromCharCode(hex ? parseInt(hex, 16) : 0);
            at += 2 + hex.length;
            continue;
          }
          value +=
            (
              {
                a: "\x07",
                b: "\b",
                f: "\f",
                n: "\n",
                r: "\r",
                t: "\t",
                v: "\v",
              } as Record<string, string>
            )[next!] ?? next;
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
    // The rest of the line, a trailing comment included, is the entry's;
    // where another pair follows on it, the entry ends at its ;.
    const eol = text.indexOf("\n", at);
    const rest = text.slice(at, eol < 0 ? text.length : eol);
    const end = /^\s*(?:\/\*.*?\*\/\s*)*(?:\/\/.*)?\r?$/.test(rest)
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
      // A pair earlier on the same line is never part of this one.
      start: Math.max(
        lineStart(text, note ? note.start : key.start),
        // A byte-order mark is the file's, never the first pair's.
        pairs.at(-1)?.end ?? (text.startsWith("\uFEFF") ? 1 : 0),
      ),
      end,
      valueStart: value.start,
      valueEnd: value.end,
      shorthand: value === key,
      keyEnd: key.end,
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

// A value written into a pair: in place of its value, or, for a
// `"key";` alone, after its key, so the key stays the key.
function valuePatch(pair: Pair, value: string): Patch {
  return pair.shorthand
    ? { start: pair.keyEnd, end: pair.keyEnd, text: ` = ${quote(value)}` }
    : { start: pair.valueStart, end: pair.valueEnd, text: quote(value) };
}

// A pull (§8): each changed value rewritten in place, every other byte
// kept; a key the file lacks goes after the nearest key before it in the
// source the file holds, or before the nearest after it; a new file is
// the source's, its values the translations where there are some, as
// Xcode writes every key into each language. One parse, one pass.
export function entriesToStrings(
  template: string,
  translations: Record<string, string>,
  existing?: string,
): string {
  const fresh = existing === undefined || existing.trim() === "";
  const text = fresh ? template : existing;
  const pairs = parseStrings(text);
  const held = new Map(pairs.map((p) => [p.key, p]));
  const patches: Patch[] = [];
  for (const pair of pairs) {
    if (!Object.hasOwn(translations, pair.key)) continue;
    const next = translations[pair.key]!;
    if (next !== pair.value) patches.push(valuePatch(pair, next));
  }
  const eol = eolOf(text);
  const order = parseStrings(template).map((p) => p.key);
  const inOrder = new Set(order);
  const keys = [
    ...order,
    ...Object.keys(translations).filter((k) => !inOrder.has(k)),
  ];
  // The lines each missing key goes at, by offset, in the source's order.
  const after = new Map<number, string[]>();
  const before = new Map<number, string[]>();
  let anchor: Pair | undefined;
  const pending: string[] = [];
  for (const key of keys) {
    const pair = held.get(key);
    if (pair) {
      // Keys before the first held one go before it.
      if (!anchor && pending.length > 0)
        before.set(pair.start, pending.splice(0));
      anchor = pair;
      continue;
    }
    if (!Object.hasOwn(translations, key)) continue;
    const line = `${quote(key)} = ${quote(translations[key]!)};`;
    if (!anchor) pending.push(line);
    else if (after.has(anchor.end)) after.get(anchor.end)!.push(line);
    else after.set(anchor.end, [line]);
  }
  const last = pairs.at(-1)?.end ?? text.length;
  if (pending.length > 0)
    after.set(last, [...(after.get(last) ?? []), ...pending]);
  for (const [at, lines] of after) {
    const lead = at === 0 || text[at - 1] === "\n" ? "" : eol;
    patches.push({ start: at, end: at, text: lead + lines.join(eol) + eol });
  }
  for (const [at, lines] of before)
    patches.push({ start: at, end: at, text: lines.join(eol) + eol });
  return applied(text, patches);
}

// Proposals into the source file (§8, §11).
export function applyStringsOps(text: string, ops: SourceOp[]): string {
  let out = text;
  const eol = eolOf(text);
  for (const op of ops) {
    const pair = parseStrings(out).find((p) => p.key === op.id);
    if (op.kind === "delete") {
      if (!pair) continue;
      // A pair after another on its line leaves that line its ending.
      const from = Math.max(
        lineStart(out, pair.start),
        out.startsWith("\uFEFF") ? 1 : 0,
      );
      const shared = pair.start > from;
      const ending = /\r?\n$/.exec(out.slice(pair.start, pair.end))?.[0] ?? "";
      out =
        out.slice(0, pair.start) +
        out.slice(shared ? pair.end - ending.length : pair.end);
    } else if (pair) {
      out = applied(out, [valuePatch(pair, op.text)]);
    } else {
      const lead = out.length > 0 && !out.endsWith("\n") ? eol : "";
      out = `${out}${lead}${quote(op.id)} = ${quote(op.text)};${eol}`;
    }
  }
  return out;
}
