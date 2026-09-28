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

export function qtDecode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) =>
    e.startsWith("#x")
      ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : e.startsWith("#")
        ? String.fromCodePoint(Number(e.slice(1)))
        : (ENTITIES[e] ?? whole),
  );
}

// A message's id: its context, its source, and the comment Qt tells two
// otherwise equal messages apart by.
export function qtId(context: string, source: string, comment?: string) {
  return comment === undefined
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
  for (const c of text.matchAll(/<context>([\s\S]*?)<\/context>/g)) {
    const body = c[1]!;
    const bodyAt = c.index + "<context>".length;
    const context = qtDecode(/<name>([\s\S]*?)<\/name>/.exec(body)?.[1] ?? "");
    for (const m of body.matchAll(
      /<message(\s[^>]*)?>([\s\S]*?)<\/message>/g,
    )) {
      const start = bodyAt + m.index;
      const inside = m[2]!;
      const insideAt = start + m[0].indexOf(">") + 1;
      const source = inner(inside, "source") ?? "";
      const comment = inner(inside, "comment");
      const t =
        /<translation(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/translation>)/.exec(
          inside,
        );
      const state = t
        ? /\stype\s*=\s*"([^"]*)"/.exec(t[1] ?? "")?.[1]
        : undefined;
      const numerus = /\snumerus\s*=\s*"yes"/.test(m[1] ?? "");
      out.push({
        id: qtId(context, source, comment),
        context,
        source,
        ...(comment !== undefined && { comment }),
        ...(inner(inside, "extracomment") !== undefined && {
          extracomment: inner(inside, "extracomment"),
        }),
        locations: [
          ...inside.matchAll(
            /<location\s+filename="([^"]*)"(?:\s+line="(\d+)")?\s*\/>/g,
          ),
        ].map((l) => (l[2] ? `${qtDecode(l[1]!)}:${l[2]}` : qtDecode(l[1]!))),
        numerus,
        ...(state !== undefined && { state }),
        translation: numerus ? "" : qtDecode(t?.[2] ?? ""),
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
