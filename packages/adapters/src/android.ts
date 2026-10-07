// Android string resources (§3, #596). Text is what the app shows, aapt's
// escapes undone on read and written back on change; a file is patched
// element by element, so an unchanged pull writes the same bytes.
import {
  PLURAL_CATEGORIES,
  proseTagsOf,
  type StringEntry,
} from "@corpus/contract";
import { pluralFrom } from "./messages";
import type { SourceOp } from "./write";

type Span = { start: number; end: number };
type Element = Span & {
  kind: "string" | "plurals";
  name: string;
  // Absent for `<string name="x"/>`.
  inner?: Span;
};
type Item = Span & { quantity: string; raw: Span };
type Patch = Span & { text: string };

const SKELETON = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`;
const CDATA_RE = /^<!\[CDATA\[([\s\S]*)\]\]>$/;
// Markup inside a string, `<b>`, `</b>`, `<xliff:g id="x">`: kept as
// written, its quotes are not aapt's.
const MARKUP_RE = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>/g;

function masked(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=(["'])(.*?)\\1`).exec(attrs)?.[2];
}

function elements(xml: string): Element[] {
  const text = masked(xml);
  const out: Element[] = [];
  const re =
    /<string(?=[\s/>])([^>]*?)(\/>|>([\s\S]*?)<\/string>)|<plurals(?=[\s>])([^>]*)>([\s\S]*?)<\/plurals>/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const plural = m[4] !== undefined;
    const attrs = (plural ? m[4] : m[1]) ?? "";
    const name = attr(attrs, "name");
    if (name === undefined || attr(attrs, "translatable") === "false") continue;
    // A product variant (`product="tablet"`) stays as written; the
    // default is the string.
    const product = attr(attrs, "product");
    if (product !== undefined && product !== "default") continue;
    const openEnd = text.indexOf(">", m.index) + 1;
    const inner =
      !plural && m[2] === "/>"
        ? undefined
        : {
            start: openEnd,
            end: re.lastIndex - (plural ? "</plurals>" : "</string>").length,
          };
    if (
      inner &&
      !plural &&
      /^@(?:android:)?string\//.test(xml.slice(inner.start, inner.end).trim())
    )
      continue;
    out.push({
      kind: plural ? "plurals" : "string",
      name,
      start: m.index,
      end: re.lastIndex,
      ...(inner && { inner }),
    });
  }
  return out;
}

function items(xml: string, element: Element): Item[] {
  if (!element.inner) return [];
  const { start: base } = element.inner;
  const body = masked(xml).slice(base, element.inner.end);
  const out: Item[] = [];
  const re = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const quantity = attr(m[1] ?? "", "quantity");
    if (quantity === undefined) continue;
    const start = base + m.index;
    const end = start + m[0].length;
    out.push({
      quantity,
      start,
      end,
      raw: {
        start: start + m[0].indexOf(">") + 1,
        end: end - "</item>".length,
      },
    });
  }
  return out;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    lt: "<",
    gt: ">",
    amp: "&",
    quot: '"',
    apos: "'",
  };
  return text.replace(
    /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (all, name: string) => {
      if (name in named) return named[name]!;
      const code =
        name[1] === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : all;
    },
  );
}

// An element's content as aapt parses it: its markup, the tags written
// with a literal `<` (in a CDATA section too, as Html.fromHtml's markup
// is written there), kept as written, and its text, entities and CDATA
// sections, inline ones included, decoded, so `&lt;Unknown&gt;` is text
// whose quotes and backslashes are aapt's (#987).
function pieces(raw: string): { text: string; markup: boolean }[] {
  const out: { text: string; markup: boolean }[] = [];
  const markup = new RegExp(MARKUP_RE.source, "y");
  let text = "";
  const flush = () => {
    if (text) out.push({ text: decodeEntities(text), markup: false });
    text = "";
  };
  for (let i = 0; i < raw.length;) {
    if (raw.startsWith("<![CDATA[", i)) {
      const end = raw.indexOf("]]>", i + 9);
      if (end >= 0) {
        flush();
        const body = raw.slice(i + 9, end);
        let at = 0;
        for (const tag of body.matchAll(MARKUP_RE)) {
          if (tag.index > at)
            out.push({ text: body.slice(at, tag.index), markup: false });
          out.push({ text: tag[0], markup: true });
          at = tag.index + tag[0].length;
        }
        if (at < body.length) out.push({ text: body.slice(at), markup: false });
        i = end + 3;
        continue;
      }
    }
    if (raw[i] === "<") {
      markup.lastIndex = i;
      const tag = markup.exec(raw);
      if (tag) {
        flush();
        out.push({ text: decodeEntities(tag[0]), markup: true });
        i += tag[0].length;
        continue;
      }
    }
    text += raw[i];
    i++;
  }
  flush();
  return out;
}

