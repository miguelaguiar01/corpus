// Rails I18n's YAML catalogues (#752): one file per language, the
// language as the root key, and strings as the scalars under it by
// their dotted path. Read with the `yaml` package's document model,
// which keeps every node where it is written, so a value that arrives
// only through an alias or a `<<:` merge is the anchor's and read once.
import type { StringEntry } from "@corpus/contract";
import {
  isAlias,
  isMap,
  isScalar,
  parseDocument,
  type Node,
  type Pair,
  type YAMLMap,
} from "yaml";

const PLURAL = ["zero", "one", "two", "few", "many", "other"] as const;

export type YamlString = {
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
    if (!key || !(PLURAL as readonly string[]).includes(key)) return undefined;
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
  const document = parseDocument(body, { uniqueKeys: false });
  if (document.errors.length > 0)
    throw new Error(document.errors[0]!.message.split("\n")[0]);
  const top = document.contents;
  const roots = isMap(top)
    ? top.items.flatMap((pair) => keyOf(pair, body) ?? [])
    : [];
  // Rails' parser keeps the last of a repeated root key.
  const rootPair = isMap(top)
    ? [...top.items].reverse().find((pair) => keyOf(pair, body) === root)
    : undefined;
  const empty =
    !isMap(top) ||
    (rootPair !== undefined &&
      (rootPair.value === null ||
        (isScalar(rootPair.value) && rootPair.value.value === null) ||
        (isMap(rootPair.value) && rootPair.value.items.length === 0)));
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
            text: pluralText(plural),
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

function pluralText(forms: Record<string, string>): string {
  const branches = PLURAL.filter((c) => Object.hasOwn(forms, c)).map(
    (c) => `${c} {${forms[c]}}`,
  );
  return `{count, plural, ${branches.join(" ")}}`;
}

// A `*_MF` key holds ICU MessageFormat, as Discourse's `I18n.messageFormat`
// reads it; every other string is the source's library.
function libraryOf(id: string): { library?: "icu" } {
  return /_MF$/.test(id) ? { library: "icu" } : {};
}

// The source file's strings.
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

type Patch = { start: number; end: number; text: string };

function applied(text: string, patches: Patch[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const p of [...patches].sort((a, b) => a.start - b.start)) {
    parts.push(text.slice(at, p.start), p.text);
    at = p.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}

function lineIndent(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(text.slice(start))![0];
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
              : code < 0x20 || code === 0x7f
                ? `\\u${code.toString(16).padStart(4, "0")}`
                : c;
  }
  return `"${out}"`;
}

// Whether a scalar written `rendered` at `indent` reads back as `text`.
function readsAs(rendered: string, indent: string, text: string): boolean {
  try {
    const document = parseDocument(`${indent}k: ${rendered}`);
    const map = document.contents;
    if (document.errors.length > 0 || !isMap(map)) return false;
    const value = map.items[0]?.value;
    return isScalar(value) && value.value === text;
  } catch {
    return false;
  }
}

// A text in the style of the scalar it replaces: plain, single- or
// double-quoted, or a `|`/`>` block at its own indentation with its
// header's indentation indicator; where that style cannot hold the text,
// double-quoted.
export function styled(
  source: string,
  node: { type?: string | null; range?: readonly number[] | null },
  text: string,
  indent: string,
): string {
  const was = node.range ? source.slice(node.range[0], node.range[1]) : "";
  let out: string | undefined;
  if (node.type === "PLAIN" && !text.includes("\n")) out = text;
  else if (node.type === "QUOTE_SINGLE" && !text.includes("\n"))
    out = `'${text.replace(/'/g, "''")}'`;
  else if (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED") {
    const header = /^([|>])([1-9]?)([+-]?)([1-9]?)/.exec(was);
    const digit = (header?.[2] || header?.[4]) ?? "";
    const lines = was.split("\n").slice(1);
    // An indentation indicator counts from the key's indentation; else
    // the first line with text sets it.
    const body = digit
      ? `${indent}${" ".repeat(Number(digit))}`
      : (lines.find((l) => l.trim() !== "")?.match(/^ */)?.[0] ??
        `${indent}  `);
    const kept = text.replace(/\n+$/, "");
    const trailing = text.length - kept.length;
    // Chomping: strip for none, clip for one, keep for more.
    const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
    // A folded block rewraps; a text with its own lines is literal.
    const mark = kept.includes("\n") ? "|" : (header?.[1] ?? "|");
    out = `${mark}${digit}${chomp}\n${kept
      .split("\n")
      .map((l) => (l === "" ? "" : `${body}${l}`))
      .join("\n")}\n${"\n".repeat(Math.max(0, trailing - 1))}`;
    if (!readsAs(out, indent, text)) out = undefined;
    else return out;
  }
  if (out !== undefined && readsAs(out, indent, text)) return out;
  return doubleQuoted(text);
}

// A plural's forms as the hash Rails reads, in CLDR's order.
function pluralBlock(
  forms: Record<string, string>,
  indent: string,
  eol: string,
): string {
  return PLURAL.filter((c) => Object.hasOwn(forms, c))
    .map((c) => `${eol}${indent}${c}: ${doubleQuoted(forms[c]!)}`)
    .join("");
}

// The forms of a plural text, or undefined for one Rails cannot hold as
// a hash (an `=N` branch, or text beside the plural).
function formsOf(text: string): Record<string, string> | undefined {
  const head = /^\s*\{\s*count\s*,\s*plural\s*,/.exec(text);
  if (!head) return undefined;
  const forms: Record<string, string> = {};
  let at = head[0].length;
  for (;;) {
    while (/\s/.test(text[at] ?? "")) at++;
    if (text[at] === "}")
      return text.slice(at + 1).trim() === "" && Object.hasOwn(forms, "other")
        ? forms
        : undefined;
    const open = text.indexOf("{", at);
    if (open < 0) return undefined;
    const key = text.slice(at, open).trim();
    if (!(PLURAL as readonly string[]).includes(key)) return undefined;
    let depth = 0;
    let end = open;
    for (; end < text.length; end++) {
      if (text[end] === "{") depth++;
      else if (text[end] === "}" && --depth === 0) break;
    }
    if (end >= text.length) return undefined;
    forms[key] = text.slice(open + 1, end);
    at = end + 1;
  }
}

// Pull's write into a target Rails catalogue (§8): a changed scalar in
// its own style, a plural's forms in its hash, a key the file lacks
// after the one before it in the source file, its parents made as
// needed; a missing file starts with its root key alone. Every other
// byte, comments and anchors among them, stays.
export function entriesToYaml(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: { source: string; code: string },
  onRefused?: (id: string, text: string) => void,
): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? `${language.code}:\n`
      : existing;
  const eol = /\r\n/.test(base) ? "\r\n" : "\n";
  const order = yamlStrings(template, language.source, { source: true }).map(
    (s) => s.id,
  );
  const document = parseDocument(base, { uniqueKeys: false });
  if (document.errors.length > 0)
    throw new Error(document.errors[0]!.message.split("\n")[0]);
  const top = document.contents;
  const rootPair = isMap(top)
    ? [...top.items].reverse().find((p) => keyOf(p, base) === language.code)
    : undefined;
  if (!rootPair)
    throw new Error(
      `no root key ${language.code}: a target file is rooted at its language's code`,
    );
  const current = new Map(
    yamlStrings(base, language.code).map((s) => [s.id, s]),
  );
  const patches: Patch[] = [];
  // Where a line ends, before its line break: the end of a value that
  // takes its line's break, or the next break after a position.
  const lineEnd = (at: number): number => {
    const nl = base[at - 1] === "\n" ? at - 1 : base.indexOf("\n", at);
    if (nl < 0) return base.length;
    return base[nl - 1] === "\r" ? nl - 1 : nl;
  };
  // Where each held id's pair and value are.
  const pairs = new Map<string, Pair>();
  const maps = new Map<string, YAMLMap>();
  const walk = (map: YAMLMap, path: string[]) => {
    maps.set(path.join("."), map);
    for (const pair of map.items) {
      const key = keyOf(pair, base);
      if (key === undefined || key === "<<") continue;
      const id = [...path, key];
      pairs.set(id.join("."), pair);
      if (isMap(pair.value) && !pluralOf(pair.value)) walk(pair.value, id);
    }
  };
  if (isMap(rootPair.value)) walk(rootPair.value, []);
  const inserted = new Map<string, string[]>();
  for (const id of order) {
    const text = translations[id];
    if (text === undefined || text === "") continue;
    const now = current.get(id);
    if (now && now.text === text) continue;
    const forms = /^\s*\{\s*count\s*,\s*plural\s*,/.test(text)
      ? formsOf(text)
      : undefined;
    if (/^\s*\{\s*count\s*,\s*plural\s*,/.test(text) && !forms) {
      onRefused?.(id, text);
      continue;
    }
    const pair = pairs.get(id);
    if (pair && pair.value && (isScalar(pair.value) || isMap(pair.value))) {
      const value = pair.value;
      const indent = lineIndent(base, (pair.key as Node).range![0]);
      if (!forms && isScalar(value)) {
        patches.push({
          start: value.range![0],
          end: value.range![1],
          text: styled(base, value, text, indent),
        });
        continue;
      }
      if (forms && isMap(value)) {
        // Each form in its own scalar, a form the hash lacks after it.
        const held = new Map<string, Pair>();
        for (const p of value.items) {
          const k = keyOf(p, base);
          if (k) held.set(k, p);
        }
        const inner = lineIndent(base, value.range![0]);
        // A form the hash lacks goes before the held form CLDR puts
        // after it, or after the last.
        for (const c of PLURAL) {
          if (!Object.hasOwn(forms, c)) continue;
          const p = held.get(c);
          if (p && isScalar(p.value)) {
            if (p.value.value !== forms[c])
              patches.push({
                start: p.value.range![0],
                end: p.value.range![1],
                text: styled(base, p.value, forms[c]!, inner),
              });
            continue;
          }
          if (p) continue;
          const line = `${inner}${c}: ${doubleQuoted(forms[c]!)}`;
          const next = PLURAL.slice(PLURAL.indexOf(c) + 1)
            .map((k) => held.get(k))
            .find((q) => q !== undefined);
          if (next) {
            const at =
              base.lastIndexOf("\n", (next.key as Node).range![0] - 1) + 1;
            patches.push({ start: at, end: at, text: `${line}${eol}` });
          } else {
            const at = lineEnd(value.range![1]);
            patches.push({ start: at, end: at, text: `${eol}${line}` });
          }
        }
        continue;
      }
      // A scalar become a plural, or a plural a scalar: the value anew.
      const keyEnd = (pair.key as Node).range![1];
      const valueEnd = value.range![1];
      const tail = base[valueEnd - 1] === "\n" ? eol : "";
      patches.push({
        start: keyEnd,
        end: valueEnd,
        text: forms
          ? `:${pluralBlock(forms, `${indent}  `, eol)}${tail}`
          : `: ${doubleQuoted(text)}${tail}`,
      });
      continue;
    }
    // A key the file lacks: under its deepest parent the file holds.
    const path = id.split(".");
    let depth = path.length - 1;
    while (depth > 0 && !maps.has(path.slice(0, depth).join("."))) depth--;
    const parent = path.slice(0, depth).join(".");
    const list = inserted.get(parent) ?? [];
    list.push(id);
    inserted.set(parent, list);
  }
  // Insertions, grouped under each held parent: the missing part of each
  // path written once, after the parent's key the source puts before it.
  for (const [parent, ids] of inserted) {
    const map = maps.get(parent);
    const depth = parent === "" ? 0 : parent.split(".").length;
    const baseIndent = map?.items[0]
      ? lineIndent(base, (map.items[0].key as Node).range![0])
      : `${lineIndent(base, (rootPair.key as Node).range![0])}  `;
    const tree: Record<string, unknown> = {};
    for (const id of ids) {
      const rest = id.split(".").slice(depth);
      let node = tree;
      rest.slice(0, -1).forEach((k) => {
        node = (node[k] ??= {}) as Record<string, unknown>;
      });
      node[rest.at(-1)!] = translations[id]!;
    }
    const render = (node: Record<string, unknown>, indent: string): string =>
      Object.entries(node)
        .map(([k, v]) => {
          if (typeof v !== "string")
            return `${eol}${indent}${k}:${render(v as Record<string, unknown>, `${indent}  `)}`;
          const forms = formsOf(v);
          return forms
            ? `${eol}${indent}${k}:${pluralBlock(forms, `${indent}  `, eol)}`
            : `${eol}${indent}${k}: ${doubleQuoted(v)}`;
        })
        .join("");
    // After the held sibling the source orders last before the first
    // inserted key, else at the start of the map.
    const first = ids[0]!;
    const siblings = map ? map.items : [];
    const before = order
      .slice(0, order.indexOf(first))
      .reverse()
      .map((o) =>
        o
          .split(".")
          .slice(0, depth + 1)
          .join("."),
      )
      .find(
        (o) =>
          pairs.has(o) &&
          o.split(".").length === depth + 1 &&
          (parent === "" || o.startsWith(`${parent}.`)),
      );
    let at: number;
    if (before) {
      const p = pairs.get(before)!;
      at = lineEnd(
        (p.value as Node | null)?.range?.[1] ?? (p.key as Node).range![1],
      );
    } else if (siblings[0]) {
      at = lineEnd(
        base.lastIndexOf("\n", (siblings[0].key as Node).range![0] - 1),
      );
    } else at = lineEnd((rootPair.key as Node).range![1]);
    patches.push({ start: at, end: at, text: render(tree, baseIndent) });
  }
  const out = applied(base, patches);
  return out.endsWith("\n") || out === base ? out : `${out}${eol}`;
}
