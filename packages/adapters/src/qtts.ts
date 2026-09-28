// Qt Linguist `.ts` (#740): XML of `<context>`s, each a `<name>` and its
// `<message>`s. A message is Qt's identity, its context, `<source>` and
// disambiguating `<comment>`; its `<translation>` is finished, or marked
// `unfinished`, `vanished` or `obsolete`.
import type { StringEntry } from "@corpus/contract";

type Span = { start: number; end: number };

export type QtMessage = {
  id: string;
  context: string;
  source: string;
  comment?: string;
  extracomment?: string;
  locations: string[];
  numerus: boolean;
  // `type` on the translation: unfinished, vanished, obsolete, or none.
  state?: string;
  translation: string;
  at: Span;
  translationAt?: Span;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

// An XML text's value: entities decoded, a reference to no character
// kept as written, and line ends read as XML reads them, so a Windows
// checkout gives the same ids.
export function qtDecode(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) => {
      if (!e.startsWith("#")) return ENTITIES[e] ?? whole;
      const code = e.startsWith("#x")
        ? parseInt(e.slice(2), 16)
        : Number(e.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
}

// An attribute's value, in either quote.
function attr(attrs: string, name: string): string | undefined {
  return new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`).exec(attrs)?.[2];
}

// A message's id: its context, its source, and the comment Qt tells two
// otherwise equal messages apart by.
export function qtId(context: string, source: string, comment?: string) {
  return comment === undefined || comment === ""
    ? `${context} | ${source}`
    : `${context} | ${source} | ${comment}`;
}

// XML comments masked, so nothing inside one is read as an element.
function masked(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, (c) => " ".repeat(c.length));
}

function inner(body: string, element: string): string | undefined {
  const m = new RegExp(
    `<${element}(?:\\s[^>]*)?>([\\s\\S]*?)</${element}>`,
  ).exec(body);
  return m ? qtDecode(m[1]!) : undefined;
}

export function qtMessages(xml: string): QtMessage[] {
  const text = masked(xml);
  const out: QtMessage[] = [];
  for (const c of text.matchAll(
    /<context(?:\s[^>]*)?>([\s\S]*?)<\/context>/g,
  )) {
    const body = c[1]!;
    const bodyAt = c.index + c[0].indexOf(">") + 1;
    const context = qtDecode(/<name>([\s\S]*?)<\/name>/.exec(body)?.[1] ?? "");
    for (const m of body.matchAll(
      /<message(\s[^>]*)?>([\s\S]*?)<\/message>/g,
    )) {
      const start = bodyAt + m.index;
      const inside = m[2]!;
      const insideAt = start + m[0].indexOf(">") + 1;
      const source = inner(inside, "source") ?? "";
      const said = inner(inside, "comment");
      const comment = said === "" ? undefined : said;
      const t =
        /<translation(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/translation>)/.exec(
          inside,
        );
      const state = t ? attr(t[1] ?? "", "type") : undefined;
      const numerus = attr(m[1] ?? "", "numerus") === "yes";
      // Length variants: a plain tr() gets the first, the longest.
      const variants = t?.[2]?.match(
        /<lengthvariant(?:\s[^>]*)?>([\s\S]*?)<\/lengthvariant>/,
      );
      out.push({
        id: qtId(context, source, comment),
        context,
        source,
        ...(comment !== undefined && { comment }),
        ...(inner(inside, "extracomment") !== undefined && {
          extracomment: inner(inside, "extracomment"),
        }),
        // lupdate's relative locations (`line="+5"`) name no line.
        locations: [...inside.matchAll(/<location(\s[^>]*?)\/?>/g)].flatMap(
          (l) => {
            const file = attr(l[1]!, "filename");
            const line = attr(l[1]!, "line");
            if (file === undefined) return [];
            return [
              line && /^\d+$/.test(line)
                ? `${qtDecode(file)}:${line}`
                : qtDecode(file),
            ];
          },
        ),
        numerus,
        ...(state !== undefined && { state }),
        translation: numerus
          ? ""
          : qtDecode(variants ? variants[1]! : (t?.[2] ?? "")),
        at: { start, end: start + m[0].length },
        ...(t && {
          translationAt: {
            start: insideAt + t.index,
            end: insideAt + t.index + t[0].length,
          },
        }),
      });
    }
  }
  return out;
}

// What is read: every message but a vanished or obsolete one.
function live(xml: string): QtMessage[] {
  return qtMessages(xml).filter(
    (m) => m.state !== "vanished" && m.state !== "obsolete",
  );
}

function noteOf(m: QtMessage): string | undefined {
  const lines = [
    ...(m.extracomment ? [m.extracomment] : []),
    ...(m.comment ? [m.comment] : []),
    ...(m.locations.length ? [`Used in ${m.locations.join(" ")}`] : []),
  ];
  return lines.length ? lines.join("\n") : undefined;
}

// The source file's messages: each its source text, keyed by Qt's
// identity.
export function qtTsToEntries(
  xml: string,
  options: { type: string },
): StringEntry[] {
  return live(xml).map((m) => {
    const note = noteOf(m);
    return {
      id: m.id,
      type: options.type,
      source: m.source,
      ...(note && { note }),
    };
  });
}

// A target file's translations: the finished ones. An unfinished one,
// with text or without, is work; its forms, for a numerus message, are
// read by #743.
export function qtTsTranslations(xml: string): StringEntry[] {
  return live(xml).flatMap((m) =>
    m.state === undefined && !m.numerus && m.translation !== ""
      ? [{ id: m.id, type: "", source: m.translation }]
      : [],
  );
}

type Patch = Span & { text: string };

// Patches applied in one pass: a fresh file takes one per message.
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

// The spaces Transifex writes as references: no-break, thin, narrow.
const REFERENCED = new Set([0xa0, 0x2009, 0x202f]);

// How a file escapes its text: lupdate and Transifex write `&quot;`,
// `&apos;` and the special spaces as references; a hand-kept file, as
// qBittorrent's WebUI, writes them as they are.
function escaperOf(xml: string): (text: string) => string {
  const texts = [
    ...xml.matchAll(/<(?:source|translation)(?:\s[^>]*)?>([^<]*)</g),
  ].map((m) => m[1]!);
  const referenced = texts.some((t) => /&(?:quot|apos);/.test(t));
  const raw = texts.some((t) => /["']/.test(t));
  const entities = referenced || !raw;
  return (text) => {
    let out = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    if (entities)
      out = out
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/[^\n\t\r -~]/gu, (c) =>
          REFERENCED.has(c.codePointAt(0)!) || c.codePointAt(0)! < 0x20
            ? `&#x${c.codePointAt(0)!.toString(16)};`
            : c,
        );
    return out;
  };
}

