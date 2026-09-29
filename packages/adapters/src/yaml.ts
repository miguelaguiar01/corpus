// Rails I18n's YAML catalogues (#752): one file per language, the
// language as the root key, and strings as the scalars under it by
// their dotted path. Read with the `yaml` package's document model,
// which keeps every node where it is written, so a value that arrives
// only through an alias or a `<<:` merge is the anchor's and read once.
import { PLURAL_CATEGORIES, type StringEntry } from "@corpus/contract";
import {
  isAlias,
  isMap,
  isScalar,
  parseDocument,
  type Document,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";
import { pluralBranches, pluralText } from "./messages";
import { applied, eolOf, lineIndent, ownRecord, type Patch } from "./text";
import type { SourceOp } from "./write";

type YamlString = {
  id: string;
  // The string's text, or its forms for a plural hash.
  text: string;
  plural?: Record<string, string>;
  // The comment written above its key, for a translator.
  note?: string;
};

// A key's text: a string key as it reads, a number as the file writes
// it (`01`, not 1), so a pull finds it again.
function keyOf(pair: Pair, text?: string): string | undefined {
  const key = pair.key;
  if (!isScalar(key)) return undefined;
  if (typeof key.value === "string") return key.value;
  if (typeof key.value === "number")
    return text !== undefined && key.range
      ? text.slice(key.range[0], key.range[1])
      : String(key.value);
  return undefined;
}

// A hash of plural categories, `other` among them, each a string: one
// plural, as Rails reads it (#662).
function pluralOf(map: YAMLMap): Record<string, string> | undefined {
  const forms: Record<string, string> = {};
  let other = false;
  for (const pair of map.items) {
    const key = keyOf(pair);
    if (!key || !(PLURAL_CATEGORIES as readonly string[]).includes(key))
      return undefined;
    if (key === "other") other = true;
    // A form left null is one not yet written.
    if (isScalar(pair.value) && pair.value.value === null) continue;
    if (!isScalar(pair.value) || typeof pair.value.value !== "string")
      return undefined;
    forms[key] = pair.value.value;
  }
  // A hash of nulls alone is no plural yet: its nulls are skipped.
  return other && Object.keys(forms).length > 0 ? forms : undefined;
}

// The strings under a language's root key, in the file's order; a key
// with no root is none. Nulls, numbers, booleans, lists and whatever an
// alias or a merge brings are not strings of their own.
export function yamlStrings(
  text: string,
  root: string,
  // A target may be a stub, `fr:` or no key yet: no translations. The
  // source may not, since reading nothing would archive every string.
  options: { source?: boolean } = {},
): YamlString[] {
  const body = text.replace(/^\uFEFF/, "");
  const document = parseYaml(body);
  const top = document.contents;
  const roots = isMap(top)
    ? top.items.flatMap((pair) => keyOf(pair, body) ?? [])
    : [];
  const rootPair = rootPairOf(document, body, root);
  const empty =
    !isMap(top) || (rootPair !== undefined && isEmptyValue(rootPair.value));
  if (options.source && (empty || !rootPair || !isMap(rootPair.value)))
    throw new Error(
      roots.length > 0 && !roots.includes(root)
        ? `no root key ${root}: the file's root keys are ${roots.join(", ")}; the source language's file must be rooted at its code`
        : `no strings under ${root}: the source language's file must hold them`,
    );
  if (!rootPair || !isMap(rootPair.value)) {
    // A key for another language is a file named for the wrong one.
    if (roots.length > 0 && !roots.includes(root))
      throw new Error(
        `no root key ${root}: the file's root keys are ${roots.join(", ")}; name its language's code in languageFiles`,
      );
    return [];
  }
  const out: YamlString[] = [];
  const walk = (map: YAMLMap, path: string[]) => {
    map.items.forEach((pair, index) => {
      const key = keyOf(pair, body);
      if (key === undefined || key === "<<") return;
      const value = pair.value as Node | null;
      if (!value || isAlias(value)) return;
      const id = [...path, key];
      // The parser gives a map's first key's comment to the map.
      const comment = (
        (pair.key as Node).commentBefore ??
        (index === 0 ? map.commentBefore : undefined)
      )?.trim();
      const note = comment ? { note: comment } : {};
      if (isScalar(value)) {
        if (typeof value.value === "string")
          out.push({ id: id.join("."), text: value.value, ...note });
      } else if (isMap(value)) {
        const plural = pluralOf(value);
        if (plural)
          out.push({
            id: id.join("."),
            text: pluralText("count", plural),
            plural,
            ...note,
          });
        else walk(value, id);
      }
    });
  };
  walk(rootPair.value, []);
  return out;
}

// A `*_MF` key holds ICU MessageFormat, as Discourse's `I18n.messageFormat`
// reads it; every other string is the source's library.
function libraryOf(id: string): { library?: "icu" } {
  return /_MF$/.test(id) ? { library: "icu" } : {};
}

export function yamlToEntries(
  text: string,
  options: { type: string; root: string },
): StringEntry[] {
  return yamlStrings(text, options.root, { source: true }).map((s) => ({
    id: s.id,
    type: options.type,
    source: s.text,
    ...libraryOf(s.id),
    ...(s.note && { note: s.note }),
  }));
}

// A target file's translations: its non-empty strings; a lone space,
// a number's delimiter, is one (build decides what seeds).
export function yamlTranslations(text: string, root: string): StringEntry[] {
  return yamlStrings(text, root).flatMap((s) =>
    s.text === "" ||
    (s.plural && Object.values(s.plural).every((f) => f === ""))
      ? []
      : [{ id: s.id, type: "", source: s.text }],
  );
}

// YAML's own escapes for the line breaks libyaml reads in a quoted
// scalar: written raw, NEL reads back as a space (#851).
const NAMED_ESCAPES: Record<number, string> = {
  0x85: "\\N",
  0x2028: "\\L",
  0x2029: "\\P",
};

// What libyaml refuses raw anywhere in a file, a quoted scalar too: a C0
// control but tab and line feed, DEL, a C1 control, U+FFFE and U+FFFF;
// NEL and the Unicode separators it reads raw only as a break (#851).
function refusedRaw(code: number): boolean {
  return (
    (code < 0x20 && code !== 0x09 && code !== 0x0a) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfffe ||
    code === 0xffff
  );
}

function unplain(text: string): boolean {
  for (const c of text) if (refusedRaw(c.codePointAt(0)!)) return true;
  return false;
}

// A text as a double-quoted scalar: JSON's escapes, which YAML reads,
// on one line; everything else as it is.
function doubleQuoted(text: string): string {
  let out = "";
  for (const c of text) {
    const code = c.codePointAt(0)!;
    out +=
      c === "\\"
        ? "\\\\"
        : c === '"'
          ? '\\"'
          : c === "\n"
            ? "\\n"
            : c === "\t"
              ? "\\t"
              : (NAMED_ESCAPES[code] ??
                (refusedRaw(code)
                  ? `\\u${code.toString(16).padStart(4, "0")}`
                  : c));
  }
  return `"${out}"`;
}

// Whether a scalar reads back as `text` from `document`, the node
// `pick` takes, both as YAML 1.2 reads it and as Rails' YAML 1.1 does,
// where `yes`, `on` or `1_000` are no strings.
function readsBack(
  document: string,
  pick: (map: YAMLMap) => unknown,
  text: string,
): boolean {
  return (["1.1", "1.2"] as const).every((version) => {
    try {
      const read = parseDocument(document, { version });
      const map = read.contents;
      if (read.errors.length > 0 || !isMap(map)) return false;
      const value = pick(map);
      return isScalar(value) && value.value === text;
    } catch {
      return false;
    }
  });
}

// Whether `rendered` reads back as `text` inside a flow hash, where a
// comma or a bracket ends a plain scalar (#806).
function readsInFlow(rendered: string, text: string): boolean {
  if (/[\n\r]/.test(rendered)) return false;
  return readsBack(
    `k: {v: ${rendered}, w: x}`,
    (map) => {
      const flow = map.items[0]?.value;
      return isMap(flow) && flow.items.length === 2
        ? flow.items[0]?.value
        : undefined;
    },
    text,
  );
}

function readsAs(rendered: string, indent: string, text: string): boolean {
  return readsBack(
    `${indent}k: ${rendered}`,
    (map) => map.items[0]?.value,
    text,
  );
}

// A value with nothing in it: none, `~`, null or `{}`.
function isEmptyValue(node: unknown): boolean {
  return (
    !node ||
    (isScalar(node) && node.value === null) ||
    (isMap(node) && node.items.length === 0)
  );
}

function isBlock(rendered: string): boolean {
  return /^[|>]/.test(rendered);
}

// A text in the style of the scalar it replaces: plain, single- or
// double-quoted, or a `|`/`>` block at its own indentation with its
// header's indentation indicator; where that style cannot hold the text,
// double-quoted. A block's lines end as the file's do.
function styled(
  source: string,
  node: { type?: string | null; range?: readonly number[] | null },
  text: string,
  indent: string,
  eol = "\n",
): string {
  const was = node.range ? source.slice(node.range[0], node.range[1]) : "";
  if (unplain(text)) return doubleQuoted(text);
  let out: string | undefined;
  if (node.type === "PLAIN" && !text.includes("\n")) out = text;
  else if (node.type === "QUOTE_SINGLE" && !text.includes("\n"))
    out = `'${text.replace(/'/g, "''")}'`;
  else if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
    const header = /^([|>])([1-9]?)([+-]?)([1-9]?)/.exec(was);
    const digit = (header?.[2] || header?.[4]) ?? "";
    const lines = was.split(/\r?\n/).slice(1);
    // An indentation indicator counts from the key's indentation; else
    // the first line with text sets it.
    const body = digit
      ? `${indent}${" ".repeat(Number(digit))}`
      : (lines.find((l) => l.trim() !== "")?.match(/^ */)?.[0] ??
        `${indent}  `);
    const kept = text.replace(/\n+$/, "");
    const trailing = text.length - kept.length;
    const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
    // A folded block rewraps; a text with its own lines is literal.
    const mark = kept.includes("\n") ? "|" : (header?.[1] ?? "|");
    const block = `${mark}${digit}${chomp}\n${kept
      .split("\n")
      .map((l) => (l === "" ? "" : `${body}${l}`))
      .join("\n")}\n${"\n".repeat(Math.max(0, trailing - 1))}`;
    // libyaml reads a tab at a block line's start as indentation (#851).
    if (kept !== "" && !/^\t/m.test(kept) && readsAs(block, indent, text))
      return block.replace(/\n/g, eol);
  }
  if (out !== undefined && readsAs(out, indent, text)) return out;
  return doubleQuoted(text);
}