// aapt's reading: a backslash escapes the next character, a double
// quote toggles a run whose whitespace is kept, and outside one a run
// of ASCII whitespace is one space, trimmed at the ends; markup is kept
// as written.
function unescape(parts: { text: string; markup: boolean }[]): string {
  const out: { ch: string; kept: boolean }[] = [];
  let quoted = false;
  type Unit = { tag: string } | { ch: string };
  const units: Unit[] = parts.flatMap(({ text, markup }): Unit[] =>
    markup ? [{ tag: text }] : [...text].map((ch) => ({ ch })),
  );
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if ("tag" in unit) {
      for (const c of unit.tag) out.push({ ch: c, kept: true });
      continue;
    }
    const ch = unit.ch;
    const at = (n: number) => {
      const u = units[n];
      return u && "ch" in u ? u.ch : undefined;
    };
    if (ch === "\\" && at(i + 1) !== undefined) {
      const next = at(++i)!;
      const hex = [1, 2, 3, 4].map((n) => at(i + n) ?? "").join("");
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(hex)) {
        out.push({ ch: String.fromCharCode(parseInt(hex, 16)), kept: true });
        i += 4;
      } else {
        const escaped: Record<string, string> = { n: "\n", t: "\t" };
        out.push({ ch: escaped[next] ?? next, kept: true });
      }
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /[ \t\r\n]/.test(ch)) {
      const last = out.at(-1);
      if (last && last.ch === " " && !last.kept) continue;
      out.push({ ch: " ", kept: false });
      continue;
    }
    out.push({ ch, kept: quoted });
  }
  while (out[0] && !out[0].kept && out[0].ch === " ") out.shift();
  while (out.at(-1) && !out.at(-1)!.kept && out.at(-1)!.ch === " ") out.pop();
  return out.map((c) => c.ch).join("");
}

function decode(raw: string): string {
  return unescape(pieces(raw));
}

