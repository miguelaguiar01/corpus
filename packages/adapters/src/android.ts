// Android string resources (§3, #596). Text is what the app shows, aapt's
// escapes undone on read and written back on change; a file is patched
// element by element, so an unchanged pull writes the same bytes.
import type { StringEntry } from "@corpus/contract";

export type AndroidOp =
  | { kind: "edit" | "add"; id: string; text: string }
  | { kind: "delete"; id: string };

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
const QUANTITIES = ["zero", "one", "two", "few", "many", "other"];

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

// aapt's reading: a backslash escapes the next character, a double
// quote toggles a run whose whitespace is kept, and outside one a run
// of ASCII whitespace is one space, trimmed at the ends.
function unescape(text: string): string {
  const out: { ch: string; kept: boolean }[] = [];
  const markup = new RegExp(MARKUP_RE.source, "y");
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<") {
      markup.lastIndex = i;
      const tag = markup.exec(text);
      if (tag) {
        for (const c of tag[0]) out.push({ ch: c, kept: true });
        i += tag[0].length - 1;
        continue;
      }
    }
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[++i]!;
      const hex = text.slice(i + 1, i + 5);
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
  const cdata = CDATA_RE.exec(raw.trim());
  return cdata ? unescape(cdata[1]!) : unescape(decodeEntities(raw));
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

function escape(text: string, cdata: boolean): string {
  let out = "";
  let at = 0;
  for (const tag of text.matchAll(MARKUP_RE)) {
    const markup = cdata
      ? tag[0]
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

function pluralText(xml: string, element: Element): string {
  const branches = items(xml, element).map(
    (item) => `${item.quantity} {${decode(slice(xml, item.raw))}}`,
  );
  return `{quantity, plural, ${branches.join(" ")}}`;
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
        ? pluralText(xml, element)
        : element.inner
          ? decode(slice(xml, element.inner))
          : "",
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
) {
  return `${indent}<item quantity="${quantity}">${escape(text, cdata)}</item>`;
}

function render(
  id: string,
  text: string,
  kind: Element["kind"],
  { unit, eol }: Style,
): string {
  if (kind === "string")
    return `${unit}<string name="${id}">${escape(text, false)}</string>`;
  const itemLines = [...pluralBranches(text)].map(([q, t]) =>
    renderItem(unit + unit, q, t, false),
  );
  return `${unit}<plurals name="${id}">${eol}${itemLines.join(eol)}${eol}${unit}</plurals>`;
}

function stringPatches(xml: string, element: Element, text: string): Patch[] {
  if (!element.inner) {
    if (text === "") return [];
    const open = slice(xml, element).replace(/\s*\/>$/, "");
    return [{ ...element, text: `${open}>${escape(text, false)}</string>` }];
  }
  const raw = slice(xml, element.inner);
  if (decode(raw) === text) return [];
  return [{ ...element.inner, text: escape(text, isCdata(raw)) }];
}

// A plural's items patched one by one, so comments between them and
// their order stay; a new quantity goes after the last item before it
// in CLDR order.
function pluralPatches(
  xml: string,
  element: Element,
  text: string,
  { unit, eol }: Style,
): Patch[] {
  if (pluralText(xml, element) === text) return [];
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
        text: escape(next, isCdata(slice(xml, item.raw))),
      });
    }
  }
  const rank = (q: string) => {
    const at = QUANTITIES.indexOf(q);
    return at < 0 ? QUANTITIES.length - 1.5 : at;
  };
  const added = [...wanted]
    .filter(([q]) => !old.some((item) => item.quantity === q))
    .sort(([a], [b]) => rank(a) - rank(b));
  const inserts = new Map<number, string[]>();
  for (const [quantity, branch] of added) {
    const before = old.filter((item) => rank(item.quantity) < rank(quantity));
    const line = renderItem(indent, quantity, branch, cdata);
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
function patchAll(
  xml: string,
  changes: { id: string; text?: string; kind?: Element["kind"] }[],
): string {
  const style = styleOf(xml);
  const byName = new Map<string, Element>();
  for (const element of elements(xml))
    if (!byName.has(element.name)) byName.set(element.name, element);
  const patches: Patch[] = [];
  const appended: string[] = [];
  for (const { id, text, kind } of changes) {
    const element = byName.get(id);
    if (text === undefined) {
      if (element) patches.push({ ...lineOf(xml, element), text: "" });
    } else if (element?.kind === "plurals") {
      patches.push(...pluralPatches(xml, element, text, style));
    } else if (element) {
      patches.push(...stringPatches(xml, element, text));
    } else {
      const as =
        kind ?? (PLURAL_HEAD_RE.test(text.trim()) ? "plurals" : "string");
      appended.push(render(id, text, as, style));
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

// A target file from the translations: the existing file patched, or,
// when there is none, a bare <resources> filled in the source's order.
// Ids the translations do not mention are kept.
export function entriesToAndroid(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
): string {
  const xml =
    existing === undefined || existing.trim() === "" ? SKELETON : existing;
  const kinds = new Map(elements(template).map((e) => [e.name, e.kind]));
  const ids = [
    ...[...kinds.keys()].filter((id) => Object.hasOwn(translations, id)),
    ...Object.keys(translations).filter((id) => !kinds.has(id)),
  ];
  return patchAll(
    xml,
    ids.map((id) => ({ id, text: translations[id]!, kind: kinds.get(id) })),
  );
}

// Proposals are few; each is applied to the file the one before left.
export function applyAndroidOps(xml: string, ops: AndroidOp[]): string {
  let out = xml.trim() === "" ? SKELETON : xml;
  for (const op of ops) {
    out = patchAll(out, [
      op.kind === "delete" ? { id: op.id } : { id: op.id, text: op.text },
    ]);
  }
  return out;
}

// A config language's `values` directory by Android's rule: `-r` before
// a region, `b+` for any other BCP-47 tag.
export function androidDirOf(language: string): string {
  const parts = language.split(/[-_]/);
  if (parts.length === 1) return `values-${parts[0]}`;
  if (parts.length === 2 && /^(?:[A-Za-z]{2}|\d{3})$/.test(parts[1]!))
    return `values-${parts[0]}-r${parts[1]!.toUpperCase()}`;
  return `values-b+${parts.join("+")}`;
}