// A key a file does not have yet, as the source writes it, else plain
// where Rails' YAML 1.1 reads it as the same string, else quoted:
// `no:` would be the key false.
function keyText(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) &&
    !/^(?:y|n|yes|no|on|off|true|false|null)$/i.test(key)
    ? key
    : doubleQuoted(key);
}

// The keys of a catalogue under its root as the file writes them, by id
// (`"no"`, `01`), for a key another file lacks.
function writtenKeys(text: string, root: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = text.replace(/^\uFEFF/, "");
  const walk = (map: YAMLMap, path: string[]) => {
    for (const pair of map.items) {
      const key = keyOf(pair, body);
      const range = (pair.key as Node | null)?.range;
      if (key === undefined || !range) continue;
      const id = [...path, key];
      out.set(id.join("."), body.slice(range[0], range[1]));
      if (isMap(pair.value)) walk(pair.value, id);
    }
  };
  const top = rootPairOf(
    parseDocument(body, { uniqueKeys: false }),
    body,
    root,
  );
  if (top && isMap(top.value)) walk(top.value, []);
  return out;
}

// Pull's write into a target Rails catalogue (§8): a changed scalar in
// its own style, a plural's forms in its hash, whichever the source file
// makes the key; a key the file lacks after the one before it in the
// source file, its parents made as needed; a missing file starts with
// its root key alone. Every other byte, comments and anchors among them,
// stays.
export function entriesToYaml(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: { source: string; code: string },
  onRefused?: (id: string, text: string, why: YamlRefusal) => void,
): string {
  translations = ownRecord(translations);
  const base =
    existing === undefined || existing.trim() === ""
      ? `${language.code}:\n`
      : existing;
  const sourceStrings = yamlStrings(template, language.source, {
    source: true,
  });
  return writeYaml(
    base,
    language.code,
    sourceStrings.map((s) => s.id),
    new Set(sourceStrings.flatMap((s) => (s.plural ? [s.id] : []))),
    writtenKeys(template, language.source),
    translations,
    onRefused,
  );
}

