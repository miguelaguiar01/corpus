// Qt Linguist `.ts` (#740): XML of `<context>`s, each a `<name>` and its
// `<message>`s. A message is Qt's identity, its context, `<source>` and
// disambiguating `<comment>`; its `<translation>` is finished, or marked
// `unfinished`, `vanished` or `obsolete`.
import type { StringEntry } from "@corpus/contract";
import { pluralTable, poPluralText } from "./gettext";
import { formOf, pluralBranches } from "./messages";
import { qtPluralForms } from "./qtnumerus";
import {
  applied,
  attr,
  decodeEntities,
  eolOf,
  lineIndent,
  masked,
  ownRecord,
  usedIn,
  type Patch,
  type Span,
} from "./text";

type QtMessage = {
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

// An XML text's value: entities decoded, a reference to no character
// kept as written, and line ends read as XML reads them, so a Windows
// checkout gives the same ids.
function qtDecode(text: string): string {
  return decodeEntities(
    text
      .replace(/\r\n?/g, "\n")
      // lupdate's element for a control character XML cannot hold.
      .replace(
        /<byte\s+value\s*=\s*["']x([0-9a-fA-F]+)["']\s*\/>/g,
        (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
      ),
  );
}

// A message's id: its context, its source, and the comment Qt tells two
// otherwise equal messages apart by.
function qtId(context: string, source: string, comment?: string) {
  return comment === undefined || comment === ""
    ? `${context} | ${source}`
    : `${context} | ${source} | ${comment}`;
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
      const extracomment = inner(inside, "extracomment");
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
        ...(extracomment !== undefined && { extracomment }),
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

function live(xml: string): QtMessage[] {
  return qtMessages(xml).filter(
    (m) => m.state !== "vanished" && m.state !== "obsolete",
  );
}

function noteOf(m: QtMessage): string | undefined {
  const lines = [
    ...(m.extracomment ? [m.extracomment] : []),
    ...(m.comment ? [m.comment] : []),
    ...usedIn(m.locations),
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
// the form Qt's rule gives its integers (#743). Forms Corpus cannot
// read as one plural, a stray brace in one, are work too, named through
// `onUnread`: a pull could never write them back (#751).
export function qtTsTranslations(
  xml: string,
  language = "en",
  onUnread?: (id: string) => void,
): StringEntry[] {
  const { indexes, categories } = pluralTable(
    language,
    qtPluralForms(language),
  );
  return live(xml).flatMap((m) => {
    if (m.state !== undefined) return [];
    if (m.numerus) {
      if (!m.forms.some((f) => f !== "")) return [];
      const text = poPluralText(m.forms, indexes);
      // Read only where the plural gives each form back, as a pull would
      // write it: a form that reads as a brace or a branch of its own
      // (`} other {`) would be rewritten on every pull.
      const branches = pluralBranches(text);
      const back =
        branches &&
        categories.every(
          (c, i) => c === undefined || formOf(branches, c) === m.forms[i],
        );
      if (back) return [{ id: m.id, type: "", source: text }];
      onUnread?.(m.id);
      return [];
    }
    return m.translation !== ""
      ? [{ id: m.id, type: "", source: m.translation }]
      : [];
  });
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
    // As lupdate's tsProtect() writes them (#747): a character below
    // 0x20 but tab and newline as its `<byte>` element, which XML cannot
    // hold raw in either style, a carriage return among them, so a text
    // with `\r\n` reads back as written. Where the file writes
    // references, a space above 0x7f as one, U+0085 among them; U+007F
    // stays raw.
    if (entities)
      out = out
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/[\u0085\p{Zs}\p{Zl}\p{Zp}]/gu, (c) =>
          c === " " ? c : `&#x${c.codePointAt(0)!.toString(16)};`,
        );
    let bytes = "";
    for (let i = 0; i < out.length; i++) {
      const c = out[i]!;
      const code = out.charCodeAt(i);
      const kept = code >= 0x20 || c === "\n" || c === "\t";
      bytes += kept ? c : `<byte value="x${code.toString(16)}"/>`;
    }
    return bytes;
  };
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
  for (const m of live(out)) {
    if (!m.translationAt) continue;
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
  translations = ownRecord(translations);
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language.code)
      : existing;
  const escape = escaperOf(base);
  const eol = eolOf(base);
  const forms = qtPluralForms(language.tag);
  const ctx: WriteContext = {
    escape,
    eol,
    ...pluralTable(language.tag, forms),
    ...(onRefused && { onRefused }),
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
    if (text === undefined) continue;
    const written = translationElement(m, text, base, ctx);
    if (written !== undefined)
      patches.push(translationPatch(base, m, written, eol));
  }
  // Messages the file lacks, with a translation to give: each after the
  // source file's message before it that the file holds, or at the
  // start of its context; a context the file lacks, whole.
  const source = live(template);
  const contexts = [
    ...masked(base).matchAll(
      /<context(?:\s[^>]*)?>\s*<name>([\s\S]*?)<\/name>/g,
    ),
  ].map((c) => ({
    name: qtDecode(c[1]!),
    after: c.index + c[0].length,
  }));
  // The file's message by id, held or vanished and back in the source
  // (#776): either stands where the source has it. An id message's id
  // names no context, so an anchor must be in the message's own.
  const inFile = (id: string) => held.get(id) ?? gone.get(id);
  const missingContexts = new Map<string, { m: QtMessage; block: string }[]>();
  source.forEach((m, i) => {
    const text = translations[m.id];
    if (held.has(m.id) || text === undefined) return;
    // A message lupdate marked vanished and the source has again.
    const back = gone.get(m.id);
    if (back?.translationAt) {
      const written = translationElement(
        { ...back, state: "unfinished" },
        text,
        base,
        ctx,
      );
      if (written !== undefined)
        patches.push({ ...back.translationAt, text: written });
      return;
    }
    const written = translationElement(
      { ...m, state: "unfinished", forms: [] },
      text,
      template,
      ctx,
    );
    if (written === undefined) return;
    const block = blockOf(template, m, written).replace(/\r?\n/g, eol);
    const before = source
      .slice(0, i)
      .reverse()
      .find(
        (p) => p.context === m.context && inFile(p.id)?.context === m.context,
      );
    const context = contexts.find((c) => c.name === m.context);
    if (before) {
      const anchor = inFile(before.id)!;
      patches.push({
        start: anchor.at.end,
        end: anchor.at.end,
        text: `${eol}${lineIndent(base, anchor.at.start)}${block}`,
      });
    } else if (context) {
      patches.push({
        start: context.after,
        end: context.after,
        text: `${eol}${lineIndent(template, m.at.start)}${block}`,
      });
    } else {
      const list = missingContexts.get(m.context) ?? [];
      list.push({ m, block });
      missingContexts.set(m.context, list);
    }
  });
  let out = applied(base, patches);
  if (missingContexts.size > 0) {
    const at = masked(out).lastIndexOf("</TS>");
    const added = [...missingContexts]
      .map(([name, messages]) => {
        const indent = lineIndent(template, messages[0]!.m.at.start);
        const nameIndent = indent.slice(0, Math.max(0, indent.length - 4));
        return [
          "<context>",
          `${nameIndent}    <name>${escape(name)}</name>`,
          ...messages.map(({ block }) => `${indent}${block}`),
          "</context>",
        ].join(eol);
      })
      .join(eol);
    out = `${out.slice(0, at)}${added}${eol}${out.slice(at)}`;
  }
  return out;
}

type WriteContext = {
  escape: (text: string) => string;
  eol: string;
  categories: (string | undefined)[];
  majority: (string | undefined)[];
  onRefused?: (id: string, text: string) => void;
};

// A message's new `<translation>`, or undefined where it is unchanged
// or cannot be written.
function translationElement(
  m: QtMessage,
  text: string,
  from: string,
  { escape, eol, categories, majority, onRefused }: WriteContext,
): string | undefined {
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
    c === undefined ? undefined : formOf(branches, c);
  const read = categories.map((c, i) =>
    c === undefined ? (m.forms[i] ?? "") : (pick(c) ?? ""),
  );
  // Forms beyond the rule's, an older rule's or lupdate's own mapping,
  // stay while the rule's are unchanged (#798); so does a file short
  // of a form no category reads, Latvian's zero (#800). A change
  // writes the rule's forms.
  if (
    m.state === undefined &&
    read.every((f, i) =>
      i < m.forms.length ? f === m.forms[i] : categories[i] === undefined,
    )
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
  const indent = lineIndent(from, m.translationAt?.start ?? sourceAt(from, m));
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
}

// A source-file message with its translation given.
function blockOf(template: string, m: QtMessage, translation: string): string {
  const { start, end, text } = translationPatch(template, m, translation, "\n");
  return (
    template.slice(m.at.start, start) + text + template.slice(end, m.at.end)
  );
}

// A message's `<translation>` written: in place of its own, or, for a
// message with none (the DTD's `translation?`), after its last element
// on a line of its own, indented as its `<source>` (#852).
function translationPatch(
  text: string,
  m: QtMessage,
  translation: string,
  eol: string,
): Patch {
  if (m.translationAt) return { ...m.translationAt, text: translation };
  const inside = masked(text.slice(m.at.start, m.at.end));
  const close = m.at.start + inside.lastIndexOf("</message>");
  const at =
    m.at.start + masked(text.slice(m.at.start, close)).trimEnd().length;
  // `</message>` on the last element's line goes to a line of its own.
  const after = text.slice(at, close).includes("\n")
    ? ""
    : `${eol}${lineIndent(text, m.at.start)}`;
  return {
    start: at,
    end: at,
    text: `${eol}${lineIndent(text, sourceAt(text, m))}${translation}${after}`,
  };
}

// Where a message's `<source>` starts.
function sourceAt(text: string, m: QtMessage): number {
  const inside = masked(text.slice(m.at.start, m.at.end));
  return m.at.start + Math.max(0, inside.indexOf("<source"));
}
