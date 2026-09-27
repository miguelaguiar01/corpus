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
// decoded, an ICU plural inside a unit kept as ICU. `parts` records the
// XML each token stands for, so a translation can be written back with
// the unit's own elements (#711).
export function inlineText(xml: string, parts?: Map<string, string>): string {
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
    const token = inlineToken(m, xml, open, close, (to) => {
      at = to;
      INLINE_RE.lastIndex = to;
    });
    if (token === undefined) continue;
    parts?.set(token, xml.slice(m.index, at));
    out += token;
  }
  return out + decode(xml.slice(at));
}

// One inline element's token, or undefined for an annotation whose text
// stands; `skip` moves past the native code an element holds.
function inlineToken(
  m: RegExpExecArray,
  xml: string,
  open: string[],
  close: (name: string) => string,
  skip: (to: number) => void,
): string | undefined {
  const [, slash, element, attrs = "", self] = m;
  const at = m.index + m[0].length;
  const id = attr(attrs, "id") ?? "";
  if (element === "x" || element === "ph") {
    const equiv = attr(attrs, "equiv") ?? id;
    // A 1.2 `<ph>` holds its native code; the placeholder stands for it.
    if (element === "ph" && !self && !slash) skip(skipTo(xml, at, "ph"));
    if (/^START_/.test(equiv)) {
      const name = nameOf(equiv.slice("START_".length), "t");
      open.push(name);
      return `<${name}>`;
    }
    if (/^CLOSE_/.test(equiv))
      return close(nameOf(equiv.slice("CLOSE_".length), "t"));
    return `{${nameOf(equiv, "ph")}}`;
  }
  if (element === "g" || element === "pc") {
    // `</g>` and `</pc>` close the element XML nests them in.
    if (slash) {
      const top = open.pop();
      return top === undefined ? `</${element}>` : `</${top}>`;
    }
    const start = attr(attrs, "equivStart");
    const name =
      start && /^START_/.test(start)
        ? nameOf(start.slice("START_".length), "t")
        : nameOf(`${element}${id}`, "t");
    if (self) return `<${name}/>`;
    open.push(name);
    return `<${name}>`;
  }
  // `<bx>`/`<ex>`, `<bpt>`/`<ept>` and 2.0's `<sc>`/`<ec>` open and
  // close a pair by id (`startRef` in 2.0).
  if (element === "bx" || element === "sc" || element === "bpt") {
    if (slash) return undefined;
    if (element === "bpt" && !self) skip(skipTo(xml, at, "bpt"));
    const name = nameOf(`p${id}`, "t");
    open.push(name);
    return `<${name}>`;
  }
  if (element === "ex" || element === "ec" || element === "ept") {
    if (slash) return undefined;
    if (element === "ept" && !self) skip(skipTo(xml, at, "ept"));
    return close(nameOf(`p${attr(attrs, "startRef") ?? id}`, "t"));
  }
  // An isolated `<it>` is native code with no pair: skipped.
  if (element === "it" && !slash && !self) skip(skipTo(xml, at, "it"));
  // <mrk>, <sm>/<em>: annotations; their text stands.
  return undefined;
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

// Angular's five escapes for text inside an element.
function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const TOKEN_RE = /\{[A-Za-z][A-Za-z0-9_]*\}|<\/?[A-Za-z][A-Za-z0-9_-]*\/?>/g;

// The editor's text as a unit's inline XML: each placeholder and tag the
// unit's source knows as the element it came from, the rest escaped.
export function inlineXml(text: string, parts: Map<string, string>): string {
  let out = "";
  let at = 0;
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    const xml = parts.get(m[0]);
    if (xml === undefined) continue;
    out += escape(text.slice(at, m.index)) + xml;
    at = TOKEN_RE.lastIndex;
  }
  return out + escape(text.slice(at));
}

type Span = { start: number; end: number };
type UnitSpan = Span & {
  id: string;
  version: "1.2" | "2.0";
  // The `<source>` element's content, and where it ends.
  source: Span;
  // The `<target>` element's content, absent when there is none.
  target?: Span;
  // Where a state lives: 1.2's `<target>` open tag, 2.0's `<segment>`.
  stateTag?: Span;
};

