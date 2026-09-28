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

// Whether a scalar written `rendered` at `indent` reads back as `text`,
// both as YAML 1.2 reads it and as Rails' YAML 1.1 does, where `yes`,
// `on` or `1_000` are no strings.
function readsAs(rendered: string, indent: string, text: string): boolean {
  return (["1.1", "1.2"] as const).every((version) => {
    try {
      const document = parseDocument(`${indent}k: ${rendered}`, { version });
      const map = document.contents;
      if (document.errors.length > 0 || !isMap(map)) return false;
      const value = map.items[0]?.value;
      return isScalar(value) && value.value === text;
    } catch {
      return false;
    }
  });
}

function isBlock(rendered: string): boolean {
  return /^[|>]/.test(rendered);
}

// A text in the style of the scalar it replaces: plain, single- or
// double-quoted, or a `|`/`>` block at its own indentation with its
// header's indentation indicator; where that style cannot hold the text,
// double-quoted. A block's lines end as the file's do.
export function styled(
  source: string,
  node: { type?: string | null; range?: readonly number[] | null },
  text: string,
  indent: string,
  eol = "\n",
): string {
  const was = node.range ? source.slice(node.range[0], node.range[1]) : "";
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
    // Chomping: strip for none, clip for one, keep for more.
    const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
    // A folded block rewraps; a text with its own lines is literal.
    const mark = kept.includes("\n") ? "|" : (header?.[1] ?? "|");
    const block = `${mark}${digit}${chomp}\n${kept
      .split("\n")
      .map((l) => (l === "" ? "" : `${body}${l}`))
      .join("\n")}\n${"\n".repeat(Math.max(0, trailing - 1))}`;
    if (kept !== "" && readsAs(block, indent, text))
      return block.replace(/\n/g, eol);
  }
  if (out !== undefined && readsAs(out, indent, text)) return out;
  return doubleQuoted(text);
}

// The forms of a plural text, or undefined for one a hash cannot hold
// (an `=N` branch, or text beside the plural).
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

