// Fluent `.ftl` (§3, #597): messages with a value, `{$var}` and message
// references as placeholders, a select on a variable as an ICU plural or
// select. Attributes, terms, functions and string literals are refused
// by name. A file is patched message by message, so an unchanged pull
// writes the same bytes and a changed message keeps its layout.
import type { StringEntry } from "@corpus/contract";

export type FluentOp =
  | { kind: "edit" | "add"; id: string; text: string }
  | { kind: "delete"; id: string };

type Message = {
  id: string;
  // The message's first line to the end of its last continuation line.
  start: number;
  end: number;
  // Just after `=`.
  valueStart: number;
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
const CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);
const KEY_RE = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+)$/;

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
  for (let i = 0; i < lines.length; i++) {
    const head = /^(-?[A-Za-z][\w-]*)[ \t]*=/.exec(lines[i]!);
    if (!head) continue;
    let last = i;
    let attribute: string | undefined;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!.replace(/\r$/, "");
      if (/^[ \t]+\S/.test(line)) {
        last = j;
        attribute ??= /^[ \t]+\.([A-Za-z][\w-]*)[ \t]*=/.exec(line)?.[1];
      } else if (line.trim() !== "") break;
    }
    out.push({
      id: head[1]!,
      start: offsets[i]!,
      end: offsets[last]! + lines[last]!.replace(/\r$/, "").length,
      valueStart: offsets[i]! + head[0].length,
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

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

function parsePlaceable(s: string, i: number, id: string): [string, number] {
  let j = skipSpace(s, i);
  const c = s[j];
  if (c === "-") throw new Refusal(`${id} refers to a term`);
  if (c === '"' || c === "{" || (c && /[0-9]/.test(c)))
    throw new Refusal(`${id} has a string literal`);
  const variable = c === "$";
  if (variable) j++;
  const name = /^[A-Za-z][\w-]*/.exec(s.slice(j))?.[0];
  if (!name) throw new Refusal(`${id} has a placeable Corpus does not read`);
  j += name.length;
  if (s[j] === "(") throw new Refusal(`${id} calls a function`);
  j = skipSpace(s, j);
  if (s[j] === "}") return [`{${name}}`, j + 1];
  if (!variable || s.slice(j, j + 2) !== "->")
    throw new Refusal(`${id} has a placeable Corpus does not read`);
  j += 2;
  const variants: { key: string; fallback: boolean; text: string }[] = [];
  for (;;) {
    j = skipSpace(s, j);
    if (j >= s.length) throw new Refusal(`${id} has an unclosed select`);
    if (s[j] === "}") {
      j++;
      break;
    }
    const fallback = s[j] === "*";
    if (fallback) j++;
    if (s[j] !== "[")
      throw new Refusal(`${id} has a select Corpus does not read`);
    const close = s.indexOf("]", j);
    const key = s.slice(j + 1, close).trim();
    j = close + 1;
    while (s[j] === " " || s[j] === "\t") j++;
    const [text, next] = parseText(s, j, id, true);
    variants.push({ key, fallback, text: text.trimEnd() });
    j = next;
  }
  const plural = variants.every(
    (v) => CATEGORIES.has(v.key) || /^\d+$/.test(v.key),
  );
  if (!variants.every((v) => KEY_RE.test(v.key)))
    throw new Refusal(`${id} has a variant key Corpus does not read`);
  if (plural && variants.some((v) => v.text.includes("#")))
    throw new Refusal(`${id} has a # in a plural variant`);
  const branches = variants.map(
    (v) => `${plural && /^\d+$/.test(v.key) ? `=${v.key}` : v.key} {${v.text}}`,
  );
  if (plural && !variants.some((v) => v.key === "other")) {
    const fallback = variants.find((v) => v.fallback) ?? variants.at(-1)!;
    branches.push(`other {${fallback.text}}`);
  }
  return [
    `{${name}, ${plural ? "plural" : "select"}, ${branches.join(" ")}}`,
    j,
  ];
}

function toIcu(text: string, message: Message): string {
  return parseText(
    valueText(text.slice(message.valueStart, message.end)),
    0,
    message.id,
    false,
  )[0];
}

export function fluentToEntries(
  text: string,
  options: { type: string },
): StringEntry[] {
  const refusals: string[] = [];
  const entries: StringEntry[] = [];
  for (const message of messages(text)) {
    if (message.id.startsWith("-")) {
      refusals.push(`${message.id} is a term`);
      continue;
    }
    if (message.attribute) {
      refusals.push(`${message.id} has an attribute (.${message.attribute})`);
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
      refusals.push(error.message);
    }
  }
  if (refusals.length > 0) {
    throw new Error(
      `fluent: ${refusals.join("; ")}; Corpus reads messages with a value, variables, message references and selects on a variable`,
    );
  }
  return entries;
}

function styleOf(text: string, message: Message): Style {
  const [first = "", ...rest] = text
    .slice(message.valueStart, message.end)
    .split("\n");
  const indent = (re: RegExp) =>
    rest.map((line) => re.exec(line)?.[1]).find((x) => x !== undefined);
  const variant = indent(/^([ \t]*)\[/);
  return {
    block: first.trim() === "" && rest.length > 0,
    spaced: /\{ /.test(text.slice(message.valueStart, message.end)),
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
  /->/.test(text.slice(m.valueStart, m.end));

// ICU back to a Fluent value in a style: `refs` are the message ids a
// bare name refers to.
function render(icu: string, style: Style, refs: Set<string>): string {
  const place = (inner: string) =>
    style.spaced ? `{ ${inner} }` : `{${inner}}`;
  const seq = (i: number, count?: string): [string, number] => {
    let out = "";
    while (i < icu.length) {
      const c = icu[i]!;
      if (c === "}") return [out, i];
      if (c === "#" && count !== undefined) {
        out += place(`$${count}`);
        i++;
      } else if (c === "{") {
        const [text, next] = arg(i + 1);
        out += text;
        i = next;
      } else if (c === "\n") {
        out += `\n${style.cont}`;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return [out, i];
  };
  const arg = (i: number): [string, number] => {
    const head = /^\s*([A-Za-z0-9_-]+)\s*(?:,\s*(plural|select)\s*,)?/.exec(
      icu.slice(i),
    )!;
    const name = head[1]!;
    let j = i + head[0].length;
    if (!head[2]) {
      j = icu.indexOf("}", j) + 1;
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
      const [text, next] = seq(j, head[2] === "plural" ? name : undefined);
      branches.push([key.replace(/^=/, ""), text]);
      j = next + 1;
    }
    const fallback = branches.some(([k]) => k === "other")
      ? "other"
      : branches.at(-1)![0];
    const lines = branches.map(
      ([key, text]) =>
        `${key === fallback ? `${style.fallback}*` : style.variant}[${key}]${text ? ` ${text}` : ""}`,
    );
    const open = style.spaced ? `{ $${name} ->` : `{$${name} ->`;
    return [`${open}\n${lines.join("\n")}\n${style.close}}`, j];
  };
  const [body] = seq(0);
  return style.block ? `\n${style.cont}${body}` : body === "" ? "" : ` ${body}`;
}

type Change = { id: string; text?: string };

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
  const patches: { start: number; end: number; text: string }[] = [];
  const appended: string[] = [];
  for (const { id, text: next } of changes) {
    const message = byId.get(id);
    if (next === undefined) {
      if (!message) continue;
      const end = text[message.end] === "\n" ? message.end + 1 : message.end;
      patches.push({ start: message.start, end, text: "" });
    } else if (message) {
      if (toIcu(text, message) === next) continue;
      patches.push({
        start: message.valueStart,
        end: message.end,
        text: render(next, styleFor(id), template.refsFor(id)),
      });
    } else {
      // A new message is inline unless it selects and the file writes
      // its selects as blocks.
      const block = /,\s*(?:plural|select)\s*,/.test(next) && fileStyle.block;
      appended.push(
        `${id} =${render(next, { ...styleFor(id), block }, template.refsFor(id))}\n`,
      );
    }
  }
  let out = text;
  for (const p of patches.sort((a, b) => b.start - a.start))
    out = out.slice(0, p.start) + p.text + out.slice(p.end);
  if (appended.length === 0) return out;
  if (out !== "" && !out.endsWith("\n")) out += "\n";
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
      const value = own ? template.slice(own.valueStart, own.end) : "";
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
    changes.push({ id, text: translations[id]! });
  return patch(base, changes, source);
}

export function applyFluentOps(text: string, ops: FluentOp[]): string {
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
