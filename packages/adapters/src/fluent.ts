// Fluent `.ftl` (§3, #597): messages and terms with a value, `{$var}`,
// message and term references as placeholders, a select on a variable
// as an ICU plural or select, a string literal as written (#990). A
// message's attributes, functions and number literals are refused by
// name, a message at a time (#991). A file is patched message by
// message, so an unchanged pull writes the same bytes and a changed
// message keeps its layout.
import {
  FLUENT_OPTIONS_RE,
  PLURAL_CATEGORIES,
  type StringEntry,
} from "@corpus/contract";
import type { SourceOp } from "./write";

type Message = {
  id: string;
  // The message's first line to the end of its last continuation line.
  start: number;
  end: number;
  // Just after `=`, and the end of the value, before any attribute.
  valueStart: number;
  valueEnd: number;
  attribute?: string;
};

type Style = {
  block: boolean;
  spaced: boolean;
  cont: string;
  variant: string;
  fallback: string;
  close: string;
};

const DEFAULT_STYLE: Style = {
  block: false,
  spaced: false,
  cont: "    ",
  variant: "    ",
  fallback: "    ",
  close: "  ",
};
const CATEGORIES = new Set<string>(PLURAL_CATEGORIES);
const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;
// A string literal as Fluent writes one, its quotes and escapes kept,
// and the placeable's close.
const STRING_LITERAL_RE =
  /^("(?:[^"\\\n]|\\(?:["\\]|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{6}))*")\s*\}/;
// What a `#` inside is not the count in, in an ICU view: a literal,
// `{"…"}`, a term's arguments, `{-brand(x: "#1")}`, and a format's
// options, `{n, number, x: "#"}`.
const VIEW_LITERAL_RE =
  /\{"(?:[^"\\\n]|\\.)*"\}|\{-[A-Za-z][\w-]*\((?:[^()"\n]|"(?:[^"\\\n]|\\.)*")*\)\}|\{[A-Za-z][\w-]*, (?:number|date), [^{}]*\}/g;

class Refusal extends Error {}

function messages(text: string): Message[] {
  const out: Message[] = [];
  const lines = text.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  // A brace inside a string literal, `{"{"}`, opens nothing.
  const braces = (line: string) => {
    const bare = line.replace(/"(?:[^"\\\n]|\\.)*"/g, "");
    return (bare.match(/\{/g)?.length ?? 0) - (bare.match(/\}/g)?.length ?? 0);
  };
  for (let i = 0; i < lines.length; i++) {
    const skip = i === 0 ? bom : 0;
    const head = /^(-?[A-Za-z][\w-]*)[ \t]*=/.exec(lines[i]!.slice(skip));
    if (!head) continue;
    let last = i;
    let valueLast = -1;
    let attribute: string | undefined;
    // Inside an open placeable a line continues the message wherever
    // it starts: a select's `}` may sit at column 0.
    let depth = braces(lines[i]!);
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!.replace(/\r$/, "");
      // An entry at column 0 starts anew, as Fluent's parser restarts
      // after a message it reads as Junk, a placeable left open or not:
      // no valid placeable holds such a line (#991).
      if (/^-?[A-Za-z][\w-]*[ \t]*=/.test(line)) break;
      if (depth > 0 || /^[ \t]+\S/.test(line)) {
        const named = /^[ \t]+\.([A-Za-z][\w-]*)[ \t]*=/.exec(line)?.[1];
        if (named && attribute === undefined) {
          attribute = named;
          valueLast = last;
        }
        if (line.trim() !== "") last = j;
        depth += braces(line);
      } else if (line.trim() !== "") break;
    }
    const start = offsets[i]! + skip;
    const endOf = (line: number) =>
      offsets[line]! + lines[line]!.replace(/\r$/, "").length;
    out.push({
      id: head[1]!,
      start,
      end: endOf(last),
      valueStart: start + head[0].length,
      valueEnd: endOf(valueLast < 0 ? last : valueLast),
      ...(attribute && { attribute }),
    });
    i = last;
  }
  return out;
}