function escapeText(text: string, cdata: boolean): string {
  const out = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
  return cdata ? out : out.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// How an element writes its tags: as markup, or escaped, `&lt;b>`, as
// Html.fromHtml's idiom has it; none where it writes no tag (#987).
type Tags = "raw" | "escaped";

function tagsOf(raw: string): Tags | undefined {
  const outside = raw.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  if (new RegExp(MARKUP_RE.source).test(outside)) return "raw";
  // An escaped close is an escaped pair's; `&lt;Unknown&gt;` alone is
  // prose, which says nothing of how the element writes its tags.
  if (/&lt;\/[A-Za-z]/.test(outside)) return "escaped";
  return undefined;
}

// The tags `text` may write as XML elements: one closed on itself, or a
// pair that nests; any other would leave the file ill-formed (`<br>`,
// an unclosed `<xliff:g>`), so it is escaped.
function wellFormed(text: string): Set<number> {
  const out = new Set<number>();
  const open: { name: string; at: number }[] = [];
  for (const tag of text.matchAll(MARKUP_RE)) {
    const name = /^<\/?([^\s/>]+)/.exec(tag[0])![1]!;
    if (tag[0].endsWith("/>")) out.add(tag.index);
    else if (tag[0].startsWith("</")) {
      let at = open.length - 1;
      while (at >= 0 && open[at]!.name !== name) at--;
      if (at < 0) continue;
      // The pair closes; what opened inside it and never closed stays out.
      out.add(open[at]!.at);
      out.add(tag.index);
      open.length = at;
    } else open.push({ name, at: tag.index });
  }
  return out;
}

// A tag the text reads as prose, `<Unknown Recipient>`, is text, escaped
// as text is, or it would be an XML element no one closes; a pair is
// markup, written as `tags` says (#987).
function escape(text: string, cdata: boolean, tags: Tags = "raw"): string {
  const prose = new Set(proseTagsOf(text, "android").map((t) => t.at));
  const elements = wellFormed(text);
  let out = "";
  let at = 0;
  for (const tag of text.matchAll(MARKUP_RE)) {
    // A prose tag's text as Android writes it, `&lt;…&gt;`, and so any
    // tag XML cannot hold as an element; an escaped pair's as
    // Html.fromHtml's idiom does, `&lt;b>`.
    const markup = cdata
      ? tag[0]
      : prose.has(tag.index) || !elements.has(tag.index)
        ? escapeText(tag[0], false).replace(/>/g, "&gt;")
        : tags === "escaped"
          ? escapeText(tag[0], false)
          : tag[0].replace(/&(?!(?:[A-Za-z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
    out += escapeText(text.slice(at, tag.index), cdata) + markup;
    at = tag.index + tag[0].length;
  }
  out += escapeText(text.slice(at), cdata);
  if (/^[@?]/.test(out)) out = `\\${out}`;
  if (/^ | $| {2}/.test(out)) out = `"${out}"`;
  return cdata ? `<![CDATA[${out}]]>` : out;
}

const slice = (xml: string, span: Span) => xml.slice(span.start, span.end);
const isCdata = (raw: string) => CDATA_RE.test(raw.trim());

// A `<plurals>` as one ICU plural on `quantity`, its items as the file
// writes them.
function pluralOf(xml: string, element: Element): string {
  return pluralFrom(
    "quantity",
    items(xml, element).map((item) => [
      item.quantity,
      decode(slice(xml, item.raw)),
    ]),
  );
}

const PLURAL_HEAD_RE = /^\{\s*[A-Za-z_]\w*\s*,\s*plural\s*,/;

// An ICU plural's branches, their text raw; a text that is not one is a
// single `other`.
function pluralBranches(text: string): Map<string, string> {
  const head = PLURAL_HEAD_RE.exec(text.trim());
  if (!head) return new Map([["other", text]]);
  const body = text.trim().slice(head[0].length, -1);
  const out = new Map<string, string>();
  const re = /\s*(=?\w+)\s*\{/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let depth = 1;
    let at = re.lastIndex;
    while (at < body.length && depth > 0) {
      if (body[at] === "{") depth++;
      else if (body[at] === "}") depth--;
      at++;
    }
    out.set(m[1]!, body.slice(re.lastIndex, at - 1));
    re.lastIndex = at;
  }
  return out;
}

export function androidToEntries(
  xml: string,
  options: { type: string },
): StringEntry[] {
  return elements(xml).map((element) => ({
    id: element.name,
    type: options.type,
    source:
      element.kind === "plurals"
        ? pluralOf(xml, element)
        : element.inner
          ? decode(slice(xml, element.inner))
          : "",
    ...(element.kind === "plurals" && { pluralAsForms: true }),
  }));
}

function lineStart(xml: string, at: number): number {
  return xml.lastIndexOf("\n", at - 1) + 1;
}

function indentAt(xml: string, at: number): string {
  return /^[ \t]*/.exec(xml.slice(lineStart(xml, at), at))?.[0] ?? "";
}

// The span to remove for an element or item: its whole line when it is
// alone on it.
function lineOf(xml: string, span: Span): Span {
  const start = lineStart(xml, span.start);
  const newline = xml.indexOf("\n", span.end);
  const end = newline < 0 ? xml.length : newline + 1;
  const alone =
    xml.slice(start, span.start).trim() === "" &&
    xml.slice(span.end, end).trim() === "";
  return alone ? { start, end } : span;
}

type Style = { unit: string; eol: string };

function styleOf(xml: string): Style {
  const last = elements(xml).at(-1);
  return {
    unit: (last && indentAt(xml, last.start)) || "    ",
    eol: xml.includes("\r\n") ? "\r\n" : "\n",
  };
}

function renderItem(
  indent: string,
  quantity: string,
  text: string,
  cdata: boolean,
  tags?: Tags,
) {
  return `${indent}<item quantity="${quantity}">${escape(text, cdata, tags)}</item>`;
}

function render(
  id: string,
  text: string,
  kind: Element["kind"],
  { unit, eol }: Style,
  tags?: Tags,
): string {
  if (kind === "string")
    return `${unit}<string name="${id}">${escape(text, false, tags)}</string>`;
  const itemLines = [...pluralBranches(text)].map(([q, t]) =>
    renderItem(unit + unit, q, t, false, tags),
  );
  return `${unit}<plurals name="${id}">${eol}${itemLines.join(eol)}${eol}${unit}</plurals>`;
}

// An element's tags as the element writes them, else as the source's.
function stringPatches(
  xml: string,
  element: Element,
  text: string,
  tags?: Tags,
): Patch[] {
  if (!element.inner) {
    if (text === "") return [];
    const open = slice(xml, element).replace(/\s*\/>$/, "");
    return [
      { ...element, text: `${open}>${escape(text, false, tags)}</string>` },
    ];
  }
  const raw = slice(xml, element.inner);
  if (decode(raw) === text) return [];
  return [
    { ...element.inner, text: escape(text, isCdata(raw), tagsOf(raw) ?? tags) },
  ];
}

// A plural's items patched one by one, so comments between them and
// their order stay; a new quantity goes after the last item before it
// in CLDR order.
function pluralPatches(
  xml: string,
  element: Element,
  text: string,
  { unit, eol }: Style,
  tags?: Tags,
): Patch[] {
  if (pluralOf(xml, element) === text) return [];
  const own =
    items(xml, element)
      .map((item) => tagsOf(slice(xml, item.raw)))
      .find((t) => t !== undefined) ?? tags;
  const old = items(xml, element);
  const wanted = pluralBranches(text);
  const cdata = old.some((item) => isCdata(slice(xml, item.raw)));
  const indent = old[0]
    ? indentAt(xml, old[0].start)
    : indentAt(xml, element.start) + unit;
  const patches: Patch[] = [];
  for (const item of old) {
    const next = wanted.get(item.quantity);
    if (next === undefined) {
      patches.push({ ...lineOf(xml, item), text: "" });
    } else if (decode(slice(xml, item.raw)) !== next) {
      patches.push({
        ...item.raw,
        text: escape(next, isCdata(slice(xml, item.raw)), own),
      });
    }
  }
  const rank = (q: string) => {
    const at = (PLURAL_CATEGORIES as readonly string[]).indexOf(q);
    return at < 0 ? PLURAL_CATEGORIES.length - 1.5 : at;
  };
  const added = [...wanted]
    .filter(([q]) => !old.some((item) => item.quantity === q))
    .sort(([a], [b]) => rank(a) - rank(b));
  const inserts = new Map<number, string[]>();
  for (const [quantity, branch] of added) {
    const before = old.filter((item) => rank(item.quantity) < rank(quantity));
    const line = renderItem(indent, quantity, branch, cdata, own);
    if (before.length > 0) {
      const at = before.at(-1)!.end;
      inserts.set(at, [...(inserts.get(at) ?? []), `${eol}${line}`]);
    } else if (old[0]) {
      const at = lineStart(xml, old[0].start);
      inserts.set(at, [...(inserts.get(at) ?? []), `${line}${eol}`]);
    } else {
      const at = element.inner!.start;
      inserts.set(at, [...(inserts.get(at) ?? []), `${eol}${line}`]);
    }
  }
  for (const [at, texts] of inserts)
    patches.push({ start: at, end: at, text: texts.join("") });
  return patches;
}

function applyPatches(xml: string, patches: Patch[]): string {
  let out = xml;
  for (const patch of [...patches].sort((a, b) => b.start - a.start))
    out = out.slice(0, patch.start) + patch.text + out.slice(patch.end);
  return out;
}

// Every change against one reading of the file: the elements that
// exist are patched in place, the rest appended before </resources>.
// A plural no <plurals> can hold is refused and its element left; one
// the element already holds is no change, whatever its items' braces.
function patchAll(
  xml: string,
  changes: {
    id: string;
    text?: string;
    kind?: Element["kind"];
    // How the source's element writes its tags.
    tags?: Tags;
  }[],
  onRefused: (id: string, text: string) => void,
): string {
  const style = styleOf(xml);
  const byName = new Map<string, Element>();
  for (const element of elements(xml))
    if (!byName.has(element.name)) byName.set(element.name, element);
  const patches: Patch[] = [];
  const appended: string[] = [];
  for (const { id, text, kind, tags } of changes) {
    const element = byName.get(id);
    const as =
      element?.kind ??
      kind ??
      (text !== undefined && PLURAL_HEAD_RE.test(text.trim())
        ? "plurals"
        : "string");
    if (text === undefined) {
      if (element) patches.push({ ...lineOf(xml, element), text: "" });
    } else if (
      as === "plurals" &&
      !(element && pluralOf(xml, element) === text) &&
      !holdable(text)
    ) {
      onRefused(id, text);
    } else if (element?.kind === "plurals") {
      patches.push(...pluralPatches(xml, element, text, style, tags));
    } else if (element) {
      patches.push(...stringPatches(xml, element, text, tags));
    } else {
      appended.push(render(id, text, as, style, tags));
    }
  }
  if (appended.length > 0) {
    const close = xml.lastIndexOf("</resources>");
    if (close < 0) throw new Error("android: file has no </resources>");
    const at = lineStart(xml, close);
    patches.push({
      start: at,
      end: at,
      text: appended.map((line) => line + style.eol).join(""),
    });
  }
  return applyPatches(xml, patches);
}

// aapt2 compiles a quantity CLDR names and no other: an `=N` branch
// has no item to go in.
function holdable(text: string): boolean {
  return [...pluralBranches(text).keys()].every((q) =>
    (PLURAL_CATEGORIES as readonly string[]).includes(q),
  );
}

// A target file from the translations: the existing file patched, or,
// when there is none, a bare <resources> filled in the source's order.
// Ids the translations do not mention are kept.
export function entriesToAndroid(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  onRefused: (id: string, text: string) => void = () => {},
): string {
  const xml =
    existing === undefined || existing.trim() === "" ? SKELETON : existing;
  const kinds = new Map(elements(template).map((e) => [e.name, e.kind]));
  const tags = new Map(
    elements(template).flatMap((e) => {
      const own =
        e.kind === "plurals"
          ? items(template, e)
              .map((item) => tagsOf(slice(template, item.raw)))
              .find((t) => t !== undefined)
          : e.inner && tagsOf(slice(template, e.inner));
      return own ? [[e.name, own] as const] : [];
    }),
  );
  const ids = [
    ...[...kinds.keys()].filter((id) => Object.hasOwn(translations, id)),
    ...Object.keys(translations).filter((id) => !kinds.has(id)),
  ];
  return patchAll(
    xml,
    ids.map((id) => ({
      id,
      text: translations[id]!,
      kind: kinds.get(id),
      tags: tags.get(id),
    })),
    onRefused,
  );
}

// Proposals are few; each is applied to the file the one before left.
export function applyAndroidOps(xml: string, ops: SourceOp[]): string {
  let out = xml.trim() === "" ? SKELETON : xml;
  for (const op of ops) {
    out = patchAll(
      out,
      [op.kind === "delete" ? { id: op.id } : { id: op.id, text: op.text }],
      (id) => {
        throw new Error(
          `android: ${id} is a plural a <plurals> cannot hold (an =N branch, or a key that is no plural category)`,
        );
      },
    );
  }
  return out;
}

// A config language's `values` directory by Android's rule: `-r` before
// a two-letter region, `b+` for any other BCP-47 tag, a numeric region
// included, which aapt2 takes as b+ only (`values-b+es+419`, #993).
export function androidDirOf(language: string): string {
  const parts = language.split(/[-_]/);
  if (parts.length === 1) return `values-${parts[0]}`;
  if (parts.length === 2 && /^[A-Za-z]{2}$/.test(parts[1]!))
    return `values-${parts[0]}-r${parts[1]!.toUpperCase()}`;
  return `values-b+${parts.join("+")}`;
}

// The language a `values-*` directory names, androidDirOf's inverse:
// `values-pt-rBR` is pt-BR and `values-b+sr+Latn` sr-Latn. Undefined
// for the source's `values` and for a qualifier that is not a language
// (`values-sw360dp`, `values-night`, `values-v21`), Android's language
// being the first qualifier and the only one here.
export function androidLanguageOf(dir: string): string | undefined {
  const qualifier = /^values-(.+)$/.exec(dir)?.[1];
  // Android Automotive's UI mode, which aapt never reads as a language.
  if (qualifier === undefined || qualifier.toLowerCase() === "car")
    return undefined;
  const bcp47 = /^b\+([A-Za-z]{2,3})((?:\+[A-Za-z0-9]{2,8})*)$/.exec(qualifier);
  // Subtags in BCP 47's case: a script title-cased, a region upper.
  if (bcp47)
    return [
      bcp47[1]!.toLowerCase(),
      ...bcp47[2]!
        .split("+")
        .filter(Boolean)
        .map((sub) =>
          sub.length === 4
            ? sub[0]!.toUpperCase() + sub.slice(1).toLowerCase()
            : sub.toUpperCase(),
        ),
    ].join("-");
  // aapt2 reads the language and region in either case.
  const legacy = /^([a-z]{2,3})(?:-r([a-z]{2}))?$/i.exec(qualifier);
  if (!legacy) return undefined;
  const language = legacy[1]!.toLowerCase();
  return legacy[2] ? `${language}-${legacy[2].toUpperCase()}` : language;
}
