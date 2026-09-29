// XLIFF 1.2 and 2.0 (#667), as Angular's i18n and most translation
// tools export it: a unit's `<source>` is the text, its `<target>` the
// translation, its inline elements the text's placeholders and tags.
import { renderPreview, type StringEntry } from "@corpus/contract";
import {
  applied,
  attr,
  decodeEntities,
  eolOf,
  lineIndent,
  masked,
  ownRecord,
  type Patch,
  type Span,
  usedIn,
} from "./text";
import type { SourceOp } from "./write";

// A unit as read: its id, its source and target as the editor shows
// them, whether the target counts as translated, and its notes.
type XliffUnit = {
  id: string;
  source: string;
  target?: string;
  translated: boolean;
  note?: string;
  // What the app substitutes for each source placeholder, by name: an
  // `<x>`'s `equiv-text`, 2.0's `disp` (#714).
  shown?: Record<string, string>;
};

// States a target is work in: XLIFF 1.2's `new` and `needs-translation`,
// 2.0's `initial`. Every other state has a translation someone wrote.
const UNTRANSLATED = new Set(["new", "needs-translation", "initial"]);

// An element's attributes, a `>` inside quotes included.
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*?)`;

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
// the unit's own elements (#711); `shown`, what each placeholder
// displays as (#714).
function inlineText(
  xml: string,
  parts?: Map<string, string[]>,
  shown?: Record<string, string>,
): string {
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
    out += decodeEntities(xml.slice(at, m.index));
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
    const display = attr(m[3] ?? "", "equiv-text") ?? attr(m[3] ?? "", "disp");
    if (shown && display !== undefined && /^\{.*\}$/.test(token))
      shown[token.slice(1, -1)] = decodeEntities(display);
    if (parts) {
      const list = parts.get(token) ?? [];
      list.push(xml.slice(m.index, at));
      parts.set(token, list);
    }
    out += token;
  }
  return out + decodeEntities(xml.slice(at));
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
  // Where Angular found the text, as the gettext and qt-ts sources say
  // theirs (#772): 2.0's location notes, 1.2's context groups.
  const used: string[] = [];
  const re = /<note\b([^>]*)>([\s\S]*?)<\/note>/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const kind = attr(m[1] ?? "", key);
    const text = decodeEntities(m[2]!.trim());
    if (!text) continue;
    if (kind === "description" || kind === "meaning") out.push(text);
    else if (key === "category" && kind === "location") used.push(text);
  }
  const groups =
    /<context-group(?=[\s>])([^>]*?)(?<!\/)>([\s\S]*?)<\/context-group>/g;
  for (let m = groups.exec(block); m; m = groups.exec(block)) {
    if (attr(m[1] ?? "", "purpose") !== "location") continue;
    const context: Record<string, string> = {};
    const contexts = /<context(?=[\s>])([^>]*?)(?<!\/)>([\s\S]*?)<\/context>/g;
    for (let c = contexts.exec(m[2]!); c; c = contexts.exec(m[2]!)) {
      const type = attr(c[1] ?? "", "context-type");
      if (type !== undefined) context[type] ??= decodeEntities(c[2]!.trim());
    }
    const file = context.sourcefile;
    if (!file) continue;
    const line = context.linenumber;
    used.push(line ? `${file}:${line}` : file);
  }
  out.push(...usedIn(used));
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
  const shown: Record<string, string> = {};
  const read = inlineText(source, undefined, shown);
  return {
    id,
    source: read,
    ...(Object.keys(shown).length > 0 && { shown }),
    ...(text !== undefined && { target: text }),
    translated:
      text !== undefined &&
      text.trim() !== "" &&
      !UNTRANSLATED.has(state ?? ""),
    ...(note && { note }),
  };
}

// Every unit of a file, 1.2's `<trans-unit>` then 2.0's `<unit>`, each
// in document order.
export function xliffUnits(xml: string): XliffUnit[] {
  const text = masked(xml);
  // A namespace prefix (`<xlf:trans-unit>`) would read as no unit at all.
  if (/<[\w.-]+:(?:trans-unit|unit)\b/.test(text))
    throw new Error(
      "xliff: a file whose elements carry a namespace prefix is not read; write them unprefixed",
    );
  return unitSpans(xml).map((u) => {
    const body = own(xml.slice(u.start, u.end));
    const content = (span: Span) => own(xml.slice(span.start, span.end));
    return unit(
      u.id,
      content(u.source),
      u.target ? content(u.target) : u.emptyTarget ? "" : undefined,
      u.stateTag
        ? attr(xml.slice(u.stateTag.start, u.stateTag.end), "state")
        : undefined,
      notes(body, u.version === "1.2" ? "from" : "category"),
    );
  });
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
    ...(u.shown && { examples: [exampleOf(u.source, u.shown)] }),
  }));
}

// The unit read with each placeholder as the app displays it: the
// example the string page, a blank draft's preview and get_string's slots
// show (#714).
function exampleOf(source: string, values: Record<string, string>) {
  const read = renderPreview(source, values, undefined, { capitalise: false });
  return { values, rendered: read.ok ? read.text : source };
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
// unit knows as the element it came from, a token that repeats taking
// its elements in order (2.0 numbers each `<ph>` apart), the rest
// escaped.
function inlineXml(text: string, parts: Map<string, string[]>): string {
  let out = "";
  let at = 0;
  const used = new Map<string, number>();
  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    const list = parts.get(m[0]);
    if (!list || list.length === 0) continue;
    const n = used.get(m[0]) ?? 0;
    used.set(m[0], n + 1);
    out +=
      escape(text.slice(at, m.index)) + list[Math.min(n, list.length - 1)]!;
    at = TOKEN_RE.lastIndex;
  }
  return out + escape(text.slice(at));
}

type UnitSpan = Span & {
  id: string;
  version: "1.2" | "2.0";
  // The `<source>` element's content, and the end of the element.
  source: Span;
  sourceEnd: number;
  // The `<target>` element's content, absent when there is none or it
  // is `<target/>`, which `emptyTarget` names whole.
  target?: Span;
  emptyTarget?: Span;
  // Where a state lives: 1.2's `<target>` open tag, 2.0's `<segment>`.
  stateTag?: Span;
};

// A unit's fuzzy matches (1.2's `<alt-trans>`) and ignorables (2.0's
// `<ignorable>`) blanked within it, at the same offsets, a self-closing
// one included; one left open is refused, as blanking to some later
// unit's close would drop every unit between (#900).
function blankInside(unit: string, id: string): string {
  const inner = unit.replace(
    new RegExp(
      `<(alt-trans|ignorable)\\b${ATTRS}(?:/>|>[\\s\\S]*?</\\1>)`,
      "g",
    ),
    (c) => " ".repeat(c.length),
  );
  const open = /<(alt-trans|ignorable)\b/.exec(inner);
  if (open)
    throw new Error(`xliff: unit ${id}: its <${open[1]}> does not close`);
  return inner;
}

function unitSpans(xml: string): UnitSpan[] {
  // Found in the text with comments masked, and each unit's fuzzy
  // matches and ignorables blanked within it, so none of theirs is taken
  // for the unit's own (#900).
  // CDATA is text, whatever tags it spells, and is hidden like comments.
  let text = masked(xml).replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (c) =>
    " ".repeat(c.length),
  );
  const out: UnitSpan[] = [];
  const find = (from: number, to: number, element: string, id: string) => {
    const re = new RegExp(
      `<${element}\\b${ATTRS}(/>|>([\\s\\S]*?)</${element}>)`,
      "y",
    );
    const at = text.slice(from, to).search(new RegExp(`<${element}\\b`));
    if (at < 0) return undefined;
    re.lastIndex = from + at;
    const m = re.exec(text);
    // A tag that does not parse, or does not close in its unit, is
    // refused: skipping the unit would drop it without a word.
    if (!m || re.lastIndex > to)
      throw new Error(
        `xliff: unit ${id}: its <${element}> does not parse or close`,
      );
    const openEnd =
      m.index +
      `<${element}`.length +
      (m[1] ?? "").length +
      (m[2] === "/>" ? 2 : 1);
    const self = m[2] === "/>";
    return {
      tag: { start: m.index, end: openEnd },
      content: self
        ? { start: openEnd, end: openEnd }
        : { start: openEnd, end: re.lastIndex - `</${element}>`.length },
      whole: { start: m.index, end: re.lastIndex },
      self,
    };
  };
  const units: {
    version: "1.2" | "2.0";
    id: string;
    start: number;
    end: number;
  }[] = [];
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
      if (id !== undefined)
        units.push({
          version,
          id: decodeEntities(id),
          start: m.index,
          end: re.lastIndex,
        });
    }
  }
  // One pass builds the blanked text, units in document order.
  let blanked = "";
  let at = 0;
  for (const u of [...units].sort((x, y) => x.start - y.start)) {
    if (u.start < at) continue;
    blanked +=
      text.slice(at, u.start) + blankInside(text.slice(u.start, u.end), u.id);
    at = u.end;
  }
  text = blanked + text.slice(at);
  for (const { version, id, start, end } of units) {
    if (version === "2.0") {
      const segments = text.slice(start, end).match(/<segment\b/g)?.length ?? 0;
      if (segments > 1)
        throw new Error(
          `xliff: unit ${id} has ${segments} segments; a unit is read as one text`,
        );
    }
    const source = find(start, end, "source", id);
    if (!source) continue;
    const target = find(start, end, "target", id);
    const segment =
      version === "2.0" ? find(start, end, "segment", id) : undefined;
    out.push({
      id,
      version,
      start,
      end,
      source: source.content,
      sourceEnd: source.whole.end,
      ...(target && !target.self && { target: target.content }),
      ...(target?.self && { emptyTarget: target.whole }),
      ...(version === "1.2" && target && { stateTag: target.tag }),
      ...(segment && { stateTag: segment.tag }),
    });
  }
  return out;
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
  const named = (tag: string, name: string, xml: string, all: boolean) =>
    xml.replace(
      new RegExp(`<${tag}\\b${ATTRS}>`, all ? "g" : ""),
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
    ? named("xliff", "trgLang", template, false)
    : named("file", "target-language", template, true);
}

// The elements a unit's placeholders and tags stand for: the target's
// own first, as the file wrote them, then the source's for the rest.
function partsOf(sources: string[]): Map<string, string[]> {
  const parts = new Map<string, string[]>();
  for (const xml of sources) {
    const found = new Map<string, string[]>();
    inlineText(xml, found);
    for (const [token, list] of found)
      if (!parts.has(token)) parts.set(token, list);
  }
  return parts;
}

// A pull into a target file (§8, #711): each translation into its unit's
// `<target>`, written only where its text changed, a text the file holds
// already left as it is, its state too; the unit's own inline elements
// restored and a state that said work turned to `translated`; a unit with
// no `<target>` gets one after its `<source>`, and a unit the file lacks
// is the source file's, appended. Every other byte stays, line endings
// as the file writes them.
export function entriesToXliff(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: string,
): string {
  translations = ownRecord(translations);
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language)
      : existing;
  const eol = eolOf(base);
  const sources = new Map(unitSpans(template).map((u) => [u.id, u]));
  const patches: Patch[] = [];
  const seen = new Set<string>();
  for (const u of unitSpans(base)) {
    seen.add(u.id);
    const text = translations[u.id];
    if (text === undefined) continue;
    const from = sources.get(u.id);
    const sourceXml = from
      ? template.slice(from.source.start, from.source.end)
      : base.slice(u.source.start, u.source.end);
    patches.push(...targetPatches(base, u, text, sourceXml, eol));
  }
  let out = applied(base, patches);
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
        const from = sources.get(id)!;
        const block = template
          .slice(from.start, from.end)
          .replace(/\r?\n/g, eol);
        const u = unitSpans(block)[0]!;
        const sourceXml = block.slice(u.source.start, u.source.end);
        return applied(
          block,
          targetPatches(block, u, translations[id]!, sourceXml, eol),
        );
      });
      out =
        out.slice(0, at) +
        blocks.map((b) => `${eol}${indent}${b}`).join("") +
        out.slice(at);
    }
  }
  return out;
}

// A unit's `<target>` written: rewritten where it differs, inserted after
// the source where it has none; `eol` is the file's the unit is in.
function targetPatches(
  base: string,
  u: UnitSpan,
  text: string,
  sourceXml: string,
  eol: string,
): Patch[] {
  if (u.target) {
    const current = base.slice(u.target.start, u.target.end);
    if (inlineText(current) === text) return [];
    const parts = partsOf([current, sourceXml]);
    const state = statePatch(base, u.stateTag);
    return [
      { ...u.target, text: inlineXml(text, parts) },
      ...(state ? [state] : []),
    ];
  }
  const parts = partsOf([sourceXml]);
  const element =
    u.version === "1.2"
      ? `<target state="translated">${inlineXml(text, parts)}</target>`
      : `<target>${inlineXml(text, parts)}</target>`;
  const patches: Patch[] = [
    u.emptyTarget
      ? { ...u.emptyTarget, text: element }
      : {
          start: u.sourceEnd,
          end: u.sourceEnd,
          text: `${eol}${lineIndent(base, u.source.start)}${element}`,
        },
  ];
  if (u.version === "2.0") {
    const state = statePatch(base, u.stateTag);
    if (state) patches.push(state);
  }
  return patches;
}

// A proposal into the source file (§11): an edit rewrites the unit's
// `<source>` with its own elements, a removal drops the unit (its lines
// too where nothing else is on them), an addition appends a unit after
// the last; an edit of a unit the file no longer has is nothing to do.
export function applyXliffOps(xml: string, ops: SourceOp[]): string {
  let out = xml;
  const eol = eolOf(xml);
  for (const op of ops) {
    const units = unitSpans(out);
    const u = units.find((unit) => unit.id === op.id);
    if (op.kind === "delete") {
      if (!u) continue;
      const lineBreak = out.lastIndexOf("\n", u.start - 1);
      let start =
        lineBreak >= 0 && /^[ \t]*$/.test(out.slice(lineBreak + 1, u.start))
          ? lineBreak
          : u.start;
      if (start < u.start && start > 0 && out[start - 1] === "\r") start -= 1;
      out = out.slice(0, start) + out.slice(u.end);
      continue;
    }
    if (u) {
      const parts = partsOf([out.slice(u.source.start, u.source.end)]);
      out =
        out.slice(0, u.source.start) +
        inlineXml(op.text, parts) +
        out.slice(u.source.end);
      continue;
    }
    if (op.kind === "edit") continue;
    const last = units.at(-1);
    const version =
      last?.version ?? (/version\s*=\s*["']2/.test(out) ? "2.0" : "1.2");
    const indent = last ? lineIndent(out, last.start) : "      ";
    const inner = `${indent}  `;
    const block =
      version === "1.2"
        ? `<trans-unit id="${escape(op.id)}" datatype="html">${eol}${inner}<source>${escape(op.text)}</source>${eol}${indent}</trans-unit>`
        : `<unit id="${escape(op.id)}">${eol}${inner}<segment>${eol}${inner}  <source>${escape(op.text)}</source>${eol}${inner}</segment>${eol}${indent}</unit>`;
    const at = last ? last.end : out.search(/<\/(?:body|file)>/);
    if (at < 0)
      throw new Error("xliff: no unit, body or file to add a unit to");
    out = out.slice(0, at) + `${eol}${indent}${block}` + out.slice(at);
  }
  return out;
}