// The value as Fluent reads it: the first line's text, then the
// continuation lines with their common indent removed.
function valueText(raw: string): string {
  const [first = "", ...rest] = raw.replace(/\r/g, "").split("\n");
  const indents = rest
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/.exec(line)![0].length);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  const body = rest.map((line) =>
    line.trim() === "" ? "" : line.slice(common),
  );
  const lines = first.trim() === "" ? body : [first.trimStart(), ...body];
  return lines.join("\n").trimEnd();
}

function parseText(
  s: string,
  i: number,
  id: string,
  inVariant: boolean,
): [string, number] {
  let out = "";
  while (i < s.length) {
    const c = s[i]!;
    if (c === "{") {
      const [text, next] = parsePlaceable(s, i + 1, id);
      out += text;
      i = next;
      continue;
    }
    if (inVariant && c === "}") return [out, i];
    if (inVariant && c === "\n" && /^\s*(?:\*?\[|\})/.test(s.slice(i + 1)))
      return [out, i];
    out += c;
    i++;
  }
  return [out, i];
}

// Fluent's built-in functions, read as the ICU format they apply (#990):
// `{ NUMBER($n, minimumIntegerDigits: 2) }` is
// `{n, number, minimumIntegerDigits: 2}`, the options kept as the style.
const BUILTINS: Record<string, "number" | "date"> = {
  NUMBER: "number",
  DATETIME: "date",
};
const FUNCTIONS: Record<string, string> = {
  number: "NUMBER",
  date: "DATETIME",
  time: "DATETIME",
};

function formatOf(
  s: string,
  open: number,
  id: string,
  fn: string,
  type: "number" | "date",
): [string, number] {
  const close = callEnd(s, open);
  if (close < 0)
    throw new Refusal(
      `${id} has a ${fn} call Corpus does not read (its arguments on one line)`,
    );
  const args = /^\s*\$([A-Za-z][\w-]*)\s*(?:,\s*(.*?))?\s*$/.exec(
    s.slice(open + 1, close),
  );
  if (!args)
    throw new Refusal(`${id} calls ${fn} on something other than a variable`);
  if (args[2] !== undefined && !FLUENT_OPTIONS_RE.test(args[2]))
    throw new Refusal(
      `${id} has ${fn} options Corpus does not read (name: "value" or name: number, no braces)`,
    );
  const j = skipSpace(s, close + 1);
  if (s[j] !== "}")
    throw new Refusal(
      `${id} ${s.slice(j, j + 2) === "->" ? "selects on" : "has"} a ${fn} call Corpus does not read`,
    );
  const style = args[2] === undefined ? "" : `, ${args[2]}`;
  return [`{${args[1]}, ${type}${style}}`, j + 1];
}

// The `)` that closes a term's arguments, strings skipped, on one line;
// -1 where there is none.
function callEnd(s: string, open: number): number {
  for (let k = open + 1; k < s.length; k++) {
    const ch = s[k]!;
    if (ch === "\n") return -1;
    if (ch === ")") return k;
    if (ch === '"') {
      const literal = /^"(?:[^"\\\n]|\\.)*"/.exec(s.slice(k));
      if (!literal) return -1;
      k += literal[0].length - 1;
    }
  }
  return -1;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

