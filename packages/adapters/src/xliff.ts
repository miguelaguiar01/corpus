// XLIFF 1.2 and 2.0 (#667), as Angular's i18n and most translation
// tools export it: a unit's `<source>` is the text, its `<target>` the
// translation, its inline elements the text's placeholders and tags.
import type { StringEntry } from "@corpus/contract";

// A unit as read: its id, its source and target as the editor shows
// them, whether the target counts as translated, and its notes.
export type XliffUnit = {
  id: string;
  source: string;
  target?: string;
  translated: boolean;
  note?: string;
};

// States a target is work in: XLIFF 1.2's `new` and `needs-translation`,
// 2.0's `initial`. Every other state has a translation someone wrote.
const UNTRANSLATED = new Set(["new", "needs-translation", "initial"]);

function masked(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)?.[2];
}

// An element's attributes, a `>` inside quotes included.
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*?)`;

function decode(text: string): string {
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

// A name an ICU placeholder or tag can carry: Angular's
// `INTERPOLATION_1` as it is, anything else with its odd characters
// replaced.
function nameOf(raw: string, prefix: string): string {
  const name = raw.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z]/.test(name) ? name : `${prefix}${name}`;
}

const INLINE_RE = new RegExp(
  `<(\\/?)(x|g|bx|ex|bpt|ept|ph|pc|sc|ec|it|mrk|sm|em)\\b${ATTRS}(\\/?)>|<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`,
  "g",
);

// A tag's name without Angular's `_1`: `START_LINK_1` closes with
// `CLOSE_LINK`.
function baseOf(name: string): string {
  return name.replace(/_\d+$/, "");
}

// The native code an element holds, skipped: `<bpt>`, `<ept>`, `<it>`
// and a 1.2 `<ph>` stand for markup the editor shows as a tag or a
// placeholder.
function skipTo(xml: string, at: number, element: string): number {
  const end = xml.indexOf(`</${element}>`, at);
  return end < 0 ? at : end + element.length + 3;
}

// A unit's inline content as the editor's text: `<x id="INTERPOLATION"/>`
// and `<ph>` are placeholders, `START_*`/`CLOSE_*` pairs, `<g>`, `<pc>`,
// `<bx>`/`<ex>` and `<sc>`/`<ec>` tags, paired by position, so a
// translation that reverses a pair does not parse. Other text is
// decoded, an ICU plural inside a unit kept as ICU.
export function inlineText(xml: string): string {
  let out = "";
  let at = 0;
  const open: string[] = [];
  // A close pops its open tag only when their names match, so a crossed
  // pair or a close of another tag does not parse.
  const close = (name: string) => {
    const top = open[open.length - 1];
    if (top !== undefined && baseOf(top) === baseOf(name)) {
      open.pop();
      return `</${top}>`;
    }
    return `</${name}>`;
  };
  INLINE_RE.lastIndex = 0;
  for (let m = INLINE_RE.exec(xml); m; m = INLINE_RE.exec(xml)) {
    out += decode(xml.slice(at, m.index));
    at = INLINE_RE.lastIndex;
    if (m[5] !== undefined) {
      out += m[5];
      continue;
    }
    const [, slash, element, attrs = "", self] = m;
    const id = attr(attrs, "id") ?? "";
    if (element === "x" || element === "ph") {
      const equiv = attr(attrs, "equiv") ?? id;
      if (/^START_/.test(equiv)) {
        const name = nameOf(equiv.slice("START_".length), "t");
        open.push(name);
        out += `<${name}>`;
      } else if (/^CLOSE_/.test(equiv)) {
        out += close(nameOf(equiv.slice("CLOSE_".length), "t"));
      } else {
        out += `{${nameOf(equiv, "ph")}}`;
      }
      // A 1.2 `<ph>` holds its native code; the placeholder stands for it.
      if (element === "ph" && !self && !slash) {
        at = skipTo(xml, at, "ph");
        INLINE_RE.lastIndex = at;
      }
      continue;
    }
    if (element === "g" || element === "pc") {
      // `</g>` and `</pc>` close the element XML nests them in.
      if (slash) {
        const top = open.pop();
        out += top === undefined ? `</${element}>` : `</${top}>`;
        continue;
      }
      const start = attr(attrs, "equivStart");
      const name =
        start && /^START_/.test(start)
          ? nameOf(start.slice("START_".length), "t")
          : nameOf(`${element}${id}`, "t");
      if (self) out += `<${name}/>`;
      else {
        open.push(name);
        out += `<${name}>`;
      }
      continue;
    }
    // `<bx>`/`<ex>`, `<bpt>`/`<ept>` and 2.0's `<sc>`/`<ec>` open and
    // close a pair by id (`startRef` in 2.0).
    if (element === "bx" || element === "sc" || element === "bpt") {
      if (slash) continue;
      const name = nameOf(`p${id}`, "t");
      open.push(name);
      out += `<${name}>`;
      if (element === "bpt" && !self) {
        at = skipTo(xml, at, "bpt");
        INLINE_RE.lastIndex = at;
      }
      continue;
    }
    if (element === "ex" || element === "ec" || element === "ept") {
      if (slash) continue;
      out += close(nameOf(`p${attr(attrs, "startRef") ?? id}`, "t"));
      if (element === "ept" && !self) {
        at = skipTo(xml, at, "ept");
        INLINE_RE.lastIndex = at;
      }
      continue;
    }
    // An isolated `<it>` is native code with no pair: skipped.
    if (element === "it" && !slash && !self) {
      at = skipTo(xml, at, "it");
      INLINE_RE.lastIndex = at;
    }
    // <mrk>, <sm>/<em>: annotations; their text stands.
  }
  return out + decode(xml.slice(at));
}

function inner(block: string, element: string): string | undefined {
  const m = new RegExp(
    `<${element}\\b${ATTRS}(?:/>|>([\\s\\S]*?)</${element}>)`,
  ).exec(block);
  if (!m) return undefined;
  return m[2] ?? "";
}

function openTag(block: string, element: string): string | undefined {
  return new RegExp(`<${element}\\b${ATTRS}/?>`).exec(block)?.[1];
}

// A unit's own content: comments, fuzzy matches (`<alt-trans>`) and
// 2.0's `<ignorable>` are not its source, its target nor its notes.
function own(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<alt-trans\b[\s\S]*?<\/alt-trans>/g, "")
    .replace(/<ignorable\b[\s\S]*?<\/ignorable>/g, "");
}

function notes(block: string, key: "from" | "category"): string | undefined {
  const out: string[] = [];
  const re = /<note\b([^>]*)>([\s\S]*?)<\/note>/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const kind = attr(m[1] ?? "", key);
    if (kind === "description" || kind === "meaning") {
      const text = decode(m[2]!.trim());
      if (text) out.push(text);
    }
  }
  return out.length ? out.join("\n") : undefined;
}

function unit(
  id: string,
  source: string,
  target: string | undefined,
  state: string | undefined,
  note: string | undefined,
): XliffUnit {
  const text = target === undefined ? undefined : inlineText(target);
  return {
    id,
    source: inlineText(source),
    ...(text !== undefined && { target: text }),
    translated:
      text !== undefined &&
      text.trim() !== "" &&
      !UNTRANSLATED.has(state ?? ""),
    ...(note && { note }),
  };
}

// Every unit of a file, 1.2's `<trans-unit>` or 2.0's `<unit>`, in
// document order.
export function xliffUnits(xml: string): XliffUnit[] {
  const text = masked(xml);
  // A namespace prefix (`<xlf:trans-unit>`) would read as no unit at all.
  if (/<[\w.-]+:(?:trans-unit|unit)\b/.test(text))
    throw new Error(
      "xliff: a file whose elements carry a namespace prefix is not read; write them unprefixed",
    );
  const out: XliffUnit[] = [];
  const legacy = new RegExp(
    `<trans-unit\\b${ATTRS}>([\\s\\S]*?)</trans-unit>`,
    "g",
  );
  for (let m = legacy.exec(text); m; m = legacy.exec(text)) {
    const id = attr(m[1] ?? "", "id");
    if (id === undefined) continue;
    const body = own(xml.slice(m.index, legacy.lastIndex));
    const source = inner(body, "source");
    if (source === undefined) continue;
    const targetAttrs = openTag(body, "target");
    out.push(
      unit(
        decode(id),
        source,
        inner(body, "target"),
        targetAttrs === undefined ? undefined : attr(targetAttrs, "state"),
        notes(body, "from"),
      ),
    );
  }
  const modern = new RegExp(`<unit\\b${ATTRS}>([\\s\\S]*?)</unit>`, "g");
  for (let m = modern.exec(text); m; m = modern.exec(text)) {
    const id = attr(m[1] ?? "", "id");
    if (id === undefined) continue;
    const body = own(xml.slice(m.index, modern.lastIndex));
    const segments = body.match(/<segment\b/g)?.length ?? 0;
    if (segments > 1) {
      throw new Error(
        `xliff: unit ${id} has ${segments} segments; a unit is read as one text`,
      );
    }
    const source = inner(body, "source");
    if (source === undefined) continue;
    const segment = openTag(body, "segment");
    out.push(
      unit(
        decode(id),
        source,
        inner(body, "target"),
        segment === undefined ? undefined : attr(segment, "state"),
        notes(body, "category"),
      ),
    );
  }
  return out;
}

// A source-language file's strings: each unit's source text, its
// description and meaning as the note.
export function xliffToEntries(
  xml: string,
  options: { type: string },
): StringEntry[] {
  return xliffUnits(xml).map((u) => ({
    id: u.id,
    type: options.type,
    source: u.source,
    ...(u.note && { note: u.note }),
  }));
}

// A target file's translations: the units whose target someone wrote,
// by id; a target still `new` is work, not a translation.
export function xliffTranslations(xml: string): StringEntry[] {
  return xliffUnits(xml)
    .filter((u) => u.translated)
    .map((u) => ({ id: u.id, type: "", source: u.target! }));
}
