// gettext `.po` and `.pot` (#668): the msgid is the text and the key, a
// `msgid_plural` with its `msgstr[n]` one plural, mapped to CLDR's
// categories through the file's `Plural-Forms`.
import { PLURAL_CATEGORIES, type StringEntry } from "@corpus/contract";
import { GETTEXT_PLURALS } from "./gettextplurals";
import { formOf, pluralBranches } from "./messages";
import { applied, eolOf, usedIn, type Patch, type Span } from "./text";

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
  // Where the entry sits in the text read: its lines, its `#,` and `#|`
  // lines, where its msgid (or msgid_plural) ends, and each msgstr's
  // keyword line through its last continuation.
  at: {
    start: number;
    end: number;
    idEnd: number;
    flags?: Span;
    previous: Span[];
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

function unescape(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, c: string) =>
    /^x/.test(c)
      ? String.fromCharCode(parseInt(c.slice(1), 16))
      : /^[0-7]/.test(c)
        ? String.fromCharCode(parseInt(c, 8))
        : (UNESCAPES[c] ?? c),
  );
}

// The quoted strings of a keyword and its continuation lines, joined.
function quoted(lines: string[]): string {
  return lines
    .map((line) => /^[^"]*"((?:[^"\\]|\\.)*)"\s*$/.exec(line)?.[1] ?? "")
    .map(unescape)
    .join("");
}

// Every entry of a file, the header's included (its msgid empty), the
// obsolete `#~` ones not: they are kept in the file, never read. An
// entry ends at a blank line, or where the next one's comments or
// msgctxt/msgid follow its msgstr with none. Offsets are the text's own,
// a BOM and CRLF included.
export function parsePo(text: string): PoEntry[] {
  const out: PoEntry[] = [];
  const fresh = (): PoEntry => ({
    msgid: "",
    msgstr: [],
    flags: [],
    extracted: [],
    references: [],
    at: { start: -1, end: -1, idEnd: -1, previous: [], msgstr: [] },
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
      if (seenStr) end();
      flush();
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
    } else {
      const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s/.exec(
        line,
      );
      if (keyword) {
        if (seenStr && (keyword[1] === "msgctxt" || keyword[1] === "msgid"))
          end();
        flush();
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

// A header's fields: `Language`, `Plural-Forms` and the rest.
function poHeader(entries: PoEntry[]): Record<string, string> {
  const header = entries.find((e) => e.msgid === "" && !e.msgctxt);
  const out: Record<string, string> = {};
  for (const line of (header?.msgstr[0] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export function poId(entry: Pick<PoEntry, "msgctxt" | "msgid">): string {
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

function rulesOf(language: string): Intl.PluralRules {
  try {
    return new Intl.PluralRules(language.replace(/_/g, "-"));
  } catch {
    return new Intl.PluralRules("en");
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

// Which `msgstr[n]` each CLDR category of a language reads: the index
// the most integers of the category are given; a category no integer
// reaches reads `other`'s. With no expression to go by, the language's
// categories in CLDR's order are the indexes.
export function pluralCategoryIndexes(
  language: string,
  forms: string | undefined,
): Map<string, number> {
  const rules = rulesOf(language);
  const found = tally(rules, forms);
  const out = new Map<string, number>();
  if (!found) {
    cldrOrder(rules).forEach((c, i) => out.set(c, i));
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

// The category each `msgstr[n]` is written from: of those the reader
// takes from index n, the one the most of its integers are, a tie to
// CLDR's order; an index no category reads (Latvian's form for zero
// alone) is none, and keeps what the file holds.
export function pluralIndexCategories(
  language: string,
  forms: string | undefined,
): (string | undefined)[] {
  const rules = rulesOf(language);
  const found = tally(rules, forms);
  const indexes = pluralCategoryIndexes(language, forms);
  const order = cldrOrder(rules);
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

// The category the most integers at each index belong to, whether or
// not the reader takes that index from it: what fills a form no
// category reads, Latvian's for zero or Filipino's for 0 and 1, where a
// file must hold text (#743).
export function pluralIndexMajority(
  language: string,
  forms: string | undefined,
): (string | undefined)[] {
  const rules = rulesOf(language);
  const found = tally(rules, forms);
  const order = cldrOrder(rules);
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

// A plural entry's forms as one ICU plural on `count`, a branch for
// every category the language has, each the form its index names.
export function poPluralText(
  forms: string[],
  indexes: Map<string, number>,
): string {
  const ordered = PLURAL_CATEGORIES.filter((c) => indexes.has(c));
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

// A target file's translations: the entries someone translated, a
// fuzzy one being a guess still to check, a plural as one ICU plural in
// the language's categories.
export function gettextTranslations(
  text: string,
  language: string,
): StringEntry[] {
  return poTexts(text, language, false);
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
  const indexes = pluralCategoryIndexes(
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
  const wrap = (portion: string, start: number): string[] => {
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
  };
  const first = wrap(portions[0] ?? "", keyword.length + 1);
  if (portions.length <= 1 && first.length === 1)
    return [`${keyword} "${first[0]}"`];
  return [
    `${keyword} ""`,
    ...portions.flatMap((p) => wrap(p, 0)).map((line) => `"${line}"`),
  ];
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
  const header = entries.find((e) => e.msgid === "" && !e.msgctxt);
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
        .flatMap((s) => (s ? [lineRemoval(template, s)] : []));
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
  const span = header?.at.msgstr[0];
  if (header && span) {
    if (header.at.flags)
      patches.push(fuzzyRemoval(template, header, header.at.flags));
    let block = template.slice(span.start, span.end);
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
  // A `.pot`, whose msgstrs are all empty, is kept as msginit keeps it.
  const translated = entries.some(
    (e) => e !== header && e.msgstr.some((m) => m !== ""),
  );
  const started = applied(template, patches);
  return translated ? withoutObsolete(started) : started;
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
  categories: (string | undefined)[],
): (string | undefined)[] | undefined {
  if (entry.msgidPlural === undefined) return [text];
  const branches = pluralBranches(text);
  if (!branches) return undefined;
  return categories.map((c) =>
    c === undefined ? undefined : formOf(branches, c),
  );
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
  const base =
    existing === undefined || existing.trim() === ""
      ? targetFrom(template, language, onNote)
      : existing;
  const eol = eolOf(base);
  const entries = parsePo(base);
  const categories = pluralIndexCategories(
    language.tag,
    poHeader(entries)["Plural-Forms"],
  );
  const forms = (entry: PoEntry, text: string) => {
    const wanted = wantedForms(entry, text, categories);
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
    if (text === undefined) continue;
    const wanted = forms(entry, text);
    if (wanted) patches.push(...entryPatches(base, entry, wanted, eol));
  }
  let out = applied(base, patches);
  const blocks: string[] = [];
  for (const entry of parsePo(template)) {
    const id = poId(entry);
    const text = translations[id];
    if (entry.msgid === "" || seen.has(id) || text === undefined) continue;
    // The template's own line endings, turned to the file's at the end.
    const block = template.slice(entry.at.start, entry.at.end);
    const own = eolOf(template);
    const moved = parsePo(block)[0]!;
    const wanted = forms(moved, text);
    if (!wanted) continue;
    // A plural takes the forms the language has; the template's lines
    // beyond them go.
    const extra = moved.at.msgstr
      .slice(wanted.length)
      .flatMap((s) =>
        s ? [{ start: s.start - own.length, end: s.end, text: "" }] : [],
      );
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