function parsePlaceable(s: string, i: number, id: string): [string, number] {
  let j = skipSpace(s, i);
  const c = s[j];
  // `{""}` is an empty pattern and `{"."}` the escape for a line that
  // starts with a special character, read as their text; any other
  // literal is kept as written, `{"{{c1::"}`, which the fluent reading
  // takes as its text (#990).
  const escape = /^"([.[*]?)"\s*\}/.exec(s.slice(j));
  if (escape) return [escape[1]!, j + escape[0].length];
  const literal = STRING_LITERAL_RE.exec(s.slice(j));
  if (literal) return [`{${literal[1]}}`, j + literal[0].length];
  if (c === '"')
    throw new Refusal(`${id} has a string literal Corpus does not read`);
  if (c && /[0-9]/.test(c)) throw new Refusal(`${id} has a number literal`);
  if (c === "{")
    throw new Refusal(`${id} has a placeable Corpus does not read`);
  // A term reference is the placeholder `-name` (#990), its arguments
  // kept as written, `{-brand(case: "gen")}`; a term's attribute is
  // read only as a select's selector, `{-brand.gender, select, …}`.
  const term = c === "-";
  const variable = c === "$";
  if (variable || term) j++;
  const bare = /^[A-Za-z][\w-]*/.exec(s.slice(j))?.[0];
  if (!bare) throw new Refusal(`${id} has a placeable Corpus does not read`);
  j += bare.length;
  let name = term ? `-${bare}` : bare;
  const attribute = term
    ? /^\.[A-Za-z][\w-]*/.exec(s.slice(j))?.[0]
    : undefined;
  if (attribute) {
    name += attribute;
    j += attribute.length;
  }
  let call = "";
  // Fluent allows spaces, not tabs, as @fluent/syntax reads blank_inline.
  const paren = /^ *\(/.exec(s.slice(j));
  const builtin = !term && !variable ? BUILTINS[bare] : undefined;
  if ((term || builtin) && paren) j += paren[0].length - 1;
  if (s[j] === "(" && builtin) return formatOf(s, j, id, bare, builtin);
  if (s[j] === "(") {
    if (!term) throw new Refusal(`${id} calls a function`);
    const close = callEnd(s, j);
    if (close < 0 || attribute)
      throw new Refusal(`${id} has a term reference Corpus does not read`);
    call = s.slice(j, close + 1);
    j = close + 1;
  }
  j = skipSpace(s, j);
  if (s[j] === "}") {
    if (attribute)
      throw new Refusal(
        `${id} prints a term's attribute, which only a select reads`,
      );
    // A message reference is `@name` in the view, so it reads apart
    // from a variable of the same name (#1083).
    return [`{${term || variable ? name : `@${name}`}${call}}`, j + 1];
  }
  if (!(variable || attribute) || s.slice(j, j + 2) !== "->")
    throw new Refusal(`${id} has a placeable Corpus does not read`);
  j += 2;
  const variants: { key: string; fallback: boolean; text: string }[] = [];
  for (;;) {
    // Fluent puts each variant, and the select's close, on a line of
    // its own; one that does not is Junk to Fluent's own parser (#991).
    const before = j;
    j = skipSpace(s, j);
    if (j >= s.length) throw new Refusal(`${id} has an unclosed select`);
    if (!s.slice(before, j).includes("\n"))
      throw new Refusal(
        `${id} is not valid Fluent (a variant, and a select's closing }, starts its own line)`,
      );
    if (s[j] === "}") {
      j++;
      break;
    }
    const fallback = s[j] === "*";
    if (fallback) j++;
    if (s[j] !== "[")
      throw new Refusal(`${id} has a select Corpus does not read`);
    const close = s.indexOf("]", j);
    if (close < 0) throw new Refusal(`${id} has a select Corpus does not read`);
    const key = s.slice(j + 1, close).trim();
    j = close + 1;
    while (s[j] === " " || s[j] === "\t") j++;
    const [text, next] = parseText(s, j, id, true);
    variants.push({ key, fallback, text: text.trimEnd() });
    j = next;
  }
  const defaults = variants.filter((v) => v.fallback).length;
  if (defaults !== 1)
    throw new Refusal(
      `${id} is not valid Fluent (a select has ${defaults === 0 ? "no" : "more than one"} * default variant)`,
    );
  // A term's attribute is a word, `gender`, never a count.
  const plural =
    !name.startsWith("-") &&
    variants.every((v) => CATEGORIES.has(v.key) || /^\d+$/.test(v.key));
  if (!variants.every((v) => KEY_RE.test(v.key)))
    throw new Refusal(`${id} has a variant key Corpus does not read`);
  // A `#` in a plural's variant is Fluent's text, where ICU's would be
  // the count: the view writes it as the literal `{"#"}` (#990).
  const text = (v: { text: string }) =>
    plural ? hashesAsLiterals(v.text) : v.text;
  const branches = variants.map(
    (v) =>
      `${plural && /^\d+$/.test(v.key) ? `=${v.key}` : v.key} {${text(v)}}`,
  );
  // The default carries over as `other`, which is what ICU falls back
  // to; a select keeps its own keys beside it.
  if (!variants.some((v) => v.key === "other")) {
    const fallback = variants.find((v) => v.fallback) ?? variants.at(-1)!;
    branches.push(`other {${text(fallback)}}`);
  }
  return [
    `{${name}, ${plural ? "plural" : "select"}, ${branches.join(" ")}}`,
    j,
  ];
}

