// gettext `.po` and `.pot` (#668): the msgid is the text and the key, a
// `msgid_plural` with its `msgstr[n]` one plural, mapped to CLDR's
// categories through the file's `Plural-Forms`.
import {
  PLURAL_CATEGORIES,
  pluralRulesOf,
  REMOVED_PLURAL_CATEGORIES,
  type StringEntry,
} from "@corpus/contract";
import { GETTEXT_PLURALS } from "./gettextplurals";
import { formOf, plainForPlural, pluralBranches } from "./messages";
import {
  applied,
  eolOf,
  ownRecord,
  usedIn,
  type Patch,
  type Span,
} from "./text";

// gettext joins a context to its msgid with EOT, a control character an
// id cannot hold; its visible symbol stands in (#668).
export const CONTEXT_SEPARATOR = "␄";

type PoEntry = {
  msgctxt?: string;
  msgid: string;
  msgidPlural?: string;
  // `msgstr`, or `msgstr[n]` by index.
  msgstr: string[];
  flags: string[];
  extracted: string[];
  references: string[];
  // Where the entry sits in the text read: its lines, its `#,`, `#|` and
  // translator comment lines, where its msgid (or msgid_plural) ends,
  // and each msgstr's keyword line through its last continuation.
  at: {
    start: number;
    end: number;
    idEnd: number;
    flags?: Span;
    previous: Span[];
    comments: Span[];
    msgstr: (Span | undefined)[];
  };
};

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\u0007": "\\a",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
};

// A C escape read: the inverse of `ESCAPES`, and octal and hex codes.
const UNESCAPES: Record<string, string> = Object.fromEntries(
  Object.entries(ESCAPES).map(([c, e]) => [e.slice(1), c]),
);

const BYTE_ESCAPE = /\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3})/g;

function unescape(text: string): string {
  return text.replace(
    /(?:\\(?:x[0-9a-fA-F]{1,2}|[0-7]{1,3}))+|\\(.)/g,
    (run: string, c: string | undefined) =>
      c === undefined ? escapedBytes(run) : (UNESCAPES[c] ?? c),
  );
}

// A run of numeric escapes is bytes, UTF-8 as msgfmt reads them (#849);
// a run that is not UTF-8 reads a character per escape.
function escapedBytes(run: string): string {
  const codes = [...run.matchAll(BYTE_ESCAPE)].map(([, c]) =>
    c!.startsWith("x") ? parseInt(c!.slice(1), 16) : parseInt(c!, 8),
  );
  if (codes.every((b) => b <= 0xff))
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        new Uint8Array(codes),
      );
    } catch {
      // Not UTF-8.
    }
  return String.fromCharCode(...codes);
}