// The write itself, into `base` rooted at `code`: `order` is the ids in
// the order a missing one is placed by, `plural` those written as a
// hash, `keysAsWritten` the text of a key the file lacks.
function writeYaml(
  base: string,
  code: string,
  order: string[],
  plural: Set<string>,
  keysAsWritten: Map<string, string>,
  translations: Record<string, string>,
  onRefused?: (id: string, text: string, why: YamlRefusal) => void,
): string {
  const file = indexYaml(base, code, plural);
  const current = new Map(yamlStrings(base, code).map((s) => [s.id, s]));
  const write: Write = {
    file,
    plural,
    translations,
    patches: [],
    ...(onRefused && { onRefused }),
  };
  const missing = patchHeld(write, order, current);
  placeMissing(write, missing, order, keysAsWritten);
  return applied(base, onLinesOfTheirOwn(base, write.patches, file.eol));
}

// The patches, each one that goes in at the end of the file starting on
// a line of its own: a file with no final line break takes one before
// the first, and no more (#837).
function onLinesOfTheirOwn(
  base: string,
  patches: Patch[],
  eol: string,
): Patch[] {
  const end = base.length;
  const through = patches.find((p) => p.start < end && p.end === end);
  // A removal's empty text leaves what came before it last.
  const before = through ? through.text || base.slice(0, through.start) : base;
  let broken = before === "" || before.endsWith("\n");
  return patches.map((p) => {
    if (p.start !== end || p.text === "") return p;
    const text = broken || p.text.startsWith(eol) ? p.text : `${eol}${p.text}`;
    broken = text.endsWith("\n");
    return { ...p, text };
  });
}