function hashesAsLiterals(text: string): string {
  let out = "";
  let at = 0;
  for (const m of text.matchAll(VIEW_LITERAL_RE)) {
    out += text.slice(at, m.index).replaceAll("#", '{"#"}') + m[0];
    at = m.index + m[0].length;
  }
  return out + text.slice(at).replaceAll("#", '{"#"}');
}

function toIcu(text: string, message: Message): string {
  return parseText(
    valueText(text.slice(message.valueStart, message.valueEnd)),
    0,
    message.id,
    false,
  )[0];
}

// A file's messages; one Corpus cannot read is left out and named
// through `onRefused`, with the reason, and the rest are read (#991).
export function fluentToEntries(
  text: string,
  options: { type: string; onRefused?: (id: string, reason: string) => void },
): StringEntry[] {
  const entries: StringEntry[] = [];
  const refuse = (id: string, reason: string) =>
    options.onRefused?.(
      id,
      `${reason}; Corpus reads messages and terms with a value, variables, message and term references, string literals and selects on a variable or a term's attribute`,
    );
  for (const message of messages(text)) {
    // A term's attributes are what messages select on, kept by the
    // writer and never strings; a message's are refused (#990).
    if (message.attribute && !message.id.startsWith("-")) {
      refuse(
        message.id,
        `${message.id} has an attribute (.${message.attribute})`,
      );
      continue;
    }
    try {
      entries.push({
        id: message.id,
        type: options.type,
        source: toIcu(text, message),
      });
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      refuse(message.id, error.message);
    }
  }
  return entries;
}