function unitSpans(xml: string): UnitSpan[] {
  const text = masked(xml)
    .replace(/<alt-trans\b[\s\S]*?<\/alt-trans>/g, (c) => " ".repeat(c.length))
    .replace(/<ignorable\b[\s\S]*?<\/ignorable>/g, (c) => " ".repeat(c.length));
  const out: UnitSpan[] = [];
  const find = (from: number, to: number, element: string) => {
    const re = new RegExp(
      `<${element}\\b${ATTRS}(?:/>|>([\\s\\S]*?)</${element}>)`,
      "y",
    );
    const at = text.slice(from, to).search(new RegExp(`<${element}\\b`));
    if (at < 0) return undefined;
    re.lastIndex = from + at;
    const m = re.exec(text);
    if (!m || re.lastIndex > to) return undefined;
    const openEnd =
      text.indexOf(
        ">",
        m.index + m[0].indexOf(m[1] ?? "") + (m[1] ?? "").length,
      ) + 1;
    const self = m[2] === undefined;
    return {
      tag: { start: m.index, end: openEnd },
      content: self
        ? { start: openEnd, end: openEnd }
        : { start: openEnd, end: re.lastIndex - `</${element}>`.length },
      whole: { start: m.index, end: re.lastIndex },
      self,
    };
  };
  for (const [element, version] of [
    ["trans-unit", "1.2"],
    ["unit", "2.0"],
  ] as const) {
    const re = new RegExp(
      `<${element}\\b${ATTRS}>[\\s\\S]*?</${element}>`,
      "g",
    );
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const id = attr(m[1] ?? "", "id");
      if (id === undefined) continue;
      const source = find(m.index, re.lastIndex, "source");
      if (!source) continue;
      const target = find(m.index, re.lastIndex, "target");
      const segment =
        version === "2.0" ? find(m.index, re.lastIndex, "segment") : undefined;
      out.push({
        id: decode(id),
        version,
        start: m.index,
        end: re.lastIndex,
        source: source.content,
        ...(target && {
          target: target.self ? undefined : target.content,
        }),
        ...(version === "1.2" && target && { stateTag: target.tag }),
        ...(segment && { stateTag: segment.tag }),
      });
      // A self-closing `<target/>` is a target to fill: its whole element.
      if (target?.self) out[out.length - 1]!.target = undefined;
    }
  }
  return out;
}

type Patch = Span & { text: string };

function applyPatches(xml: string, patches: Patch[]): string {
  let out = xml;
  for (const p of [...patches].sort((a, b) => b.start - a.start))
    out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return out;
}

function lineIndent(xml: string, at: number): string {
  const start = xml.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(xml.slice(start))![0];
}