// A target file, indexed for a write: where each held id's pair is, and
// each container a key can go in: a block map, or a key whose value is
// null, `{}` or empty.
type YamlFile = {
  text: string;
  eol: string;
  // The file's own indentation step, for the blocks a write makes.
  step: string;
  pairs: Map<string, Pair>;
  containers: Map<string, Pair | YAMLMap>;
  // Pairs inside a flow hash: a scalar there is edited in place, but no
  // key goes in and no plural is written line by line (#806).
  inFlow: Set<string>;
};

type Write = {
  file: YamlFile;
  plural: Set<string>;
  translations: Record<string, string>;
  patches: Patch[];
  onRefused?: (id: string, text: string, why: YamlRefusal) => void;
};

function parseYaml(text: string): Document {
  const document = parseDocument(text, { uniqueKeys: false });
  if (document.errors.length > 0)
    throw new Error(document.errors[0]!.message.split("\n")[0]);
  return document;
}

// Rails' parser keeps the last of a repeated root key.
function rootPairOf(
  document: Document,
  text: string,
  root: string,
): Pair | undefined {
  const top = document.contents;
  return isMap(top)
    ? [...top.items].reverse().find((pair) => keyOf(pair, text) === root)
    : undefined;
}

function indexYaml(base: string, code: string, plural: Set<string>): YamlFile {
  const rootPair = rootPairOf(parseYaml(base), base, code);
  if (!rootPair)
    throw new Error(
      `no root key ${code}: a target file is rooted at its language's code`,
    );
  const pairs = new Map<string, Pair>();
  const containers = new Map<string, Pair | YAMLMap>();
  const inFlow = new Set<string>();
  const walk = (map: YAMLMap, path: string[], flow = false) => {
    if (!flow) containers.set(path.join("."), map);
    for (const pair of map.items) {
      const key = keyOf(pair, base);
      if (key === undefined || key === "<<") continue;
      const id = [...path, key].join(".");
      pairs.set(id, pair);
      if (flow) inFlow.add(id);
      const value = pair.value as Node | null;
      if (isMap(value) && value.flow && value.items.length > 0)
        walk(value, [...path, key], true);
      else if (flow) continue;
      else if (isMap(value) && !value.flow && !plural.has(id))
        walk(value, [...path, key]);
      else if (isEmptyValue(value)) containers.set(id, pair);
    }
  };
  const rootValue = rootPair.value as Node | null;
  // A null or `{}` root takes its keys as a block; a root written as a
  // flow hash is read as one: its scalars edited in place, no key added.
  if (isEmptyValue(rootValue)) containers.set("", rootPair);
  else if (isMap(rootValue)) walk(rootValue, [], rootValue.flow);
  return {
    text: base,
    eol: eolOf(base),
    step: stepOf(base, rootPair),
    pairs,
    containers,
    inFlow,
  };
}

