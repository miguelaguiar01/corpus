// gettext `.po` and `.pot` (#668): the msgid is the text and the key, a
// `msgid_plural` with its `msgstr[n]` one plural, mapped to CLDR's
// categories through the file's `Plural-Forms`.
import type { StringEntry } from "@corpus/contract";

// gettext joins a context to its msgid with EOT, a control character an
// id cannot hold; its visible symbol stands in (#668).
export const CONTEXT_SEPARATOR = "␄";

export type PoEntry = {
  msgctxt?: string;
  msgid: string;
  msgidPlural?: string;
  // `msgstr`, or `msgstr[n]` by index.
  msgstr: string[];
  flags: string[];
  extracted: string[];
  references: string[];
};

function unescape(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|.)/g, (_, c: string) =>
    /^x/.test(c)
      ? String.fromCharCode(parseInt(c.slice(1), 16))
      : /^[0-7]/.test(c)
        ? String.fromCharCode(parseInt(c, 8))
        : c === "n"
          ? "\n"
          : c === "t"
            ? "\t"
            : c === "r"
              ? "\r"
              : c === "a"
                ? "\u0007"
                : c === "b"
                  ? "\b"
                  : c === "f"
                    ? "\f"
                    : c === "v"
                      ? "\v"
                      : c,
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
// msgctxt/msgid follow its msgstr with none.
export function parsePo(text: string): PoEntry[] {
  const out: PoEntry[] = [];
  const fresh = (): PoEntry => ({
    msgid: "",
    msgstr: [],
    flags: [],
    extracted: [],
    references: [],
  });
  let entry = fresh();
  let seenId = false;
  let seenStr = false;
  let key: string | undefined;
  let acc: string[] = [];
  const flush = () => {
    if (key === undefined) return;
    const value = quoted(acc);
    if (key === "msgctxt") entry.msgctxt = value;
    else if (key === "msgid") {
      entry.msgid = value;
      seenId = true;
    } else if (key === "msgid_plural") entry.msgidPlural = value;
    else if (key === "msgstr") entry.msgstr[0] = value;
    else {
      const index = /^msgstr\[(\d+)\]$/.exec(key)?.[1];
      if (index !== undefined) entry.msgstr[Number(index)] = value;
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
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  for (const line of lines) {
    if (line.trim() === "") {
      end();
      continue;
    }
    if (line.startsWith("#~")) continue;
    if (line.startsWith("#")) {
      if (seenStr) end();
      flush();
      if (line.startsWith("#,"))
        entry.flags.push(
          ...line
            .slice(2)
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
        );
      else if (line.startsWith("#."))
        entry.extracted.push(line.slice(2).trim());
      else if (line.startsWith("#:"))
        entry.references.push(line.slice(2).trim());
      continue;
    }
    const keyword = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s/.exec(
      line,
    );
    if (keyword) {
      if (seenStr && (keyword[1] === "msgctxt" || keyword[1] === "msgid"))
        end();
      flush();
      key = keyword[1];
      if (key!.startsWith("msgstr")) seenStr = true;
      acc = [line.slice(keyword[1]!.length)];
    } else if (line.trimStart().startsWith('"')) acc.push(line);
  }
  end();
  return out;
}

// A header's fields: `Language`, `Plural-Forms` and the rest.
export function poHeader(entries: PoEntry[]): Record<string, string> {
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

const CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;

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

// Which `msgstr[n]` each CLDR category of a language reads: the index
// the most integers of the category are given; a category no integer
// reaches reads `other`'s. With no expression to go by, the language's
// categories in CLDR's order are the indexes.
export function pluralCategoryIndexes(
  language: string,
  forms: string | undefined,
): Map<string, number> {
  const rules = rulesOf(language);
  const categories = rules.resolvedOptions().pluralCategories;
  const nplurals = Number(/nplurals\s*=\s*(\d+)/.exec(forms ?? "")?.[1] ?? 0);
  const plural =
    forms && nplurals > 0 ? pluralFunction(forms, nplurals) : undefined;
  const out = new Map<string, number>();
  if (!plural) {
    const ordered = CATEGORIES.filter((c) => categories.includes(c));
    ordered.forEach((c, i) => out.set(c, i));
    return out;
  }
  const counts = new Map<string, Map<number, number>>();
  for (const n of INTEGERS) {
    const category = rules.select(n);
    const byIndex = counts.get(category) ?? new Map<number, number>();
    const index = plural(n);
    byIndex.set(index, (byIndex.get(index) ?? 0) + 1);
    counts.set(category, byIndex);
  }
  for (const [category, byIndex] of counts)
    out.set(category, [...byIndex].sort((a, b) => b[1] - a[1])[0]![0]);
  for (const category of categories)
    if (!out.has(category)) out.set(category, out.get("other") ?? nplurals - 1);
  return out;
}

// A plural entry's forms as one ICU plural on `count`, a branch for
// every category the language has, each the form its index names.
export function poPluralText(
  forms: string[],
  indexes: Map<string, number>,
): string {
  const ordered = CATEGORIES.filter((c) => indexes.has(c));
  const branch = (c: string) =>
    forms[indexes.get(c)!] ?? forms[forms.length - 1] ?? "";
  return `{count, plural, ${ordered.map((c) => `${c} {${branch(c)}}`).join(" ")}}`;
}

function noteOf(entry: PoEntry): string | undefined {
  const lines = [
    ...entry.extracted,
    ...(entry.references.length
      ? [`Used in ${entry.references.join(" ")}`]
      : []),
  ];
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
  const entries = parsePo(text);
  // The config's tag says the language; the header's code may be one
  // the runtime cannot read (`sr@latin`).
  const indexes = pluralCategoryIndexes(
    language,
    poHeader(entries)["Plural-Forms"],
  );
  return entries
    .filter((e) => e.msgid !== "" && !e.flags.includes("fuzzy"))
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