// A state that says work, turned to `translated`; any other kept.
function statePatch(xml: string, tag: Span | undefined): Patch | undefined {
  if (!tag) return undefined;
  const open = xml.slice(tag.start, tag.end);
  const m = /(\sstate\s*=\s*)(["'])(.*?)\2/.exec(open);
  if (!m || !UNTRANSLATED.has(m[3]!)) return undefined;
  const at = tag.start + m.index + m[1]!.length + 1;
  return { start: at, end: at + m[3]!.length, text: "translated" };
}

// The target file a missing one starts as: the source file, its
// language named (1.2's `target-language`, 2.0's `trgLang`).
function targetFrom(template: string, language: string): string {
  const named = (tag: string, name: string, xml: string) =>
    xml.replace(
      new RegExp(`<${tag}\\b${ATTRS}>`),
      (open: string, attrs: string) =>
        new RegExp(`\\s${name}\\s*=`).test(attrs)
          ? open.replace(
              new RegExp(`(\\s${name}\\s*=\\s*)(["']).*?\\2`),
              `$1$2${language}$2`,
            )
          : open.replace(
              new RegExp(`^<${tag}`),
              `<${tag} ${name}="${language}"`,
            ),
    );
  return /<xliff\b[^>]*version\s*=\s*["']2/.test(template)
    ? named("xliff", "trgLang", template)
    : template.replace(
        new RegExp(`<file\\b${ATTRS}>`, "g"),
        (open, attrs: string) =>
          /\starget-language\s*=/.test(attrs)
            ? open.replace(
                /(\starget-language\s*=\s*)(["']).*?\2/,
                `$1$2${language}$2`,
              )
            : open.replace(/^<file/, `<file target-language="${language}"`),
      );
}

// A pull into a target file (§8, #711): each translation into its unit's
// `<target>`, written only where its text changed, with the unit's own
// inline elements, the state turned to `translated` where it said work;
// a unit with no `<target>` gets one after its `<source>`, and a unit
// the file lacks is the source file's, appended. Every other byte stays.
export function entriesToXliff(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: string,
): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language)
      : existing;
  const sources = new Map(
    unitSpans(template).map((u) => [u.id, { unit: u, xml: template }]),
  );
  const patches: Patch[] = [];
  const seen = new Set<string>();
  const units = unitSpans(base);
  for (const u of units) {
    seen.add(u.id);
    const text = translations[u.id];
    if (text === undefined) continue;
    const parts = new Map<string, string>();
    const from = sources.get(u.id);
    inlineText(
      (from?.xml ?? base).slice(
        (from?.unit ?? u).source.start,
        (from?.unit ?? u).source.end,
      ),
      parts,
    );
    // The target's own elements stand too, where the source lacks them.
    if (u.target) {
      const own = new Map<string, string>();
      const current = inlineText(base.slice(u.target.start, u.target.end), own);
      for (const [token, xml] of own)
        if (!parts.has(token)) parts.set(token, xml);
      if (current === text) continue;
      patches.push({ ...u.target, text: inlineXml(text, parts) });
      const state = statePatch(base, u.stateTag);
      if (state) patches.push(state);
      continue;
    }
    const indent = lineIndent(base, u.source.start);
    const closeSource =
      base.indexOf("</source>", u.source.end) + "</source>".length;
    const selfTarget = /<target\b[^>]*\/>/.exec(base.slice(u.start, u.end));
    const element =
      u.version === "1.2"
        ? `<target state="translated">${inlineXml(text, parts)}</target>`
        : `<target>${inlineXml(text, parts)}</target>`;
    if (selfTarget) {
      const at = u.start + selfTarget.index;
      patches.push({
        start: at,
        end: at + selfTarget[0].length,
        text: element,
      });
    } else {
      patches.push({
        start: closeSource,
        end: closeSource,
        text: `\n${indent}${element}`,
      });
    }
    if (u.version === "2.0") {
      const state = statePatch(base, u.stateTag);
      if (state) patches.push(state);
    }
  }
  let out = applyPatches(base, patches);
  // Units the target file lacks, copied from the source with their target.
  const missing = Object.keys(translations).filter(
    (id) => !seen.has(id) && sources.has(id),
  );
  if (missing.length > 0) {
    const last = unitSpans(out).at(-1);
    const at = last ? last.end : out.search(/<\/(?:body|file)>/);
    if (at >= 0) {
      const indent = last ? lineIndent(out, last.start) : "";
      const blocks = missing.map((id) => {
        const { unit: u, xml } = sources.get(id)!;
        return entriesToXliff(
          xml.slice(u.start, u.end),
          { [id]: translations[id]! },
          xml.slice(u.start, u.end),
          language,
        );
      });
      out =
        out.slice(0, at) +
        blocks.map((b) => `\n${indent}${b}`).join("") +
        out.slice(at);
    }
  }
  return out;
}

export type XliffOp =
  | { kind: "edit" | "add"; id: string; text: string }
  | { kind: "delete"; id: string };

// A proposal into the source file (§11): an edit rewrites the unit's
// `<source>` with its own elements, a removal drops the unit's lines, an
// addition appends a unit after the last.
export function applyXliffOps(xml: string, ops: XliffOp[]): string {
  let out = xml;
  for (const op of ops) {
    const units = unitSpans(out);
    const u = units.find((unit) => unit.id === op.id);
    if (op.kind === "delete") {
      if (!u) continue;
      const start = out.lastIndexOf("\n", u.start - 1);
      out = out.slice(0, start < 0 ? u.start : start) + out.slice(u.end);
      continue;
    }
    if (u) {
      const parts = new Map<string, string>();
      inlineText(out.slice(u.source.start, u.source.end), parts);
      out =
        out.slice(0, u.source.start) +
        inlineXml(op.text, parts) +
        out.slice(u.source.end);
      continue;
    }
    const last = units.at(-1);
    const version =
      last?.version ?? (/version\s*=\s*["']2/.test(out) ? "2.0" : "1.2");
    const indent = last ? lineIndent(out, last.start) : "      ";
    const inner = `${indent}  `;
    const block =
      version === "1.2"
        ? `<trans-unit id="${escape(op.id)}" datatype="html">\n${inner}<source>${escape(op.text)}</source>\n${indent}</trans-unit>`
        : `<unit id="${escape(op.id)}">\n${inner}<segment>\n${inner}  <source>${escape(op.text)}</source>\n${inner}</segment>\n${indent}</unit>`;
    const at = last ? last.end : out.search(/<\/(?:body|file)>/);
    if (at < 0)
      throw new Error("xliff: no unit, body or file to add a unit to");
    out = out.slice(0, at) + `\n${indent}${block}` + out.slice(at);
  }
  return out;
}