// The indentation step of the first nested block map (#759).
function stepOf(text: string, rootPair: Pair): string {
  const queue: Pair[] = [rootPair];
  for (let pair = queue.shift(); pair; pair = queue.shift()) {
    const value = pair.value as Node | null;
    if (!isMap(value) || value.flow || value.items.length === 0) continue;
    const own = lineIndent(text, (pair.key as Node).range![0]).length;
    const child = lineIndent(
      text,
      (value.items[0]!.key as Node).range![0],
    ).length;
    if (child > own) return " ".repeat(child - own);
    queue.push(...(value.items as Pair[]));
  }
  return "  ";
}

// The position after the line break that ends what reaches `at`.
function afterLine(text: string, at: number): number {
  if (text[at - 1] === "\n") return at;
  const nl = text.indexOf("\n", at);
  return nl < 0 ? text.length : nl + 1;
}

// A pair's value, from just after its key: where it ends, a trailing
// line break it holds included.
function valueEnd(text: string, pair: Pair): number {
  const keyEnd = (pair.key as Node).range![1];
  const colon = text.indexOf(":", keyEnd) + 1;
  const range = (pair.value as Node | null)?.range;
  if (!range || range[1] <= range[0]) return colon;
  return nodeEnd(text, range);
}

// A pair's value replaced by `tail`, which starts after the key.
function valueReplaced(
  { text, eol }: YamlFile,
  pair: Pair,
  tail: string,
): Patch {
  const start = (pair.key as Node).range![1];
  const end = valueEnd(text, pair);
  const held = text[end - 1] === "\n" && !tail.endsWith("\n") ? eol : "";
  return { start, end, text: `${tail}${held}` };
}

function formLines(
  forms: Record<string, string>,
  indent: string,
  eol: string,
): string {
  return PLURAL_CATEGORIES.filter((c) => Object.hasOwn(forms, c))
    .map((c) => `${indent}${c}: ${doubleQuoted(forms[c]!)}${eol}`)
    .join("");
}

// Each changed id the file holds, patched in place; the ids it lacks,
// returned in order.
function patchHeld(
  write: Write,
  order: string[],
  current: Map<string, YamlString>,
): string[] {
  const { file, plural, translations, patches, onRefused } = write;
  const { text: base, eol } = file;
  const missing: string[] = [];
  for (const id of order) {
    const text = translations[id];
    if (text === undefined || text === "") continue;
    const now = current.get(id);
    if (now && now.text === text) continue;
    const forms = plural.has(id) ? pluralBranches(text) : undefined;
    if (plural.has(id) && !forms) {
      onRefused?.(id, text, "plural");
      continue;
    }
    const pair = file.pairs.get(id);
    if (!pair) {
      missing.push(id);
      continue;
    }
    const value = pair.value as Node | null;
    const indent = lineIndent(base, (pair.key as Node).range![0]);
    if (file.inFlow.has(id)) {
      // Inside a flow hash a plural's forms cannot go line by line, a
      // null has no text to replace in place, and a scalar keeps its
      // style only where flow reads it back.
      if (
        forms ||
        !isScalar(value) ||
        value.value === null ||
        !value.range ||
        value.range[1] <= value.range[0]
      ) {
        onRefused?.(id, text, "parent");
        continue;
      }
      const own = styled(base, value, text, indent, eol);
      const out =
        !isBlock(own) && readsInFlow(own, text) ? own : doubleQuoted(text);
      patches.push({ start: value.range[0], end: value.range[1], text: out });
      continue;
    }
    if (!forms) {
      if (isScalar(value) && value.value !== null && value.range) {
        const out = styled(base, value, text, indent, eol);
        const wasBlock = isBlock(base.slice(value.range[0]));
        patches.push({
          start: value.range[0],
          end: value.range[1],
          text: wasBlock && !isBlock(out) ? `${out}${eol}` : out,
        });
      } else
        patches.push(
          valueReplaced(file, pair, `: ${styled(base, {}, text, indent)}`),
        );
      continue;
    }
    if (isMap(value) && !value.flow && value.items.length > 0) {
      patchPluralHash(write, value, forms);
      continue;
    }
    // A scalar, a null or a flow hash become the plural's hash.
    patches.push(
      valueReplaced(
        file,
        pair,
        `:${eol}${formLines(forms, `${indent}${file.step}`, eol).replace(new RegExp(`${eol}$`), "")}`,
      ),
    );
  }
  return missing;
}

