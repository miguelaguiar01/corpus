// Qt Linguist `.ts` (#740): XML of `<context>`s, each a `<name>` and its
// `<message>`s. A message is Qt's identity, its context, `<source>` and
// disambiguating `<comment>`; its `<translation>` is finished, or marked
// `unfinished`, `vanished` or `obsolete`.
import type { StringEntry } from "@corpus/contract";
import {
  pluralCategoryIndexes,
  pluralIndexCategories,
  pluralIndexMajority,
  poPluralText,
} from "./gettext";
import { pluralBranches } from "./messages";
import { qtPluralForms } from "./qtnumerus";

type Span = { start: number; end: number };

export type QtMessage = {
  id: string;
  context: string;
  source: string;
  comment?: string;
  extracomment?: string;
  locations: string[];
  numerus: boolean;
  // A numerus message's `<numerusform>`s, in Qt's order: each its text,
  // the first of its length variants where it has several, and as
  // written, for a form a pull leaves as it is.
  forms: string[];
  formsRaw: string[];
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
  return (
    text
      .replace(/\r\n?/g, "\n")
      // lupdate's element for a control character XML cannot hold.
      .replace(
        /<byte\s+value\s*=\s*["']x([0-9a-fA-F]+)["']\s*\/>/g,
        (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
      )
      .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, e: string) => {
        if (!e.startsWith("#")) return ENTITIES[e] ?? whole;
        const code = e.startsWith("#x")
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1));
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
  );
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
      // A qsTrId message is looked up by its own id, which stays when its
      // source text changes (#745).
      const own = attr(m[1] ?? "", "id");
      out.push({
        id: own ? qtDecode(own) : qtId(context, source, comment),
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
        ...numerusForms(numerus ? (t?.[2] ?? "") : ""),
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

function numerusForms(inside: string): { forms: string[]; formsRaw: string[] } {
  const raw = [
    ...inside.matchAll(/<numerusform(?:\s[^>]*)?>([\s\S]*?)<\/numerusform>/g),
  ].map((f) => f[1]!);
  return {
    formsRaw: raw,
    forms: raw.map((r) =>
      qtDecode(
        /<lengthvariant(?:\s[^>]*)?>([\s\S]*?)<\/lengthvariant>/.exec(r)?.[1] ??
          r,
      ),
    ),
  };
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

// A numerus message's source, `%n file(s)`, as a plural on `count` with
// the one form the code writes, so a translation's plural is one: never
// on `n`, which qt names `%n`, or dropping `%n` from every form would
// pass (#743). A source a plural cannot hold stays text.
function sourcePlural(source: string): string {
  return /[{}]/.test(source) ? source : `{count, plural, other {${source}}}`;
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
      source: m.numerus ? sourcePlural(m.source) : m.source,
      ...(note && { note }),
    };
  });
}

// A target file's translations: the finished ones. An unfinished one,
// with text or without, is work. A numerus message's forms are one
// plural on `count`, each of the language's CLDR categories reading
// the form Qt's rule gives its integers (#743).
export function qtTsTranslations(xml: string, language = "en"): StringEntry[] {
  const indexes = pluralCategoryIndexes(language, qtPluralForms(language));
  return live(xml).flatMap((m) => {
    if (m.state !== undefined) return [];
    if (m.numerus)
      return m.forms.some((f) => f !== "")
        ? [{ id: m.id, type: "", source: poPluralText(m.forms, indexes) }]
        : [];
    return m.translation !== ""
      ? [{ id: m.id, type: "", source: m.translation }]
      : [];
  });
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
        // Every space but the plain one as a reference, as lupdate
        // writes them; a control character as its `<byte>` element.
        .replace(/[\p{Zs}\p{Cc}]/gu, (c) => {
          const code = c.codePointAt(0)!.toString(16);
          if (c === " " || c === "\n" || c === "\t" || c === "\r") return c;
          return /\p{Cc}/u.test(c) ? `<byte value="x${code}"/>` : `&#x${code};`;
        });
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
  for (const m of qtMessages(out)) {
    if (!m.translationAt || m.state === "vanished" || m.state === "obsolete")
      continue;
    // A numerus message keeps its forms' places, emptied.
    const whole = out.slice(m.translationAt.start, m.translationAt.end);
    const forms =
      m.numerus && !whole.endsWith("/>")
        ? out
            .slice(m.translationAt.start, m.translationAt.end)
            .replace(
              /<numerusform(\s[^>]*)?>[\s\S]*?<\/numerusform>/g,
              "<numerusform$1></numerusform>",
            )
            .replace(/^<translation(\s[^>]*?)?>/, "")
            .replace(/<\/translation>$/, "")
        : "";
    patches.push({
      ...m.translationAt,
      text: `<translation type="unfinished">${forms}</translation>`,
    });
  }
  return applied(out, patches);
}

// Pull's write into a target `.ts` (§8): a changed message's
// `<translation>` alone, its `unfinished` mark gone, escaped as the file
// escapes; a message the file lacks inserted from the source file after
// the one before it there, a context it lacks at the end; a message
// the file holds only as vanished brought back in its place; a missing
// file started from the source file. Every other byte stays. A numerus
// message's plural becomes its `<numerusform>`s in the order and number
// Qt's rule for the language gives, a form no category reads keeping
// its text (#743); a text that is not a plural there is refused.
export function entriesToQtTs(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: { tag: string; code: string },
  onRefused?: (id: string, text: string) => void,
): string {
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language.code)
      : existing;
  const escape = escaperOf(base);
  const eol = /\r\n/.test(base) ? "\r\n" : "\n";
  const categories = pluralIndexCategories(
    language.tag,
    qtPluralForms(language.tag),
  );
  const majority = pluralIndexMajority(
    language.tag,
    qtPluralForms(language.tag),
  );
  // A message's new `<translation>`, or undefined where it is unchanged
  // or cannot be written.
  const element = (
    m: QtMessage,
    text: string,
    from: string,
  ): string | undefined => {
    if (!m.numerus) {
      if (m.state === undefined && m.translation === text) return undefined;
      return `<translation>${escape(text)}</translation>`;
    }
    const branches = pluralBranches(text);
    if (!branches) {
      onRefused?.(m.id, text);
      return undefined;
    }
    // A form no category reads keeps its text. Unchanged is decided on
    // the file's own forms; a message written anyway fills such a form,
    // empty, from the category most of its integers are, so no form of
    // a finished message ships empty.
    const pick = (c: string | undefined) =>
      c === undefined ? undefined : (branches[c] ?? branches.other);
    const read = categories.map((c, i) =>
      c === undefined ? (m.forms[i] ?? "") : (pick(c) ?? ""),
    );
    if (
      m.state === undefined &&
      read.length === m.forms.length &&
      read.every((f, i) => f === m.forms[i])
    )
      return undefined;
    const forms = read.map((f, i) =>
      categories[i] === undefined && f === ""
        ? (pick(majority[i]) ?? branches.other ?? "")
        : f,
    );
    // lupdate's layout: a form a line, the file's own where it has one.
    const old = m.translationAt
      ? from.slice(m.translationAt.start, m.translationAt.end)
      : "";
    const indent = m.translationAt
      ? lineIndent(from, m.translationAt.start)
      : "";
    const open = /^<translation(?:\s[^>]*?)?>(\s*)<numerusform/.exec(old)?.[1];
    const close = /(\s*)<\/translation>$/.exec(old)?.[1];
    const between = open ?? `${eol}${indent}    `;
    const end =
      open !== undefined && close !== undefined ? close : `${eol}${indent}`;
    // A form left as it was keeps its length variants as written.
    const kept = forms.map(
      (f, i) => f === m.forms[i] && /<lengthvariant/.test(m.formsRaw[i] ?? ""),
    );
    return `<translation>${forms
      .map(
        (f, i) =>
          `${between}<numerusform${kept[i] ? ' variants="yes"' : ""}>${kept[i] ? m.formsRaw[i] : escape(f)}</numerusform>`,
      )
      .join("")}${end}</translation>`;
  };
  const patches: Patch[] = [];
  const held = new Map<string, QtMessage>();
  const gone = new Map<string, QtMessage>();
  for (const m of qtMessages(base)) {
    if (m.state === "vanished" || m.state === "obsolete") {
      gone.set(m.id, m);
      continue;
    }
    held.set(m.id, m);
    const text = translations[m.id];
    if (text === undefined || !m.translationAt) continue;
    const written = element(m, text, base);
    if (written !== undefined)
      patches.push({ ...m.translationAt, text: written });
  }
  // Messages the file lacks, with a translation to give: each after the
  // source file's message before it that the file holds, or at the
  // start of its context; a context the file lacks, whole.
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
    if (held.has(m.id) || text === undefined) return;
    // A message lupdate marked vanished and the source has again.
    const back = gone.get(m.id);
    if (back?.translationAt) {
      const written = element({ ...back, state: "unfinished" }, text, base);
      if (written !== undefined)
        patches.push({ ...back.translationAt, text: written });
      return;
    }
    const written = element(
      { ...m, state: "unfinished", forms: [] },
      text,
      template,
    );
    if (written === undefined) return;
    const block = blockOf(template, m, written).replace(/\r?\n/g, eol);
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
              `${indent}${blockOf(template, m, element({ ...m, state: "unfinished", forms: [] }, translations[m.id]!, template)!).replace(/\r?\n/g, eol)}`,
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