function styleOf(text: string, message: Message): Style {
  const [first = "", ...rest] = text
    .slice(message.valueStart, message.valueEnd)
    .split("\n");
  const indent = (re: RegExp) =>
    rest.map((line) => re.exec(line)?.[1]).find((x) => x !== undefined);
  const variant = indent(/^([ \t]*)\[/);
  return {
    block: first.trim() === "" && rest.length > 0,
    spaced: /\{ /.test(text.slice(message.valueStart, message.valueEnd)),
    cont:
      rest
        .filter((l) => l.trim() !== "" && !/^\s*(?:\*?\[|\})/.test(l))
        .map((l) => /^[ \t]*/.exec(l)![0])[0] ?? DEFAULT_STYLE.cont,
    variant: variant ?? DEFAULT_STYLE.variant,
    fallback: indent(/^([ \t]*)\*\[/) ?? variant ?? DEFAULT_STYLE.fallback,
    close: indent(/^([ \t]*)\}/) ?? DEFAULT_STYLE.close,
  };
}

const hasSelect = (text: string, m: Message) =>
  /->/.test(text.slice(m.valueStart, m.valueEnd));

// A select's argument as Fluent writes it: a variable, or a term's
// attribute (#990).
const selector = (name: string) => (name.startsWith("-") ? name : `$${name}`);

// ICU back to a Fluent value in a style: `refs` are the message ids a
// bare name refers to.
function render(icu: string, style: Style, refs: Set<string>): string {
  const place = (inner: string) =>
    style.spaced ? `{ ${inner} }` : `{${inner}}`;
  // A line that starts with `.`, `[` or `*` would read as an attribute
  // or a variant; Fluent's escape is a string literal.
  // `inPlural`: within a plural's variant, a select's in one included,
  // where the reader made a plain `#` the literal `{"#"}`.
  const seq = (
    i: number,
    count?: string,
    lineStart = false,
    inPlural = false,
  ): [string, number] => {
    let out = "";
    let atStart = lineStart;
    while (i < icu.length) {
      const c = icu[i]!;
      if (c === "}") return [out, i];
      const wasStart = atStart;
      atStart = false;
      if (wasStart && (c === " " || c === "\t")) {
        out += c;
        atStart = true;
        i++;
      } else if (wasStart && (c === "." || c === "[" || c === "*")) {
        out += `{"${c}"}`;
        i++;
      } else if (c === "#" && count !== undefined) {
        out += place(selector(count));
        i++;
      } else if (c === "{") {
        const [text, next] = arg(i + 1, inPlural);
        out += text;
        i = next;
      } else if (c === "\n") {
        out += `\n${style.cont}`;
        atStart = true;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return [out, i];
  };
  const arg = (i: number, inPlural: boolean): [string, number] => {
    // A literal is written back as read, but the `#` a plural's variant
    // holds as one, which is Fluent's plain text there.
    const literal = /^\s*("(?:[^"\\\n]|\\.)*")\s*\}/.exec(icu.slice(i));
    if (literal)
      return [
        inPlural && literal[1] === '"#"' ? "#" : place(literal[1]!),
        i + literal[0].length,
      ];
    const head =
      /^\s*(@?[A-Za-z0-9_.-]+)(\((?:[^()"\n]|"(?:[^"\\\n]|\\.)*")*\))?\s*(?:,\s*(plural|select)\s*,)?/.exec(
        icu.slice(i),
      )!;
    const name = head[1]!;
    let j = i + head[0].length;
    if (!head[3]) {
      // A format is Fluent's function on the variable, its style the
      // options (#990).
      const format = /^,\s*(number|date|time)\s*(?:,([^}]*))?\}/.exec(
        icu.slice(j),
      );
      if (format) {
        const style = format[2]?.trim();
        return [
          place(
            `${FUNCTIONS[format[1]!]}($${name}${style ? `, ${style}` : ""})`,
          ),
          j + format[0].length,
        ];
      }
      j = icu.indexOf("}", j) + 1;
      // A term is written as it is named, with its arguments, and a
      // message reference without its `@`; a bare name is a variable but
      // where the source refers to a message so, as views before #1083
      // wrote references and a server may still hold them.
      if (name.startsWith("-")) return [place(name + (head[2] ?? "")), j];
      if (name.startsWith("@")) return [place(name.slice(1)), j];
      return [place(refs.has(name) ? name : `$${name}`), j];
    }
    const branches: [string, string][] = [];
    for (;;) {
      j = skipSpace(icu, j);
      if (icu[j] === "}") {
        j++;
        break;
      }
      const key = /^=?[\w]+/.exec(icu.slice(j))![0];
      j = skipSpace(icu, j + key.length) + 1;
      const plural = head[3] === "plural";
      const [text, next] = seq(
        j,
        plural ? name : undefined,
        false,
        inPlural || plural,
      );
      branches.push([key.replace(/^=/, ""), text]);
      j = next + 1;
    }
    const fallback = branches.some(([k]) => k === "other")
      ? "other"
      : branches.at(-1)![0];
    const lines = branches.map(
      ([key, text]) =>
        `${key === fallback ? `${style.fallback}*` : style.variant}[${key}] ${text || '{""}'}`,
    );
    const open = style.spaced
      ? `{ ${selector(name)} ->`
      : `{${selector(name)} ->`;
    return [`${open}\n${lines.join("\n")}\n${style.close}}`, j];
  };
  const [body = ""] = seq(0, undefined, true);
  const value = body === "" ? '{""}' : body;
  return style.block ? `\n${style.cont}${value}` : ` ${value}`;
}

// `whole`: the message's attributes go too, as a new target's term
// takes its value from the source but not the source's attributes.
type Change = { id: string; text?: string; whole?: boolean };

type Template = {
  text: string;
  byId: Map<string, Message>;
  refsFor: (id: string) => Set<string>;
};

function patch(text: string, changes: Change[], template: Template): string {
  const found = messages(text);
  const byId = new Map(found.map((m) => [m.id, m]));
  const fileStyle = (() => {
    const example = found.find((m) => hasSelect(text, m)) ?? found[0];
    return example ? styleOf(text, example) : DEFAULT_STYLE;
  })();
  const styleFor = (id: string): Style => {
    const own = byId.get(id);
    if (own && hasSelect(text, own)) return styleOf(text, own);
    const source = template.byId.get(id);
    const base =
      found.some((m) => hasSelect(text, m)) || !source
        ? fileStyle
        : styleOf(template.text, source);
    return own ? { ...base, block: styleOf(text, own).block } : base;
  };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = (value: string) => value.replace(/\n/g, eol);
  const patches: { start: number; end: number; text: string }[] = [];
  const appended: string[] = [];
  for (const { id, text: next, whole } of changes) {
    const message = byId.get(id);
    if (next === undefined) {
      if (!message) continue;
      let end = message.end;
      if (text[end] === "\r") end++;
      if (text[end] === "\n") end++;
      patches.push({ start: message.start, end, text: "" });
    } else if (message) {
      const end = whole ? message.end : message.valueEnd;
      if (toIcu(text, message) === next) {
        if (end !== message.valueEnd)
          patches.push({ start: message.valueEnd, end, text: "" });
        continue;
      }
      patches.push({
        start: message.valueStart,
        end,
        text: lines(render(next, styleFor(id), template.refsFor(id))),
      });
    } else {
      // A new message is inline unless it selects and the file writes
      // its selects as blocks.
      const block = /,\s*(?:plural|select)\s*,/.test(next) && fileStyle.block;
      appended.push(
        lines(
          `${id} =${render(next, { ...styleFor(id), block }, template.refsFor(id))}\n`,
        ),
      );
    }
  }
  let out = text;
  for (const p of patches.sort((a, b) => b.start - a.start))
    out = out.slice(0, p.start) + p.text + out.slice(p.end);
  if (appended.length === 0) return out;
  if (out !== "" && !out.endsWith("\n")) out += eol;
  return out + appended.join("");
}

// A bare name is a message reference where the source's own message
// writes it without `$`, or where it names a message and the source
// never uses it as a variable: cosmic-files has both `$items` and a
// message `items`.
function templateOf(template: string, added: string[] = []): Template {
  const found = messages(template);
  const byId = new Map(found.map((m) => [m.id, m]));
  const variables = new Set(
    [...template.matchAll(/\{\s*\$([A-Za-z][\w-]*)/g)].map((m) => m[1]!),
  );
  const messageNames = [...byId.keys(), ...added].filter(
    (id) => !variables.has(id),
  );
  return {
    text: template,
    byId,
    refsFor: (id) => {
      const own = byId.get(id);
      const value = own ? template.slice(own.valueStart, own.valueEnd) : "";
      const ownVariables = new Set(
        [...value.matchAll(/\{\s*\$([A-Za-z][\w-]*)/g)].map((m) => m[1]!),
      );
      const written = [...value.matchAll(/\{\s*([A-Za-z][\w-]*)\s*\}/g)]
        .map((m) => m[1]!)
        .filter((name) => !ownVariables.has(name));
      return new Set([...written, ...messageNames]);
    },
  };
}

// A target file from the translations: the existing file patched, or,
// when there is none, the source file with its values translated and
// the untranslated messages left out. Ids the translations do not
// mention are kept.
export function entriesToFluent(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
): string {
  const source = templateOf(template);
  const fresh = existing === undefined || existing.trim() === "";
  if (fresh && existing !== undefined && Object.keys(translations).length === 0)
    return existing;
  const base = fresh ? template : existing;
  const changes: Change[] = [];
  if (fresh) {
    for (const m of messages(template))
      if (!Object.hasOwn(translations, m.id)) changes.push({ id: m.id });
  }
  for (const id of [
    ...[...source.byId.keys()].filter((id) => Object.hasOwn(translations, id)),
    ...Object.keys(translations).filter((id) => !source.byId.has(id)),
  ])
    changes.push({
      id,
      text: translations[id]!,
      ...(fresh && id.startsWith("-") && { whole: true }),
    });
  return patch(base, changes, source);
}

export function applyFluentOps(text: string, ops: SourceOp[]): string {
  const source = templateOf(
    text,
    ops.filter((op) => op.kind !== "delete").map((op) => op.id),
  );
  return patch(
    text,
    ops.map((op) => (op.kind === "delete" ? { id: op.id } : op)),
    source,
  );
}