// Each form in its own scalar; a form the hash lacks goes before the
// held form CLDR puts after it, or after the last.
function patchPluralHash(
  { file, patches }: Write,
  value: YAMLMap,
  forms: Record<string, string>,
): void {
  const { text: base, eol } = file;
  const held = new Map<string, Pair>();
  for (const p of value.items) {
    const k = keyOf(p, base);
    if (k) held.set(k, p);
  }
  const inner = lineIndent(base, (value.items[0]!.key as Node).range![0]);
  for (const c of PLURAL_CATEGORIES) {
    if (!Object.hasOwn(forms, c)) continue;
    const p = held.get(c);
    if (p) {
      const v = p.value as Node | null;
      if (isScalar(v) && v.value === forms[c]) continue;
      if (isScalar(v) && v.value !== null && v.range)
        patches.push({
          start: v.range[0],
          end: v.range[1],
          text: styled(base, v, forms[c]!, inner, eol),
        });
      else patches.push(valueReplaced(file, p, `: ${doubleQuoted(forms[c]!)}`));
      continue;
    }
    const line = `${inner}${c}: ${doubleQuoted(forms[c]!)}${eol}`;
    // Before the next form the text keeps: one it drops goes, its
    // comment with it, and cannot be an anchor (#759).
    const next = PLURAL_CATEGORIES.slice(PLURAL_CATEGORIES.indexOf(c) + 1)
      .filter((k) => Object.hasOwn(forms, k))
      .map((k) => held.get(k))
      .find((q) => q !== undefined);
    const at = next
      ? base.lastIndexOf("\n", (next.key as Node).range![0] - 1) + 1
      : afterLine(base, nodeEnd(base, value.range!));
    patches.push({ start: at, end: at, text: line });
  }
  // A form the text no longer has goes, with its comment, so the hash
  // holds the text's forms (#759).
  for (const [c, p] of held)
    if (
      (PLURAL_CATEGORIES as readonly string[]).includes(c) &&
      !Object.hasOwn(forms, c)
    )
      patches.push(pairRemoval(base, value, p));
}

// Keys the file lacks, each under the deepest container it has, in the
// source's order after the sibling the source puts before it.
function placeMissing(
  write: Write,
  missing: string[],
  order: string[],
  keysAsWritten: Map<string, string>,
): void {
  const { file, plural, translations, patches, onRefused } = write;
  const { text: base, eol, step, pairs, containers } = file;
  const byContainer = new Map<string, string[]>();
  for (const id of missing) {
    const path = id.split(".");
    let depth = path.length - 1;
    while (depth > 0 && !containers.has(path.slice(0, depth).join(".")))
      depth--;
    const parent = path.slice(0, depth).join(".");
    // Under a key the file holds as a flow hash, a scalar or an alias,
    // there is nowhere to write it without moving what is there.
    if (
      !containers.has(parent) ||
      pairs.has(path.slice(0, depth + 1).join("."))
    ) {
      onRefused?.(id, translations[id]!, "parent");
      continue;
    }
    const list = byContainer.get(parent) ?? [];
    list.push(id);
    byContainer.set(parent, list);
  }
  // Deepest first: where two containers' keys go in at one place, the
  // end of a map, the deeper one's continue that map and the other's
  // follow it, and patches at one place keep the order they came in
  // (#802).
  const containersInOrder = [...byContainer].sort(
    ([a], [b]) =>
      (b === "" ? 0 : b.split(".").length) -
      (a === "" ? 0 : a.split(".").length),
  );
  for (const [parent, ids] of containersInOrder) {
    const container = containers.get(parent)!;
    const depth = parent === "" ? 0 : parent.split(".").length;
    const prefix = parent === "" ? "" : `${parent}.`;
    const pairIndent = isMap(container)
      ? lineIndent(base, (container.items[0]!.key as Node).range![0])
      : `${lineIndent(base, (container.key as Node).range![0])}${step}`;
    // A missing key's lines: its text, or the subtree of missing keys
    // under it.
    const node = (id: string, child: string, indent: string): string => {
      const key = keysAsWritten.get(id) ?? keyText(child);
      if (ids.includes(id)) {
        const text = translations[id]!;
        const forms = plural.has(id) ? pluralBranches(text) : undefined;
        return forms
          ? `${indent}${key}:${eol}${formLines(forms, `${indent}${step}`, eol)}`
          : `${indent}${key}: ${styled("", {}, text, indent)}${eol}`;
      }
      const under = `${indent}${step}`;
      const children: string[] = [];
      for (const i of ids)
        if (i.startsWith(`${id}.`) || i === id) {
          const next = i.split(".")[id.split(".").length];
          if (next !== undefined && !children.includes(next))
            children.push(next);
        }
      return `${indent}${key}:${eol}${children
        .map((c) => node(`${id}.${c}`, c, under))
        .join("")}`;
    };
    // The container's children in the source's order: a held one moves
    // the anchor, a missing one is written after it.
    const children: string[] = [];
    for (const id of order)
      if (parent === "" || id.startsWith(prefix)) {
        const child = id.split(".")[depth];
        if (child !== undefined && !children.includes(child))
          children.push(child);
      }
    const buckets = new Map<number, string>();
    let anchor = -1;
    for (const child of children) {
      const held = pairs.get(`${prefix}${child}`);
      if (held) {
        anchor = afterLine(base, valueEnd(base, held));
        continue;
      }
      if (
        !ids.some(
          (id) =>
            id === `${prefix}${child}` || id.startsWith(`${prefix}${child}.`),
        )
      )
        continue;
      buckets.set(
        anchor,
        (buckets.get(anchor) ?? "") +
          node(`${prefix}${child}`, child, pairIndent),
      );
    }
    for (const [at, text] of buckets)
      patches.push(insertion(file, container, at, text));
  }
}