function lineIndent(xml: string, at: number): string {
  const start = xml.lastIndexOf("\n", at - 1) + 1;
  return /^[ \t]*/.exec(xml.slice(start))![0];
}

// The target file a missing one starts as: the source file with its
// language named and every translation emptied, as lupdate writes one.
function targetFrom(template: string, code: string): string {
  const out = template.replace(/<TS(\s[^>]*)?>/, (open, attrs = "") =>
    /\slanguage\s*=/.test(attrs)
      ? open.replace(/(\slanguage\s*=\s*)(["']).*?\2/, `$1$2${code}$2`)
      : `<TS${attrs} language="${code}">`,
  );
  const patches: Patch[] = [];
  for (const m of qtMessages(out))
    if (
      m.translationAt &&
      !m.numerus &&
      m.state !== "vanished" &&
      m.state !== "obsolete"
    )
      patches.push({
        ...m.translationAt,
        text: '<translation type="unfinished"></translation>',
      });
  return applied(out, patches);
}

// Pull's write into a target `.ts` (§8): a changed message's
// `<translation>` alone, its `unfinished` mark gone, escaped as the file
// escapes; a message the file lacks inserted from the source file after
// the one before it there, a context it lacks after the context before
// it; a missing file started from the source file. Every other byte
// stays. A numerus message's forms are #743's.
export function entriesToQtTs(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  code: string,
): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, code)
      : existing;
  const escape = escaperOf(base);
  const element = (text: string) =>
    `<translation>${escape(text)}</translation>`;
  const patches: Patch[] = [];
  const held = new Map<string, QtMessage>();
  for (const m of qtMessages(base)) {
    if (m.state === "vanished" || m.state === "obsolete") continue;
    held.set(m.id, m);
    const text = translations[m.id];
    if (text === undefined || m.numerus || !m.translationAt) continue;
    if (m.state === undefined && m.translation === text) continue;
    patches.push({ ...m.translationAt, text: element(text) });
  }
  // Messages the file lacks, with a translation to give: each after the
  // source file's message before it that the file holds, or at the
  // start of its context; a context the file lacks, whole.
  const eol = /\r\n/.test(base) ? "\r\n" : "\n";
  const source = qtMessages(template).filter(
    (m) => m.state !== "vanished" && m.state !== "obsolete",
  );
  const contexts = [
    ...base.matchAll(/<context(?:\s[^>]*)?>\s*<name>([\s\S]*?)<\/name>/g),
  ].map((c) => ({
    name: qtDecode(c[1]!),
    after: c.index + c[0].length,
  }));
  const missingContexts = new Map<string, QtMessage[]>();
  source.forEach((m, i) => {
    const text = translations[m.id];
    if (held.has(m.id) || text === undefined || m.numerus) return;
    const block = blockOf(template, m, element(text));
    const before = source
      .slice(0, i)
      .reverse()
      .find((p) => p.context === m.context && held.has(p.id));
    const context = contexts.find((c) => c.name === m.context);
    if (before) {
      const at = held.get(before.id)!.at.end;
      patches.push({
        start: at,
        end: at,
        text: `${eol}${lineIndent(base, held.get(before.id)!.at.start)}${block}`,
      });
    } else if (context) {
      patches.push({
        start: context.after,
        end: context.after,
        text: `${eol}${lineIndent(template, m.at.start)}${block}`,
      });
    } else {
      const list = missingContexts.get(m.context) ?? [];
      list.push(m);
      missingContexts.set(m.context, list);
    }
  });
  let out = applied(base, patches);
  if (missingContexts.size > 0) {
    const at = out.lastIndexOf("</TS>");
    const added = [...missingContexts]
      .map(([name, messages]) => {
        const indent = lineIndent(template, messages[0]!.at.start);
        const nameIndent = indent.slice(0, Math.max(0, indent.length - 4));
        return [
          "<context>",
          `${nameIndent}    <name>${escape(name)}</name>`,
          ...messages.map(
            (m) =>
              `${indent}${blockOf(template, m, element(translations[m.id]!))}`,
          ),
          "</context>",
        ].join(eol);
      })
      .join(eol);
    out = `${out.slice(0, at)}${added}${eol}${out.slice(at)}`;
  }
  return out;
}

// A source-file message with its translation given.
function blockOf(template: string, m: QtMessage, translation: string): string {
  const block = template.slice(m.at.start, m.at.end);
  if (!m.translationAt) return block;
  const start = m.translationAt.start - m.at.start;
  const end = m.translationAt.end - m.at.start;
  return block.slice(0, start) + translation + block.slice(end);
}