// The quoted strings of a keyword and its continuation lines, joined,
// then read as one, as msgfmt reads them: a character's escaped bytes
// may be split across lines (#926). msgfmt reads each string's escapes
// on their own, so each line's numeric escapes are widened to their
// full width first, and none takes the next line's digits.
function quoted(lines: string[]): string {
  return unescape(
    lines
      .map((line) => /^[^"]*"((?:[^"\\]|\\.)*)"\s*$/.exec(line)?.[1] ?? "")
      .map((content) =>
        content.replace(
          /\\(?:x([0-9a-fA-F]{1,2})|([0-7]{1,3})|.)/g,
          (escape: string, hex?: string, octal?: string) =>
            hex !== undefined
              ? `\\x${hex.padStart(2, "0")}`
              : octal !== undefined
                ? `\\${octal.padStart(3, "0")}`
                : escape,
        ),
      )
      .join(""),
  );
}

// Every entry of a file, the header's included (its msgid empty), the
// obsolete `#~` ones not: they are kept in the file, never read. An
// entry ends at a blank line, or where the next one's comments or
// msgctxt/msgid follow its msgid or msgstr with none, as msgfmt reads
// it (#842). Offsets are the text's own, a BOM and CRLF included.
export function parsePo(text: string): PoEntry[] {
  const out: PoEntry[] = [];
  const fresh = (): PoEntry => ({
    msgid: "",
    msgstr: [],
    flags: [],
    extracted: [],
    references: [],
    at: {
      start: -1,
      end: -1,
      idEnd: -1,
      previous: [],
      comments: [],
      msgstr: [],
    },
  });
  let entry = fresh();
  let seenId = false;
  let seenStr = false;
  let key: string | undefined;
  let keyStart = 0;
  let lastEnd = 0;
  let acc: string[] = [];
  const flush = () => {
    if (key === undefined) return;
    const value = quoted(acc);
    if (key === "msgctxt") entry.msgctxt = value;
    else if (key === "msgid") {
      entry.msgid = value;
      entry.at.idEnd = lastEnd;
      seenId = true;
    } else if (key === "msgid_plural") {
      entry.msgidPlural = value;
      entry.at.idEnd = lastEnd;
    } else {
      const index = key === "msgstr" ? "0" : /^msgstr\[(\d+)\]$/.exec(key)?.[1];
      if (index !== undefined) {
        entry.msgstr[Number(index)] = value;
        entry.at.msgstr[Number(index)] = { start: keyStart, end: lastEnd };
      }
    }
    key = undefined;
    acc = [];
  };
  const end = () => {
    flush();
    if (seenId) out.push(entry);
    entry = fresh();
    seenId = false;
    seenStr = false;
  };
  const begin = (at: number) => {
    if (entry.at.start < 0) entry.at.start = at;
  };
  let at = text.startsWith("\uFEFF") ? 1 : 0;
  while (at <= text.length) {
    const next = text.indexOf("\n", at);
    const stop = next < 0 ? text.length : next;
    const line = text.slice(at, stop).replace(/\r$/, "");
    const lineEnd = at + line.length;
    if (line.trim() === "") {
      end();
    } else if (line.startsWith("#~")) {
      // An obsolete entry's line: kept, never read.
    } else if (line.startsWith("#")) {
      flush();
      if (seenStr || seenId) end();
      begin(at);
      entry.at.end = lineEnd;
      if (line.startsWith("#,")) {
        entry.flags.push(
          ...line
            .slice(2)
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
        );
        entry.at.flags = { start: at, end: lineEnd };
      } else if (line.startsWith("#|"))
        entry.at.previous.push({ start: at, end: lineEnd });
      else if (line.startsWith("#."))
        entry.extracted.push(line.slice(2).trim());
      else if (line.startsWith("#:"))
        entry.references.push(line.slice(2).trim());
      else if (/^#(?:\s|$)/.test(line))
        entry.at.comments.push({ start: at, end: lineEnd });
    } else {
      const keyword =
        /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)(?=[\s"]|$)/.exec(
          line,
        );
      if (keyword) {
        flush();
        if (
          (seenStr || seenId) &&
          (keyword[1] === "msgctxt" || keyword[1] === "msgid")
        )
          end();
        begin(at);
        key = keyword[1];
        keyStart = at;
        if (key!.startsWith("msgstr")) seenStr = true;
        acc = [line.slice(keyword[1]!.length)];
        lastEnd = lineEnd;
        entry.at.end = lineEnd;
      } else if (line.trimStart().startsWith('"')) {
        acc.push(line);
        lastEnd = lineEnd;
        entry.at.end = lineEnd;
      }
    }
    if (next < 0) break;
    at = next + 1;
  }
  end();
  return out;
}

function headerOf(entries: PoEntry[]): PoEntry | undefined {
  return entries.find((e) => e.msgid === "" && !e.msgctxt);
}

// A header's fields: `Language`, `Plural-Forms` and the rest.
function poHeader(entries: PoEntry[]): Record<string, string> {
  const header = headerOf(entries);
  const out: Record<string, string> = {};
  for (const line of (header?.msgstr[0] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function poId(entry: Pick<PoEntry, "msgctxt" | "msgid">): string {
  return entry.msgctxt === undefined
    ? entry.msgid
    : `${entry.msgctxt}${CONTEXT_SEPARATOR}${entry.msgid}`;
}

// The numbers a category is tried on: the integers to a thousand and
// the millions, which gettext's expression can take; a category only
// decimals reach (Russian's other, Czech's many) has none.
const INTEGERS = [
  ...Array.from({ length: 1001 }, (_, i) => i),
  1_000_000,
  2_000_000,
  10_000_000,
];

// `Plural-Forms`' expression as a function of n: C's integer arithmetic
// less division, comparisons, logic and the conditional, and nothing
// else; anything outside that, or an expression that throws or leaves
// the index range on any integer tried, is refused, not run twice.
function pluralFunction(
  forms: string,
  nplurals: number,
): ((n: number) => number) | undefined {
  const expr = /plural\s*=\s*([^;]+);?/.exec(forms)?.[1]?.trim();
  if (!expr || !/^[n0-9\s()?:!=<>&|%+\-*]+$/.test(expr)) return undefined;
  try {
    const f = new Function("n", `return Number(${expr});`) as (
      n: number,
    ) => number;
    for (const n of INTEGERS) {
      const index = f(n);
      if (!Number.isInteger(index) || index < 0 || index >= nplurals)
        return undefined;
    }
    return f;
  } catch {
    return undefined;
  }
}

// How many integers of each CLDR category the file's expression sends
// to each index; undefined with no expression to go by.
function tally(
  rules: Intl.PluralRules,
  forms: string | undefined,
): { nplurals: number; counts: Map<string, Map<number, number>> } | undefined {
  const nplurals = Number(/nplurals\s*=\s*(\d+)/.exec(forms ?? "")?.[1] ?? 0);
  const plural =
    forms && nplurals > 0 ? pluralFunction(forms, nplurals) : undefined;
  if (!plural) return undefined;
  const counts = new Map<string, Map<number, number>>();
  for (const n of INTEGERS) {
    const category = rules.select(n);
    const byIndex = counts.get(category) ?? new Map<number, number>();
    const index = plural(n);
    byIndex.set(index, (byIndex.get(index) ?? 0) + 1);
    counts.set(category, byIndex);
  }
  return { nplurals, counts };
}

function cldrOrder(rules: Intl.PluralRules): string[] {
  const categories = rules.resolvedOptions().pluralCategories;
  return PLURAL_CATEGORIES.filter((c) => categories.includes(c));
}

// How a language's CLDR categories and a file's `msgstr[n]` meet, from
// one reading of its rules and its `Plural-Forms`:
// - `indexes`: which index each category reads, the one the most of its
//   integers are given; a category no integer reaches reads `other`'s,
//   and with no expression to go by the categories in CLDR's order are
//   the indexes;
// - `categories`: the category each index is written from, of those
//   that read it the one the most of its integers are, a tie to CLDR's
//   order; an index no category reads (Latvian's form for zero alone)
//   is none, and keeps what the file holds;
// - `majority`: the category the most integers at each index belong to,
//   whether or not it reads that index: what fills a form no category
//   reads, where a file must hold text (#743);
// - `oneCategory`: whether the language's integers reach one category
//   alone (Khmer, Lao), every form then that category's text (#1104).
export function pluralTable(
  language: string,
  forms: string | undefined,
): {
  indexes: Map<string, number>;
  categories: (string | undefined)[];
  majority: (string | undefined)[];
  oneCategory: boolean;
} {
  const rules = pluralRulesOf(language);
  const found = tally(rules, forms);
  const order = cldrOrder(rules);
  const indexes = indexesOf(rules, found, order);
  return {
    indexes,
    categories: categoriesOf(found, order, indexes),
    majority: majorityOf(found, order),
    oneCategory: (found ? found.counts.size : order.length) === 1,
  };
}

type Tally = ReturnType<typeof tally>;

function indexesOf(
  rules: Intl.PluralRules,
  found: Tally,
  order: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!found) {
    order.forEach((c, i) => out.set(c, i));
    return out;
  }
  for (const [category, byIndex] of found.counts)
    // A tie goes to the lower index: French's one is 0 and 1, which
    // `(n != 1)` sends to two indexes, and msgstr[0] is the singular.
    out.set(
      category,
      [...byIndex].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0],
    );
  for (const category of rules.resolvedOptions().pluralCategories)
    if (!out.has(category))
      out.set(category, out.get("other") ?? found.nplurals - 1);
  return out;
}

function categoriesOf(
  found: Tally,
  order: string[],
  indexes: Map<string, number>,
): (string | undefined)[] {
  return Array.from({ length: found?.nplurals ?? order.length }, (_, i) => {
    let best: string | undefined;
    let most = -1;
    for (const category of order) {
      if (indexes.get(category) !== i) continue;
      const count = found?.counts.get(category)?.get(i) ?? 0;
      if (count > most) {
        best = category;
        most = count;
      }
    }
    return best;
  });
}

function majorityOf(found: Tally, order: string[]): (string | undefined)[] {
  if (!found) return order;
  return Array.from({ length: found.nplurals }, (_, i) => {
    let best: string | undefined;
    let most = 0;
    for (const category of order) {
      const count = found.counts.get(category)?.get(i) ?? 0;
      if (count > most) {
        best = category;
        most = count;
      }
    }
    return best;
  });
}

type Table = ReturnType<typeof pluralTable> & {
  // The file's own keys, where CLDR's leave a form unread (#982), and
  // the keys each form is read by, some forms more than one.
  own: boolean;
  keysAt: string[][];
  // The keys a reading shows: a CLDR-keyed file's categories that read
  // a form (#973); a file keyed as it picks shows every key it has.
  picked?: (string | undefined)[];
};

// A gettext file's table: CLDR's categories where they read every form
// an integer reaches, as `pluralTable` maps them. Where one is left
// unread (Cebuano's `(n != 1)`, whose `one` holds 1, 2, 3, 5, …), the
// forms are keyed as the file picks them, so ICU picks the same text
// for every integer, save for a category Node's CLDR has dropped: the
// form most integers reach is `other`; another is the CLDR category
// whose integers are exactly its own, else one CLDR dropped for the
// language (Hebrew's many), else `=k` for each of the few integers that
// reach it (Filipino's `(n > 1)`: `=0` and `=1`), where no larger
// integer does. A file with a form none of these fits is read by CLDR's
// categories after all, that form keeping its text.
function gettextTable(language: string, forms: string | undefined): Table {
  const table = pluralTable(language, forms);
  const cldr = {
    ...table,
    own: false,
    keysAt: [],
    picked: table.categories,
  };
  const found = reachOf(forms);
  if (!found) return cldr;
  const { reach, plural } = found;
  if (
    table.categories.every((c, i) => c !== undefined || reach[i]!.length === 0)
  )
    return cldr;
  const rules = pluralRulesOf(language);
  const other = reach.reduce(
    (best, r, i) => (r.length > reach[best]!.length ? i : best),
    0,
  );
  const removed = Object.entries(
    REMOVED_PLURAL_CATEGORIES[language.split(/[-_@]/)[0]!.toLowerCase()] ?? {},
  );
  const keysAt = reach.map((integers, i): string[] | null => {
    if (i === other) return ["other"];
    if (integers.length === 0) return [];
    const held = new Set(integers);
    const exactly = (test: (n: number) => boolean) =>
      INTEGERS.every((n) => test(n) === held.has(n));
    const category =
      cldrOrder(rules).find(
        (c) => c !== "other" && exactly((n) => rules.select(n) === c),
      ) ?? removed.find(([, test]) => exactly(test))?.[0];
    if (category) return [category];
    // `=k` names k alone: never a million, nor a k the thousand or the
    // million above it shares a form with (`n % 1000000 == 0`).
    const alone =
      integers.length <= FEW &&
      integers.every(
        (k) => k <= 1000 && plural(k + 1000) !== i && plural(k + 1e6) !== i,
      );
    return alone ? integers.map((k) => `=${k}`) : null;
  });
  if (keysAt.includes(null)) return cldr;
  const categories = keysAt.map((k) => k?.[0]);
  return {
    indexes: new Map(
      keysAt.flatMap((keys, i) => (keys ?? []).map((k) => [k, i] as const)),
    ),
    categories,
    majority: categories,
    oneCategory: cldr.oneCategory,
    own: true,
    keysAt: keysAt.map((k) => k ?? []),
  };
}

// The most integers a form is keyed by one `=k` each.
const FEW = 3;

// The integers the file's expression sends to each index; undefined
// with no expression to go by.
function reachOf(
  forms: string | undefined,
): { reach: number[][]; plural: (n: number) => number } | undefined {
  const nplurals = Number(/nplurals\s*=\s*(\d+)/.exec(forms ?? "")?.[1] ?? 0);
  const plural =
    forms && nplurals > 0 ? pluralFunction(forms, nplurals) : undefined;
  if (!plural) return undefined;
  const reach = Array.from({ length: nplurals }, () => [] as number[]);
  for (const n of INTEGERS) reach[plural(n)]!.push(n);
  return { reach, plural };
}

// A plural entry's forms as one ICU plural on `count`, a branch for
// every category the language has, each the form its index names.
// `picked`, a target file's: the categories its `Plural-Forms` reads a
// form for, and `other`, which a plural needs. One it reads none for,
// French's `many`, would show a form the file cannot hold (#973).
export function poPluralText(
  forms: string[],
  indexes: Map<string, number>,
  picked?: readonly (string | undefined)[],
): string {
  const exact = [...indexes.keys()]
    .filter((k) => k.startsWith("="))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const ordered = [...exact, ...PLURAL_CATEGORIES].filter(
    (c) => indexes.has(c) && (!picked || c === "other" || picked.includes(c)),
  );
  const branch = (c: string) =>
    forms[indexes.get(c)!] ?? forms[forms.length - 1] ?? "";
  return `{count, plural, ${ordered.map((c) => `${c} {${branch(c)}}`).join(" ")}}`;
}

function noteOf(entry: PoEntry): string | undefined {
  const lines = [...entry.extracted, ...usedIn(entry.references)];
  return lines.length ? lines.join("\n") : undefined;
}

// A source file's strings, the `.pot` or the source-language `.po`: each
// msgid is its key and its text, a plural the msgid and `msgid_plural`
// as `one` and `other`.
export function gettextToEntries(
  text: string,
  options: { type: string },
): StringEntry[] {
  return parsePo(text)
    .filter((e) => e.msgid !== "")
    .map((e) => {
      const note = noteOf(e);
      return {
        id: poId(e),
        type: options.type,
        source:
          e.msgidPlural === undefined
            ? e.msgid
            : poPluralText(
                [e.msgid, e.msgidPlural],
                new Map([
                  ["one", 0],
                  ["other", 1],
                ]),
              ),
        keyIsText: true,
        ...(note && { note }),
      };
    });
}

// The ids of a source file's msgid and msgid_plural pairs: two forms,
// which gettext picks between by n == 1 in any language (#1029).
export function gettextPluralIds(text: string): Set<string> {
  return new Set(
    parsePo(text)
      .filter((e) => e.msgid !== "" && e.msgidPlural !== undefined)
      .map(poId),
  );
}

// A target file's translations: the entries someone translated, a
// fuzzy one being a guess still to check, a plural as one ICU plural in
// the language's categories.
export function gettextTranslations(
  text: string,
  language: string,
): StringEntry[] {
  return poTexts(text, language, false);
}

// The categories a target file's `Plural-Forms` can pick, one for each
// `msgstr[n]` a category reads, in CLDR's order: what a translation of
// it holds, whatever more the language has (#951). A file there is read
// by its own header, one with no rule as CLDR's order, as the reader and
// the writer read it (#973); a missing or empty file is the one pull
// writes, with the language's table. `shared`: the exact keys one form
// is read by, which a plural writes one text for (#1060), Filipino's
// `=0` and `=1` under `nplurals=2; plural=(n > 1);`.
export function gettextPluralReading(
  text: string | undefined,
  language: string,
): { categories: string[]; shared: string[][] } {
  const table = gettextTable(language, fileForms(text, language));
  if (!table.own)
    return {
      categories: PLURAL_CATEGORIES.filter((c) => table.categories.includes(c)),
      shared: [],
    };
  const keys = [...table.indexes.keys()];
  return {
    categories: [
      ...keys
        .filter((k) => k.startsWith("="))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      ...PLURAL_CATEGORIES.filter((c) => keys.includes(c)),
    ],
    shared: table.keysAt.filter((k) => k.length > 1),
  };
}

export function gettextPluralCategories(
  text: string | undefined,
  language: string,
): string[] {
  return gettextPluralReading(text, language).categories;
}

// A target file's Plural-Forms, or, for a file not there yet, the one
// pull would write from the language's table.
function fileForms(
  text: string | undefined,
  language: string,
): string | undefined {
  if (text !== undefined && text.trim() !== "")
    return poHeader(parsePo(text))["Plural-Forms"];
  const rule = pluralRuleOf(language);
  return rule && `nplurals=${rule.nplurals}; plural=${rule.plural};`;
}

// A target file's fuzzy entries, msgmerge's guesses: not translations,
// but what a translator may start from (#721).
export function gettextSuggestions(
  text: string,
  language: string,
): StringEntry[] {
  return poTexts(text, language, true);
}

function poTexts(
  text: string,
  language: string,
  fuzzy: boolean,
): StringEntry[] {
  const entries = parsePo(text);
  // The config's tag says the language; the header's code may be one
  // the runtime cannot read (`sr@latin`).
  const { indexes, picked } = gettextTable(
    language,
    poHeader(entries)["Plural-Forms"],
  );
  return entries
    .filter((e) => e.msgid !== "" && e.flags.includes("fuzzy") === fuzzy)
    .flatMap((e) => {
      if (e.msgidPlural === undefined) {
        const t = e.msgstr[0] ?? "";
        return t === "" ? [] : [{ id: poId(e), type: "", source: t }];
      }
      if (e.msgstr.every((t) => (t ?? "") === "")) return [];
      return [
        {
          id: poId(e),
          type: "",
          source: poPluralText(
            e.msgstr.map((t) => t ?? ""),
            indexes,
            picked,
          ),
        },
      ];
    });
}

function escape(text: string): string {
  return [...text].map((c) => ESCAPES[c] ?? c).join("");
}

const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

// Columns as a terminal counts them: an East Asian wide character two,
// a combining mark none.
function columns(text: string): number {
  let n = 0;
  for (const c of text) n += /\p{M}/u.test(c) ? 0 : WIDE.test(c) ? 2 : 1;
  return n;
}

const WIDTH = 79;

const CLOSES =
  /[)\]}。、，．：；！？」』）】〕〉》ー々〻・ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ！？：；，．]/u;
const OPENS = /[([{「『（【〔〈《]/u;

// Whether a line may break between two characters, as Unicode's line
// breaking (UAX #14) allows it in text msgmerge wraps: after spaces,
// after a word's hyphen or a slash before a letter, between a closing
// and an opening bracket, and around East Asian wide characters, except
// before closing punctuation or after opening; at a quote only beside
// a wide character.
function breaks(before2: string, before: string, after: string): boolean {
  if (after === " " || after === "\n") return false;
  if (before === " ") return true;
  if (/["']/.test(after)) return WIDE.test(before) || CLOSES.test(before);
  if (/["']/.test(before)) return WIDE.test(after);
  const letter = /\p{L}/u.test(after);
  if (before === "-") return letter && before2 !== "" && before2 !== " ";
  if (before === "/") return letter;
  if (/[)\]}]/.test(before) && /[([{]/.test(after)) return true;
  if (WIDE.test(before) || WIDE.test(after))
    return !CLOSES.test(after) && !OPENS.test(before);
  return false;
}

// A keyword and its string as msgmerge writes them: one line when it
// fits, else an empty first string and a line per `\n`, each broken
// where it may to stay within 79 columns, the quotes counted; an entry
// flagged `no-wrap` breaks at `\n` alone.
function poLines(keyword: string, value: string, wraps = true): string[] {
  const portions = value.split(/(?<=\n)/);
  const first = wrap(portions[0] ?? "", keyword.length + 1, wraps);
  if (portions.length <= 1 && first.length === 1)
    return [`${keyword} "${first[0]}"`];
  return [
    `${keyword} ""`,
    ...portions.flatMap((p) => wrap(p, 0, wraps)).map((line) => `"${line}"`),
  ];
}

// One portion of a value, escaped, in lines that fit from column `start`.
function wrap(portion: string, start: number, wraps: boolean): string[] {
  const chars = [...portion];
  const words: string[] = [];
  chars.forEach((c, i) => {
    if (i > 0 && breaks(chars[i - 2] ?? "", chars[i - 1]!, c)) words.push("");
    if (words.length === 0) words.push("");
    words[words.length - 1] += escape(c);
  });
  const lines: string[] = [];
  let line = "";
  let at = start;
  for (const word of words) {
    if (line !== "" && wraps && at + columns(line + word) + 2 > WIDTH) {
      lines.push(line);
      line = "";
      at = 0;
    }
    line += word;
  }
  lines.push(line);
  return lines;
}

// The target file a missing one starts as: the template, its header's
// `Language:` the file's code, its charset UTF-8 and its fuzzy flag
// gone, as msginit does. A template that is the source language's own
// `.po` keeps its entries with every msgstr emptied, or its text would
// seed as the new language's (#725).
function targetFrom(
  template: string,
  language: { tag: string; code: string },
  onNote?: (message: string) => void,
): string {
  const code = language.code;
  const entries = parsePo(template);
  const eol = eolOf(template);
  const header = headerOf(entries);
  const rule = pluralRuleOf(language.tag);
  // Every msgstr empty; a plural's as many as the language's forms,
  // when the header is the language's own (#786).
  const patches: Patch[] = entries
    .filter((e) => e !== header)
    .flatMap((e) => {
      const count =
        rule && e.msgidPlural !== undefined ? rule.nplurals : e.msgstr.length;
      const extra = e.at.msgstr
        .slice(count)
        .flatMap((s) => (s ? [msgstrRemoval(template, s)] : []));
      return [
        ...entryPatches(
          template,
          e,
          Array.from({ length: count }, () => ""),
          eol,
        ),
        ...extra,
      ];
    });
  // A `.pot`, whose msgstrs are all empty, is kept as msginit keeps it.
  const translated = entries.some(
    (e) => e !== header && e.msgstr.some((m) => m !== ""),
  );
  // A target's translators are not the new language's (#1101).
  const fromTarget =
    translated || /^Language: *\S/m.test(header?.msgstr[0] ?? "");
  if (fromTarget)
    for (const e of entries)
      for (const comment of e === header
        ? creditLines(template, headerComments(template, e, entries))
        : e.at.comments)
        patches.push(lineRemoval(template, comment));
  const span = header?.at.msgstr[0];
  if (header && span) {
    if (header.at.flags)
      patches.push(fuzzyRemoval(template, header, header.at.flags));
    let block = template.slice(span.start, span.end);
    if (fromTarget)
      for (const [field, placeholder] of TRANSLATOR_FIELDS)
        if (new RegExp(`^"${field}:`, "m").test(block))
          block = withHeaderField(
            block,
            field,
            `"${field}: ${placeholder}\\n"`,
            eol,
          );
    block = block.replace(/charset=CHARSET/, "charset=UTF-8");
    block = /"Language:[^"\\]*(?:\\.[^"\\]*)*"/.test(block)
      ? block.replace(/("Language:)[^"\\]*(\\n")/, `$1 ${code}$2`)
      : `${block}${eol}"Language: ${code}\\n"`;
    // The language's own forms, as msginit writes them (#786): the
    // template's are its language's, or a .pot's placeholder.
    if (rule) {
      const line = `"Plural-Forms: nplurals=${rule.nplurals}; plural=${rule.plural};\\n"`;
      block = withHeaderField(block, "Plural-Forms", line, eol);
    } else
      onNote?.(
        `no CLDR plural rule for ${language.tag}; the new file's Plural-Forms is the template's, or none`,
      );
    patches.push({ ...span, text: block });
  }
  let started = applied(template, patches);
  // Credits alone above a blank line leave it first: it goes too.
  const bom = started.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (
    fromTarget &&
    !/^\uFEFF?[ \t]*\r?\n/.test(template) &&
    /^\uFEFF?[ \t]*\r?\n/.test(started)
  )
    started = bom + started.slice(bom.length).replace(/^(?:[ \t]*\r?\n)+/, "");
  return fromTarget ? withoutObsolete(started) : started;
}

// The header fields a translator's tool fills, as xgettext leaves them.
const TRANSLATOR_FIELDS = [
  ["PO-Revision-Date", "YEAR-MO-DA HO:MI+ZONE"],
  ["Last-Translator", "FULL NAME <EMAIL@ADDRESS>"],
  ["Language-Team", "LANGUAGE <LL@li.org>"],
] as const;

// The header's comment lines, those above a blank line before it
// included where it is the file's first entry.
function headerComments(
  text: string,
  header: PoEntry,
  entries: PoEntry[],
): Span[] {
  if (entries[0] !== header) return header.at.comments;
  const above: Span[] = [];
  let at = text.startsWith("\uFEFF") ? 1 : 0;
  while (at < header.at.start) {
    const next = text.indexOf("\n", at);
    const stop = next < 0 || next > header.at.start ? header.at.start : next;
    const line = text.slice(at, stop).replace(/\r$/, "");
    if (/^#(?:\s|$)/.test(line))
      above.push({ start: at, end: at + line.length });
    at = stop + 1;
  }
  return [...above, ...header.at.comments];
}

// A header comment's translator credits, as Transifex, msginit and
// hand-kept headers write them: `# Name[ <address>][, 2017[-2019]][.]`
// with a year or an address, an email or Transifex's anonymised id, a
// `Last-Translator:` or `Previous-Translator:` line, a name alone after
// a credit, and the `# Translators:` line over them; with the bare `#`
// that closes their block where one, or nothing, opens it. A line with a
// title's, a licence's or an address's words is no credit, unless an
// address and a year sign it; a copyright line never is.
function creditLines(text: string, comments: Span[]): Span[] {
  const lines = comments.map((span) => text.slice(span.start, span.end));
  const years = String.raw`(?:,\s*(?:\d{4}(?:-\d{2}-\d{2}|-\d{4})?|YEAR)\.?)`;
  const address = String.raw`<(?:[^<>\s@]+@[^<>\s]+|[0-9a-f]{32}_\d+)>`;
  const addressed = new RegExp(`^# [^<>]+ ${address}(${years}*)\\.?$`);
  const dated = new RegExp(`^# [^<>,:]+${years}+\\.?$`);
  const copyright = /copyright|\(c\)|©/i;
  const prose =
    /\b(?:translations?|file|licen[cs]e|public|domain|package|bugs?|report|mailing|list)\b/i;
  const organisation =
    /\b(?:foundation|software|desktop|team|project|inc|ltd|gmbh|community|contributors|developers|authors|group)\b/i;
  const named = /^# \p{Lu}[\p{L}'’.-]*(?: \p{Lu}[\p{L}'’.-]*){0,3}$/u;
  const credit = (line: string) => {
    if (/^# (?:Last|Previous)-Translator:/.test(line)) return true;
    if (line.includes("<EMAIL@ADDRESS>") || copyright.test(line)) return false;
    const signed = addressed.exec(line);
    if (signed?.[1]) return true;
    return (
      (signed !== null || dated.test(line)) &&
      !prose.test(line.replace(/<[^<>]*>/g, ""))
    );
  };
  const alone = (line: string) =>
    named.test(line) &&
    !copyright.test(line) &&
    !prose.test(line) &&
    !organisation.test(line);
  const bare = (line: string | undefined) => line?.trim() === "#";
  const out: Span[] = [];
  let i = 0;
  while (i < comments.length) {
    if (!/^# Translators:\s*$/.test(lines[i]!) && !credit(lines[i]!)) {
      i++;
      continue;
    }
    const first = i;
    out.push(comments[i++]!);
    while (i < comments.length && (credit(lines[i]!) || alone(lines[i]!)))
      out.push(comments[i++]!);
    if (bare(lines[i]) && (first === 0 || bare(lines[first - 1])))
      out.push(comments[i++]!);
  }
  return out;
}

// A header block with its `field` replaced by `line`: the field's quoted
// strings through the one that ends it with `\n`, as msgmerge wraps a
// long one over several (#786); a field it lacks goes after Language.
function withHeaderField(
  block: string,
  field: string,
  line: string,
  eol: string,
): string {
  const lines = block.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith(`"${field}:`));
  if (at < 0) {
    const language = lines.findIndex((l) => l.startsWith('"Language:'));
    lines.splice(language < 0 ? lines.length : language + 1, 0, line);
    return lines.join(eol);
  }
  let end = at;
  while (end < lines.length - 1 && !/\\n"\s*$/.test(lines[end]!)) end++;
  lines.splice(at, end - at + 1, line);
  return lines.join(eol);
}

// A language's gettext forms from the CLDR table (#812): its tag, else
// its language alone (`ru-RU`, `pt_BR`'s `pt`).
const RULE_KEYS = new Map(
  Object.keys(GETTEXT_PLURALS).map((key) => [key.toLowerCase(), key]),
);

function pluralRuleOf(tag: string) {
  const bcp = tag.replace(/_/g, "-").toLowerCase();
  const key = RULE_KEYS.get(bcp) ?? RULE_KEYS.get(bcp.split("-")[0]!);
  return key === undefined ? undefined : GETTEXT_PLURALS[key];
}

// A file with its obsolete `#~` entries, and the comments above them,
// gone: a new file has no history, and msgmerge would revive one whose
// msgid returns with the source language's text as its msgstr (#725).
function withoutObsolete(text: string): string {
  const parts = text.split(/(\r?\n(?:[ \t]*\r?\n)+)/);
  const obsolete = (block: string) => {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    return (
      lines.length > 0 &&
      lines.every((l) => l.startsWith("#")) &&
      lines.some((l) => l.startsWith("#~"))
    );
  };
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const block = parts[i]!;
    if (obsolete(block)) continue;
    out += (out === "" ? "" : (parts[i - 1] ?? "")) + block;
  }
  const eol = eolOf(text);
  if (/\r?\n$/.test(text) && !out.endsWith("\n")) out += eol;
  return out;
}

// What an entry's msgstrs become: `msgstr` the text, or each `msgstr[n]`
// its category's branch; undefined where the file's own is kept.
function wantedForms(
  entry: PoEntry,
  text: string,
  { categories, majority, own, keysAt, indexes }: Table,
  rules: Intl.PluralRules,
): (string | undefined)[] | undefined {
  if (entry.msgidPlural === undefined) return [text];
  if (plainForPlural(text)) return categories.map(() => text);
  // `=N` is a branch only where the file is keyed so, and there only one
  // it has a form for: none is dropped unsaid (#982).
  const branches = pluralBranches(text, true, own);
  if (!branches) return undefined;
  if (own) return ownForms(entry, branches, keysAt, indexes, rules);
  const read = categories.map((c) =>
    c === undefined ? undefined : formOf(branches, c),
  );
  const changed = read.some((f, i) => f !== undefined && f !== entry.msgstr[i]);
  // A form no category reads keeps the file's text; one the file lacks,
  // or holds empty in an entry written anyway, takes the branch of the
  // category most of its integers are, as qt-ts does (#743, #848).
  return read.map((f, i) => {
    if (categories[i] !== undefined) return f;
    const held = entry.msgstr[i];
    if (held !== undefined && (held !== "" || !changed)) return undefined;
    const fill = majority[i];
    return (
      (fill === undefined ? undefined : formOf(branches, fill)) ??
      branches.other ??
      ""
    );
  });
}

// A file keyed as it picks: each form the branch its keys have, one
// text however many; a key the text lacks keeps a form the file holds,
// a seed read before the file's own keys among them, and an empty or
// missing one takes the branch ICU picks there, `=1`'s the category 1
// is. A text with an `=N` the file has no form for, or two texts for
// one form, is not written.
function ownForms(
  entry: PoEntry,
  branches: Record<string, string>,
  keysAt: string[][],
  indexes: Map<string, number>,
  rules: Intl.PluralRules,
): (string | undefined)[] | undefined {
  if (Object.keys(branches).some((k) => k.startsWith("=") && !indexes.has(k)))
    return undefined;
  const forms: (string | undefined)[] = [];
  for (const [i, keys] of keysAt.entries()) {
    const texts = new Set(
      keys.flatMap((k) => (Object.hasOwn(branches, k) ? [branches[k]!] : [])),
    );
    if (texts.size > 1) return undefined;
    const [given] = texts;
    if (given !== undefined) forms.push(given);
    else if (entry.msgstr[i]) forms.push(undefined);
    else {
      const key = keys[0] ?? "other";
      const picks = key.startsWith("=")
        ? rules.select(Number(key.slice(1)))
        : key;
      forms.push(formOf(branches, picks) ?? "");
    }
  }
  return forms;
}

// An entry's patches: each msgstr whose text differs rewritten in
// msgmerge's layout, a missing `msgstr[n]` added in its place (after the
// form before it, else before the form after it, else after the msgid,
// #833), and the fuzzy flag and its `#|` previous msgid dropped from a
// row now written.
function entryPatches(
  text: string,
  entry: PoEntry,
  forms: (string | undefined)[],
  eol: string,
): Patch[] {
  const patches: Patch[] = [];
  const keyword = (i: number) =>
    entry.msgidPlural === undefined ? "msgstr" : `msgstr[${i}]`;
  const lines = (i: number, value: string) =>
    poLines(keyword(i), value, !entry.flags.includes("no-wrap")).join(eol);
  const spans = entry.at.msgstr;
  forms.forEach((value, i) => {
    if (value === undefined) return;
    const span = spans[i];
    if (span) {
      if (entry.msgstr[i] !== value)
        patches.push({ ...span, text: lines(i, value) });
      return;
    }
    const before = spans
      .slice(0, i)
      .reverse()
      .find((s) => s !== undefined);
    const after = spans.slice(i + 1).find((s) => s !== undefined);
    if (before)
      patches.push({
        start: before.end,
        end: before.end,
        text: eol + lines(i, value),
      });
    else if (after)
      patches.push({
        start: after.start,
        end: after.start,
        text: lines(i, value) + eol,
      });
    else
      patches.push({
        start: entry.at.idEnd,
        end: entry.at.idEnd,
        text: eol + lines(i, value),
      });
  });
  const fuzzy = entry.flags.includes("fuzzy");
  if (patches.length === 0 && !fuzzy) return [];
  if (fuzzy && entry.at.flags) {
    patches.push(fuzzyRemoval(text, entry, entry.at.flags));
    for (const previous of entry.at.previous)
      patches.push(lineRemoval(text, previous));
  }
  return patches;
}

function fuzzyRemoval(text: string, entry: PoEntry, span: Span): Patch {
  const flags = entry.flags.filter((f) => f !== "fuzzy");
  return flags.length > 0
    ? { ...span, text: `#, ${flags.join(", ")}` }
    : lineRemoval(text, span);
}

function lineRemoval(text: string, span: Span): Patch {
  const end = text.startsWith("\r\n", span.end)
    ? span.end + 2
    : text.startsWith("\n", span.end)
      ? span.end + 1
      : span.end;
  return { start: span.start, end, text: "" };
}

// A surplus msgstr removed with the line break before it: it is never a
// file's first line, and removals of lines in a row never overlap.
function msgstrRemoval(text: string, span: Span): Patch {
  const before = /\r?\n$/.exec(text.slice(0, span.start))?.[0] ?? "";
  return { start: span.start - before.length, end: span.end, text: "" };
}

// Pull's write into a target `.po` (§8): a changed entry's msgstr, found
// by msgctxt and msgid, rewritten as msgmerge wraps it, its plural forms
// in the order the file's `Plural-Forms` gives; an entry the file lacks
// appended from the template, before any obsolete entries; a missing
// file started from the template. Every other byte stays.
export function entriesToGettext(
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: { tag: string; code: string },
  onRefused?: (id: string, text: string) => void,
  // Said of a new file whose language the CLDR table lacks (#786).
  onNote?: (message: string) => void,
): string {
  translations = ownRecord(translations);
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language, onNote)
      : existing;
  const eol = eolOf(base);
  const entries = parsePo(base);
  const pluralForms = poHeader(entries)["Plural-Forms"];
  const table = gettextTable(language.tag, pluralForms);
  const { indexes } = table;
  const rules = pluralRulesOf(language.tag);
  // A plural entry the reader reads as the text is left as it is, one
  // short of its nplurals among them: a pull fills in no form (#981). So
  // is one a file keyed as it picks read before it was (#982), a row
  // verified then keeping that reading.
  const before = table.own ? pluralTable(language.tag, pluralForms) : undefined;
  const unchanged = (entry: PoEntry, text: string) => {
    if (entry.msgidPlural === undefined || entry.flags.includes("fuzzy"))
      return false;
    const forms = entry.msgstr.map((t) => t ?? "");
    const readings = [
      poPluralText(forms, indexes, table.picked),
      ...(before
        ? [poPluralText(forms, before.indexes, before.categories)]
        : []),
    ];
    if (readings.includes(text)) return true;
    if (plainForPlural(text)) return forms.every((form) => form === text);
    const wanted = pluralBranches(text, true, true);
    return readings.some((reading) => {
      const read = pluralBranches(reading, true, true);
      return (
        read !== undefined &&
        wanted !== undefined &&
        Object.keys(read).length === Object.keys(wanted).length &&
        Object.entries(read).every(([c, f]) => wanted[c] === f)
      );
    });
  };
  const forms = (entry: PoEntry, text: string) => {
    const wanted = wantedForms(entry, text, table, rules);
    if (!wanted) onRefused?.(poId(entry), text);
    return wanted;
  };
  const patches: Patch[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.msgid === "") continue;
    const id = poId(entry);
    seen.add(id);
    const text = translations[id];
    if (text === undefined || unchanged(entry, text)) continue;
    const wanted = forms(entry, text);
    if (wanted) patches.push(...entryPatches(base, entry, wanted, eol));
  }
  let out = applied(base, patches);
  const blocks: string[] = [];
  const own = eolOf(template);
  for (const entry of parsePo(template)) {
    const id = poId(entry);
    const text = translations[id];
    if (entry.msgid === "" || seen.has(id) || text === undefined) continue;
    // The template's own line endings, turned to the file's at the end.
    const block = template.slice(entry.at.start, entry.at.end);
    const moved = parsePo(block)[0]!;
    // The template's msgstrs are not the file's: none is held.
    const wanted = forms({ ...moved, msgstr: [] }, text);
    if (!wanted) continue;
    // A plural takes the forms the language has; the template's lines
    // beyond them go.
    const extra = moved.at.msgstr
      .slice(wanted.length)
      .flatMap((s) => (s ? [msgstrRemoval(block, s)] : []));
    const filled = wanted.map((w) => w ?? "");
    blocks.push(
      applied(block, [
        ...entryPatches(block, moved, filled, own),
        ...extra,
      ]).replace(/\r?\n/g, eol),
    );
  }
  if (blocks.length > 0) {
    // Before the obsolete entries msgmerge keeps last, a blank line
    // apart, and before the comments and flags written above the first.
    let obsolete = /^#~/m.exec(out)?.index ?? out.length;
    for (;;) {
      const above = out.lastIndexOf("\n", obsolete - 2) + 1;
      if (obsolete === 0 || !/^#(?!~)/.test(out.slice(above, obsolete))) break;
      obsolete = above;
    }
    const head = out.slice(0, obsolete).replace(/(?:\r?\n)*$/, "");
    const rest = out.slice(obsolete);
    const added = blocks.map((b) => `${eol}${eol}${b}`).join("");
    out =
      rest === ""
        ? head + added + (out.slice(head.length) || eol)
        : head + added + eol + eol + rest;
  }
  return out;
}
