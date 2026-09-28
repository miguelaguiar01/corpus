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
  return text.replace(/\\(.)/g, (_, c: string) =>
    c === "n"
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
// obsolete `#~` ones not: they are kept in the file, never read.
export function parsePo(text: string): PoEntry[] {
  const out: PoEntry[] = [];
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0 || lines.every((l) => l.startsWith("#~"))) continue;
    const entry: PoEntry = {
      msgid: "",
      msgstr: [],
      flags: [],
      extracted: [],
      references: [],
    };
    let key: string | undefined;
    let acc: string[] = [];
    let seenId = false;
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
    for (const line of lines) {
      if (line.startsWith("#~")) continue;
      if (line.startsWith("#")) {
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
        flush();
        key = keyword[1];
        acc = [line.slice(keyword[1]!.length)];
      } else if (line.trimStart().startsWith('"')) acc.push(line);
    }
    flush();
    if (seenId) out.push(entry);
  }
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

// `Plural-Forms`' expression as a function of n: C's integer
// arithmetic, comparisons, logic and the conditional, and nothing else
// (anything outside that is refused, not run).
function pluralFunction(forms: string): ((n: number) => number) | undefined {
  const expr = /plural\s*=\s*([^;]+);?/.exec(forms)?.[1]?.trim();
  if (!expr || !/^[n0-9\s()?:!=<>&|%+\-*/]+$/.test(expr)) return undefined;
  try {
    const f = new Function("n", `return Number(${expr});`) as (
      n: number,
    ) => number;
    f(1);
    return f;
  } catch {
    return undefined;
  }
}

// Which CLDR category each `msgstr[n]` holds for a language: the index
// the expression gives every integer to a thousand, named by the
// category CLDR puts that integer in. An index no integer names keeps
// its place by order.
export function pluralIndexCategories(
  language: string,
  forms: string | undefined,
): string[] {
  const plural = forms ? pluralFunction(forms) : undefined;
  const nplurals = Number(/nplurals\s*=\s*(\d+)/.exec(forms ?? "")?.[1] ?? 2);
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(language.replace(/_/g, "-"));
  } catch {
    rules = new Intl.PluralRules("en");
  }
  const byIndex: string[] = [];
  if (plural) {
    for (let n = 0; n <= 1000; n++) {
      const index = plural(n);
      if (index >= 0 && index < nplurals && byIndex[index] === undefined)
        byIndex[index] = rules.select(n);
    }
  }
  const fallback = nplurals === 1 ? ["other"] : ["one", "other"];
  for (let i = 0; i < nplurals; i++)
    byIndex[i] ??= fallback[i] ?? CATEGORIES[Math.min(i, 5)]!;
  return byIndex;
}

// A plural entry's forms as one ICU plural on `count`, each branch the
// form as written; `other`, which ICU needs, is the last form where no
// index names it (Russian's `other` is only decimals').
export function poPluralText(forms: string[], categories: string[]): string {
  const branches = new Map<string, string>();
  forms.forEach((text, i) => {
    const category = categories[i];
    if (category && !branches.has(category)) branches.set(category, text);
  });
  if (!branches.has("other") && forms.length > 0)
    branches.set("other", forms[forms.length - 1]!);
  const ordered = CATEGORIES.filter((c) => branches.has(c));
  return `{count, plural, ${ordered.map((c) => `${c} {${branches.get(c)}}`).join(" ")}}`;
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
            : poPluralText([e.msgid, e.msgidPlural], ["one", "other"]),
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
  const categories = pluralIndexCategories(
    poHeader(entries).Language || language,
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
            categories,
          ),
        },
      ];
    });
}