// Where a container's missing keys go in: at `at`, after a held
// sibling, or before its first key where `at` is -1.
function insertion(
  file: YamlFile,
  container: Pair | YAMLMap,
  at: number,
  text: string,
): Patch {
  const { text: base, eol } = file;
  if (!isMap(container)) {
    const block = text.replace(new RegExp(`${eol}$`), "");
    // An empty value takes the block after its line, a comment on it
    // kept on it (`g: # later`, #759); a null, `~` or `{}` written
    // there becomes the block.
    const range = (container.value as Node | null)?.range;
    if (range && range[1] > range[0])
      return valueReplaced(file, container, `:${eol}${block}`);
    const keyEnd = (container.key as Node).range![1];
    let end = base.indexOf("\n", keyEnd);
    if (end < 0) end = base.length;
    else if (base[end - 1] === "\r") end--;
    return { start: end, end, text: `${eol}${block}` };
  }
  let pos = at;
  if (pos < 0) {
    // Before the first key, above the comment that goes with it.
    pos =
      base.lastIndexOf("\n", (container.items[0]!.key as Node).range![0] - 1) +
      1;
    while (pos > 0) {
      const prev = base.lastIndexOf("\n", pos - 2) + 1;
      if (!base.slice(prev, pos).trim().startsWith("#")) break;
      pos = prev;
    }
  }
  return { start: pos, end: pos, text };
}

// Why a write was refused: a plural a Rails hash cannot hold, or a key
// whose parent is a scalar, a flow hash or an alias.
export type YamlRefusal = "plural" | "parent";

// Where a node ends. A map ending in a commented empty value (`u: #
// keep`) reaches into the next line's indentation; it ends at that
// line's start (#804).
function nodeEnd(text: string, range: readonly number[]): number {
  const end = range[1]!;
  const nl = text.lastIndexOf("\n", end - 1);
  if (nl >= range[0]! && /^[ \t]*$/.test(text.slice(nl + 1, end)))
    return nl + 1;
  return end;
}

// Where a pair's content ends: a map's last item's, since the library
// lets a map's range take the comment lines after it (#804).
function contentEnd(text: string, pair: Pair): number {
  const value = pair.value as Node | null;
  if (isMap(value) && !value.flow && value.items.length > 0)
    return contentEnd(text, value.items[value.items.length - 1] as Pair);
  return value?.range && value.range[1] > value.range[0]
    ? nodeEnd(text, value.range)
    : (pair.key as Node).range![1];
}