// A key a file does not have yet, as the source writes it, else plain
// where Rails' YAML 1.1 reads it as the same string, else quoted:
// `no:` would be the key false.
function keyText(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) &&
    !/^(?:y|n|yes|no|on|off|true|false|null)$/i.test(key)
    ? key
    : doubleQuoted(key);
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
  onRefused?: (id: string, text: string) => void,
): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? `${language.code}:\n`
      : existing;
  const eol = /\r\n/.test(base) ? "\r\n" : "\n";
  const sourceStrings = yamlStrings(template, language.source, {
    source: true,
  });
  const order = sourceStrings.map((s) => s.id);
  const plural = new Set(
    sourceStrings.flatMap((s) => (s.plural ? [s.id] : [])),
  );
  // The source's own text for each key, `"no"` and `01` as written.
  const keysAsWritten = new Map<string, string>();
  const sourceDoc = parseDocument(template.replace(/^\uFEFF/, ""), {
    uniqueKeys: false,
  });
  const sourceBody = template.replace(/^\uFEFF/, "");
  const noteKeys = (map: YAMLMap, path: string[]) => {
    for (const pair of map.items) {
      const key = keyOf(pair, sourceBody);
      const range = (pair.key as Node | null)?.range;
      if (key === undefined || !range) continue;
      const id = [...path, key];
      keysAsWritten.set(id.join("."), sourceBody.slice(range[0], range[1]));
      if (isMap(pair.value)) noteKeys(pair.value, id);
    }
  };
  if (isMap(sourceDoc.contents)) {
    const root = sourceDoc.contents.items.find(
      (p) => keyOf(p, sourceBody) === language.source,
    );
    if (root && isMap(root.value)) noteKeys(root.value, []);
  }

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
  // The position after the line break that ends what reaches `at`.
  const afterLine = (at: number): number => {
    if (base[at - 1] === "\n") return at;
    const nl = base.indexOf("\n", at);
    return nl < 0 ? base.length : nl + 1;
  };
  // A pair's value, from just after its key: where it ends, a trailing
  // line break it holds included.
  const valueEnd = (pair: Pair): number => {
    const keyEnd = (pair.key as Node).range![1];
    const colon = base.indexOf(":", keyEnd) + 1;
    const value = pair.value as Node | null;
    const range = value?.range;
    if (!range || range[1] <= range[0]) return colon;
    return range[1];
  };
  // A pair's value replaced by `tail`, which starts after the key.
  const replaceValue = (pair: Pair, tail: string) => {
    const start = (pair.key as Node).range![1];
    const end = valueEnd(pair);
    const held = base[end - 1] === "\n" && !tail.endsWith("\n") ? eol : "";
    patches.push({ start, end, text: `${tail}${held}` });
  };
  const formLines = (forms: Record<string, string>, indent: string) =>
    PLURAL.filter((c) => Object.hasOwn(forms, c))
      .map((c) => `${indent}${c}: ${doubleQuoted(forms[c]!)}${eol}`)
      .join("");

  // Where each held id's pair is, and each container a key can go in:
  // a block map, or a key whose value is null, `{}` or empty.
  const pairs = new Map<string, Pair>();
  const containers = new Map<string, Pair | YAMLMap>();
  const walk = (map: YAMLMap, path: string[]) => {
    containers.set(path.join("."), map);
    for (const pair of map.items) {
      const key = keyOf(pair, base);
      if (key === undefined || key === "<<") continue;
      const id = [...path, key].join(".");
      pairs.set(id, pair);
      const value = pair.value as Node | null;
      if (isMap(value) && !value.flow && !plural.has(id))
        walk(value, [...path, key]);
      else if (
        !value ||
        (isScalar(value) && value.value === null) ||
        (isMap(value) && value.flow && value.items.length === 0)
      )
        containers.set(id, pair);
    }
  };
  const rootValue = rootPair.value as Node | null;
  if (isMap(rootValue) && !rootValue.flow) walk(rootValue, []);
  // A null or `{}` root takes its keys as a block; a root written as a
  // flow hash with keys takes nothing, every write refused.
  else if (
    !rootValue ||
    (isScalar(rootValue) && rootValue.value === null) ||
    (isMap(rootValue) && rootValue.items.length === 0)
  )
    containers.set("", rootPair);

  const missing: string[] = [];
  for (const id of order) {
    const text = translations[id];
    if (text === undefined || text === "") continue;
    const now = current.get(id);
    if (now && now.text === text) continue;
    const forms = plural.has(id) ? formsOf(text) : undefined;
    if (plural.has(id) && !forms) {
      onRefused?.(id, text);
      continue;
    }
    const pair = pairs.get(id);
    if (!pair) {
      missing.push(id);
      continue;
    }
    const value = pair.value as Node | null;
    const indent = lineIndent(base, (pair.key as Node).range![0]);
    if (!forms) {
      if (isScalar(value) && value.value !== null && value.range) {
        const out = styled(base, value, text, indent, eol);
        const wasBlock = /^[|>]/.test(base.slice(value.range[0]));
        patches.push({
          start: value.range[0],
          end: value.range[1],
          text: wasBlock && !isBlock(out) ? `${out}${eol}` : out,
        });
      } else replaceValue(pair, `: ${styled(base, {}, text, indent)}`);
      continue;
    }
    if (isMap(value) && !value.flow && value.items.length > 0) {
      // Each form in its own scalar; a form the hash lacks goes before
      // the held form CLDR puts after it, or after the last.
      const held = new Map<string, Pair>();
      for (const p of value.items) {
        const k = keyOf(p, base);
        if (k) held.set(k, p);
      }
      const inner = lineIndent(base, (value.items[0]!.key as Node).range![0]);
      for (const c of PLURAL) {
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
          else replaceValue(p, `: ${doubleQuoted(forms[c]!)}`);
          continue;
        }
        const line = `${inner}${c}: ${doubleQuoted(forms[c]!)}${eol}`;
        const next = PLURAL.slice(PLURAL.indexOf(c) + 1)
          .map((k) => held.get(k))
          .find((q) => q !== undefined);
        const at = next
          ? base.lastIndexOf("\n", (next.key as Node).range![0] - 1) + 1
          : afterLine(value.range![1]);
        patches.push({
          start: at,
          end: at,
          text:
            at === base.length && !base.endsWith("\n") ? `${eol}${line}` : line,
        });
      }
      continue;
    }
    // A scalar, a null or a flow hash become the plural's hash.
    replaceValue(
      pair,
      `:${eol}${formLines(forms, `${indent}  `).replace(new RegExp(`${eol}$`), "")}`,
    );
  }

  // Keys the file lacks, each under the deepest container it has, in
  // the source's order after the sibling the source puts before it.
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
      onRefused?.(id, translations[id]!);
      continue;
    }
    const list = byContainer.get(parent) ?? [];
    list.push(id);
    byContainer.set(parent, list);
  }
  for (const [parent, ids] of byContainer) {
    const container = containers.get(parent)!;
    const depth = parent === "" ? 0 : parent.split(".").length;
    const prefix = parent === "" ? "" : `${parent}.`;
    const pairIndent = isMap(container)
      ? lineIndent(base, (container.items[0]!.key as Node).range![0])
      : `${lineIndent(base, (container.key as Node).range![0])}  `;
    // The subtree each missing child of the container holds.
    const render = (under: string, indent: string): string => {
      const children: string[] = [];
      for (const id of ids)
        if (id.startsWith(`${under}.`) || id === under) {
          const next = id.split(".")[under.split(".").length];
          if (next !== undefined && !children.includes(next))
            children.push(next);
        }
      return children
        .map((child) => {
          const id = `${under}.${child}`;
          const key = keysAsWritten.get(id) ?? keyText(child);
          if (ids.includes(id)) {
            const text = translations[id]!;
            const forms = plural.has(id) ? formsOf(text) : undefined;
            return forms
              ? `${indent}${key}:${eol}${formLines(forms, `${indent}  `)}`
              : `${indent}${key}: ${styled("", {}, text, indent)}${eol}`;
          }
          return `${indent}${key}:${eol}${render(id, `${indent}  `)}`;
        })
        .join("");
    };
    const subtree = (child: string) => {
      const id = `${prefix}${child}`;
      const key = keysAsWritten.get(id) ?? keyText(child);
      if (ids.includes(id)) {
        const text = translations[id]!;
        const forms = plural.has(id) ? formsOf(text) : undefined;
        return forms
          ? `${pairIndent}${key}:${eol}${formLines(forms, `${pairIndent}  `)}`
          : `${pairIndent}${key}: ${styled("", {}, text, pairIndent)}${eol}`;
      }
      return `${pairIndent}${key}:${eol}${render(id, `${pairIndent}  `)}`;
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
        anchor = afterLine(valueEnd(held));
        continue;
      }
      if (
        !ids.some(
          (id) =>
            id === `${prefix}${child}` || id.startsWith(`${prefix}${child}.`),
        )
      )
        continue;
      buckets.set(anchor, (buckets.get(anchor) ?? "") + subtree(child));
    }
    for (const [at, text] of buckets) {
      if (!isMap(container)) {
        // A null, `{}` or empty value becomes the block of its keys.
        replaceValue(
          container,
          `:${eol}${text.replace(new RegExp(`${eol}$`), "")}`,
        );
        continue;
      }
      let pos = at;
      if (pos < 0) {
        // Before the first key, above the comment that goes with it.
        pos =
          base.lastIndexOf(
            "\n",
            (container.items[0]!.key as Node).range![0] - 1,
          ) + 1;
        while (pos > 0) {
          const prev = base.lastIndexOf("\n", pos - 2) + 1;
          if (!base.slice(prev, pos).trim().startsWith("#")) break;
          pos = prev;
        }
      }
      patches.push({
        start: pos,
        end: pos,
        text:
          pos === base.length && !base.endsWith("\n") ? `${eol}${text}` : text,
      });
    }
  }
  return applied(base, patches);
}
