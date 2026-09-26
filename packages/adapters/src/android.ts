// Android string resources (§3, #596): `values/strings.xml` and one
// `values-<qualifier>/strings.xml` per language. A <string> is a string;
// a <plurals> is one string whose text is an ICU plural on `quantity`,
// one branch per <item>. Text is shown as the app shows it: aapt's
// escapes (\' \" \n \t \\ \@ \?), XML entities and double quotes that
// keep whitespace are undone on read and written back on change. A
// file is edited in place, element by element, so a pull that changes
// nothing writes nothing and one that changes a string reads as it.
import type { StringEntry } from "@corpus/contract";

export type AndroidOp =
  | { kind: "edit" | "add"; id: string; text: string }
  | { kind: "delete"; id: string };

type Element = {
  kind: "string" | "plurals";
  name: string;
  start: number;
  end: number;
  // The content's span, absent for `<string name="x"/>`.
  inner?: { start: number; end: number };
};

type Item = { quantity: string; raw: string; start: number; end: number };

const SKELETON = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`;
const CDATA_RE = /^<!\[CDATA\[([\s\S]*)\]\]>$/;

// Comments are blanked, offsets kept, so a string commented out is not
// read.
function masked(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];
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
    const openEnd = text.indexOf(">", m.index) + 1;
    const selfClosing = !plural && m[2] === "/>";
    out.push({
      kind: plural ? "plurals" : "string",
      name,
      start: m.index,
      end: re.lastIndex,
      ...(selfClosing
        ? {}
        : {
            inner: {
              start: openEnd,
              end: re.lastIndex - (plural ? "</plurals>" : "</string>").length,
            },
          }),
    });
  }
  return out;
}

function items(xml: string, element: Element): Item[] {
  if (!element.inner) return [];
  const body = masked(xml).slice(element.inner.start, element.inner.end);
  const out: Item[] = [];
  const re = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const quantity = attr(m[1] ?? "", "quantity");
    if (quantity === undefined) continue;
    const start = element.inner.start + m.index;
    const open = m[0].indexOf(">") + 1;
    out.push({
      quantity,
      raw: xml.slice(start + open, start + m[0].length - "</item>".length),
      start,
      end: start + m[0].length,
    });
  }
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (all, name: string) => {
      if (name === "lt") return "<";
      if (name === "gt") return ">";
      if (name === "amp") return "&";
      if (name === "quot") return '"';
      if (name === "apos") return "'";
      const code =
        name[1] === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return String.fromCodePoint(code);
    },
  );
}

// aapt's reading: a backslash escapes the next character, a double
// quote toggles a run whose whitespace is kept, and outside one a run
// of whitespace is a single space, trimmed at the ends.
function unescape(text: string): string {
  const out: { ch: string; kept: boolean }[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length) {
      const next = text[++i]!;
      if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
        out.push({
          ch: String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)),
          kept: true,
        });
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
    if (!quoted && /\s/.test(ch)) {
      if (out.at(-1)?.ch === " " && !out.at(-1)!.kept) continue;
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
  if (cdata) return unescape(cdata[1]!);
  return unescape(decodeEntities(raw));
}

function escape(text: string, cdata: boolean): string {
  let out = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
  if (/^[@?]/.test(out)) out = `\\${out}`;
  if (!cdata) {
    // A tag is markup and stays one; any other `<` is text.
    out = out.replace(/&/g, "&amp;").replace(/<(?![A-Za-z/])/g, "&lt;");
  }
  // Spaces aapt would collapse or trim are kept inside quotes.
  if (/^ | $| {2}/.test(out)) out = `"${out}"`;
  return cdata ? `<![CDATA[${out}]]>` : out;
}

function isCdata(raw: string): boolean {
  return CDATA_RE.test(raw.trim());
}

function pluralText(xml: string, element: Element): string {
  const branches = items(xml, element).map(
    (item) => `${item.quantity} {${decode(item.raw)}}`,
  );
  return `{quantity, plural, ${branches.join(" ")}}`;
}

// The branches of an ICU plural, keyed as written, their text raw. A
// text that is not one is a single `other`.
function pluralBranches(text: string): [string, string][] {
  const head = /^\{\s*[A-Za-z_]\w*\s*,\s*plural\s*,/.exec(text.trim());
  if (!head) return [["other", text]];
  const body = text.trim().slice(head[0].length, -1);
  const out: [string, string][] = [];
  const re = /\s*(=?\w+)\s*\{/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let depth = 1;
    let at = re.lastIndex;
    while (at < body.length && depth > 0) {
      if (body[at] === "{") depth++;
      else if (body[at] === "}") depth--;
      at++;
    }
    out.push([m[1]!, body.slice(re.lastIndex, at - 1)]);
    re.lastIndex = at;
  }
  return out;
}

function isPlural(text: string): boolean {
  return /^\{\s*[A-Za-z_]\w*\s*,\s*plural\s*,/.test(text.trim());
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
          ? decode(xml.slice(element.inner.start, element.inner.end))
          : "",
  }));
}

function lineIndent(xml: string, at: number): string {
  const lineStart = xml.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(xml.slice(lineStart, at))?.[0] ?? "";
}

function unitOf(xml: string): string {
  const last = elements(xml).at(-1);
  return last ? lineIndent(xml, last.start) || "    " : "    ";
}

function renderItems(
  branches: [string, string][],
  indent: string,
  cdata: boolean,
  eol: string,
): string {
  return branches
    .map(
      ([quantity, text]) =>
        `${indent}<item quantity="${quantity}">${escape(text, cdata)}</item>`,
    )
    .join(eol);
}

function render(id: string, text: string, unit: string, eol: string): string {
  if (!isPlural(text))
    return `${unit}<string name="${id}">${escape(text, false)}</string>`;
  return `${unit}<plurals name="${id}">${eol}${renderItems(pluralBranches(text), unit + unit, false, eol)}${eol}${unit}</plurals>`;
}

function append(xml: string, id: string, text: string): string {
  const close = xml.lastIndexOf("</resources>");
  if (close < 0) throw new Error("android: file has no </resources>");
  const eol = xml.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = xml.lastIndexOf("\n", close - 1) + 1;
  const before = xml.slice(0, lineStart);
  return `${before}${render(id, text, unitOf(xml), eol)}${eol}${xml.slice(lineStart)}`;
}

function set(xml: string, element: Element, text: string): string {
  const eol = xml.includes("\r\n") ? "\r\n" : "\n";
  if (element.kind === "string") {
    if (!element.inner) {
      return (
        xml.slice(0, element.start) +
        `<string name="${element.name}">${escape(text, false)}</string>` +
        xml.slice(element.end)
      );
    }
    const raw = xml.slice(element.inner.start, element.inner.end);
    if (decode(raw) === text) return xml;
    return (
      xml.slice(0, element.inner.start) +
      escape(text, isCdata(raw)) +
      xml.slice(element.inner.end)
    );
  }
  if (pluralText(xml, element) === text) return xml;
  const old = items(xml, element);
  const byQuantity = new Map(old.map((item) => [item.quantity, item]));
  const indent = old[0]
    ? lineIndent(xml, old[0].start)
    : lineIndent(xml, element.start) + unitOf(xml);
  const cdata = old.some((item) => isCdata(item.raw));
  const body = pluralBranches(text)
    .map(([quantity, branch]) => {
      const kept = byQuantity.get(quantity);
      return kept && decode(kept.raw) === branch
        ? `${indent}${xml.slice(kept.start, kept.end)}`
        : renderItems([[quantity, branch]], indent, cdata, eol);
    })
    .join(eol);
  const inner = element.inner!;
  const closeIndent = lineIndent(xml, inner.end);
  return (
    xml.slice(0, inner.start) +
    eol +
    body +
    eol +
    closeIndent +
    xml.slice(inner.end)
  );
}

function remove(xml: string, element: Element): string {
  const lineStart = xml.lastIndexOf("\n", element.start - 1) + 1;
  const onItsLine = xml.slice(lineStart, element.start).trim() === "";
  const next = xml.indexOf("\n", element.end);
  const tail = xml.slice(element.end, next < 0 ? xml.length : next);
  if (onItsLine && tail.trim() === "")
    return (
      xml.slice(0, lineStart) + xml.slice(next < 0 ? xml.length : next + 1)
    );
  return xml.slice(0, element.start) + xml.slice(element.end);
}

function write(xml: string, id: string, text: string): string {
  const element = elements(xml).find((e) => e.name === id);
  return element ? set(xml, element, text) : append(xml, id, text);
}

// A target file from the translations: the existing file edited in
// place, or, when there is none, a bare <resources> filled in the
// source's order. Ids the translations do not mention are kept.
export function entriesToAndroid(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
): string {
  let xml =
    existing === undefined || existing.trim() === "" ? SKELETON : existing;
  const order = androidToEntries(template, { type: "" }).map((e) => e.id);
  const ids = [
    ...order.filter((id) => Object.hasOwn(translations, id)),
    ...Object.keys(translations).filter((id) => !order.includes(id)),
  ];
  for (const id of ids) xml = write(xml, id, translations[id]!);
  return xml;
}

export function applyAndroidOps(xml: string, ops: AndroidOp[]): string {
  let out = xml.trim() === "" ? SKELETON : xml;
  for (const op of ops) {
    if (op.kind === "delete") {
      const element = elements(out).find((e) => e.name === op.id);
      if (element) out = remove(out, element);
    } else {
      out = write(out, op.id, op.text);
    }
  }
  return out;
}

// A `values-<qualifier>` directory's language by Android's rule: `-r`
// before a region, `b+` for a BCP-47 tag; a directory with any other
// qualifier (night, v21, land) is not a language.
export function androidLanguageOf(dir: string): string | undefined {
  const bcp = /^values-b\+([A-Za-z0-9+]+)$/.exec(dir);
  if (bcp) return bcp[1]!.split("+").join("-");
  const plain = /^values-([a-z]{2,3})(?:-r([A-Z]{2}|[0-9]{3}))?$/.exec(dir);
  if (!plain) return undefined;
  return plain[2] ? `${plain[1]}-${plain[2]}` : plain[1];
}

export function androidDirOf(language: string): string {
  const parts = language.split(/[-_]/);
  if (parts.length === 1) return `values-${parts[0]}`;
  if (parts.length === 2 && /^(?:[A-Za-z]{2}|\d{3})$/.test(parts[1]!))
    return `values-${parts[0]}-r${parts[1]!.toUpperCase()}`;
  return `values-b+${parts.join("+")}`;
}