// A pair's lines, removed: from its key's line, or the comment lines
// just above it, through the line its value ends on.
function pairRemoval(text: string, map: YAMLMap, pair: Pair): Patch {
  const keyStart = (pair.key as Node).range![0];
  let start = text.lastIndexOf("\n", keyStart - 1) + 1;
  // Comment lines above go with it, never a line of the value before
  // it: a block scalar's `# Heading` is text.
  const index = map.items.indexOf(pair);
  const before = index > 0 ? map.items[index - 1] : undefined;
  const floor = before ? contentEnd(text, before) : 0;
  while (start > floor) {
    const prev = text.lastIndexOf("\n", start - 2) + 1;
    if (prev < floor || !text.slice(prev, start).trim().startsWith("#")) break;
    start = prev;
  }
  const end = contentEnd(text, pair);
  const nl = text[end - 1] === "\n" ? end : text.indexOf("\n", end) + 1;
  return { start, end: nl <= 0 ? text.length : nl, text: "" };
}

// A proposal into a Rails catalogue (§11), the source file or, for a
// removal, a target: an edit rewrites the key's scalar in its own style,
// an addition goes after the last key of its parent the file holds, its
// parents made as needed, a plural text as a hash; a removal drops the
// key's lines and the comment above it. An edit of a key the file no
// longer has, or a removal of one, is nothing to do.
export function applyYamlOps(
  text: string,
  ops: SourceOp[],
  code: string,
): string {
  const strings = yamlStrings(text, code);
  const held = new Set(strings.map((s) => s.id));
  const order = strings.map((s) => s.id);
  const plural = new Set(strings.flatMap((s) => (s.plural ? [s.id] : [])));
  const writes = ownRecord<string>({});
  for (const op of ops) {
    if (op.kind === "delete") continue;
    if (op.kind === "edit" && !held.has(op.id)) continue;
    writes[op.id] = op.text;
    if (held.has(op.id)) continue;
    // After the last held key sharing the most of its path.
    const path = op.id.split(".");
    let at = -1;
    for (let depth = path.length - 1; depth >= 0 && at < 0; depth--) {
      const prefix = path.slice(0, depth).join(".");
      order.forEach((id, i) => {
        if (depth === 0 || id.startsWith(`${prefix}.`)) at = i;
      });
    }
    order.splice(at + 1, 0, op.id);
    // A `*_MF` key is ICU the app compiles: a scalar whatever its text.
    if (!/_MF$/.test(op.id) && pluralBranches(op.text)) plural.add(op.id);
  }
  const out =
    Object.keys(writes).length === 0
      ? text
      : writeYaml(
          text,
          code,
          order,
          plural,
          writtenKeys(text, code),
          writes,
          (id, _text, why) => {
            throw new Error(
              why === "plural"
                ? `${id}: a plural a Rails hash cannot hold (an =N branch, or text beside it)`
                : `${id}: its parent in the file is a scalar, a hash written inline or an alias, which cannot take the key`,
            );
          },
        );
  const removals = ops.filter((o) => o.kind === "delete").map((o) => o.id);
  if (removals.length === 0) return out;
  const root = rootPairOf(parseDocument(out, { uniqueKeys: false }), out, code);
  const spans: Patch[] = [];
  const walk = (map: YAMLMap, path: string[]) => {
    for (const pair of map.items) {
      const key = keyOf(pair, out);
      if (key === undefined) continue;
      const id = [...path, key].join(".");
      if (removals.includes(id)) {
        spans.push(pairRemoval(out, map, pair));
      } else if (isMap(pair.value) && pair.value.flow) {
        const inside = removals.find((r) => r.startsWith(`${id}.`));
        if (inside)
          throw new Error(
            `${inside}: its parent in the file is a hash written inline, which a removal cannot edit line by line`,
          );
      } else if (isMap(pair.value)) walk(pair.value, [...path, key]);
    }
  };
  if (root && isMap(root.value) && root.value.flow) {
    // A root written inline cannot lose a line either (#865).
    const keys = root.value.items.flatMap((pair) => keyOf(pair, out) ?? []);
    const inside = removals.find((r) =>
      keys.some((k) => r === k || r.startsWith(`${k}.`)),
    );
    if (inside)
      throw new Error(
        `${inside}: its parent in the file is a hash written inline, which a removal cannot edit line by line`,
      );
  } else if (root && isMap(root.value)) walk(root.value, []);
  return applied(out, spans);
}
