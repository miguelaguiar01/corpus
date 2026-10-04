import { expect, test } from "vitest";
import { corpusConfigSchema as configSchema } from "./config";
import { parseIcu, partsOf } from "./icu";
import { messageKind } from "./strings";
import { validateTranslation } from "./validate";

// The `fluent` reading of the ICU view (#990): ICU, with Fluent's own
// identifiers and nesting.

test("a Fluent identifier is a name: hyphens included, under fluent only", () => {
  const read = parseIcu(
    "{cards-per-minute} cards/minute, {statistics-cards}",
    "fluent",
  );
  expect(read.ok).toBe(true);
  expect(
    partsOf("{cards-per-minute} by {statistics-cards}", "fluent").placeholders,
  ).toEqual(new Set(["cards-per-minute", "statistics-cards"]));
  expect(
    parseIcu("{n-cards, plural, one {# card} other {# cards}}", "fluent").ok,
  ).toBe(true);
  // FormatJS refuses such a name, so ICU still does.
  expect(parseIcu("{cards-per-minute} cards/minute", "icu").ok).toBe(false);
  // Fluent's identifiers start with a letter and are ASCII.
  expect(parseIcu("{_x}", "fluent").ok).toBe(false);
  expect(parseIcu("{0}", "fluent").ok).toBe(false);
  expect(parseIcu("{café}", "fluent").ok).toBe(false);
});

test("under fluent a plural nests in a plural's branch and a select in a select's, one level deep", () => {
  const nested =
    "{cards, plural, one {{minutes, plural, one {# card in # minute} other {# card in # minutes}}} other {{minutes, plural, one {# cards in # minute} other {# cards in # minutes}}}}";
  expect(parseIcu(nested, "fluent").ok).toBe(true);
  expect(parseIcu(nested, "icu").ok).toBe(false);
  expect(
    parseIcu(
      "{a, select, x {{b, select, y {Y} other {Z}}} other {W}}",
      "fluent",
    ).ok,
  ).toBe(true);
  const deeper =
    "{a, plural, one {{b, plural, one {{c, plural, one {1} other {2}}} other {3}}} other {4}}";
  const read = parseIcu(deeper, "fluent");
  expect(read.ok).toBe(false);
  expect(read.ok ? "" : read.errors[0]?.message).toMatch(/one level deep/);
});

test("a translation is checked as ICU is: a renamed hyphenated variable and a dropped one are findings", () => {
  const source = "{cards-per-minute} cards/minute";
  expect(
    validateTranslation(
      source,
      "{cards-per-minute} cartas/minuto",
      "pt",
      "fluent",
    ).ok,
  ).toBe(true);
  const renamed = validateTranslation(
    source,
    "{cartas-por-minuto} cartas/minuto",
    "pt",
    "fluent",
  );
  expect(renamed.ok).toBe(false);
  expect(renamed.ok ? [] : renamed.errors.map((e) => e.code)).toEqual(
    expect.arrayContaining(["missing-placeholder", "unexpected-placeholder"]),
  );
  // `#` prints the count, as it does in ICU and as the writer renders it.
  expect(
    validateTranslation(
      "Copied {items} {items, plural, one {item} other {items}}",
      "Copiado {items, plural, one {# elemento} other {# elementos}}",
      "pt",
      "fluent",
    ).ok,
  ).toBe(true);
  expect(messageKind("fluent")).toBe("Fluent message");
});

test("a translation may nest what its source writes side by side, as Croatian's agreement does", () => {
  const source =
    "{cards, plural, one {{cards} card} other {{cards} cards}} studied in {minutes, plural, one {{minutes} minute.} other {{minutes} minutes.}}";
  const hr =
    "{cards, plural, one {{minutes, plural, one {{cards} kartica naučena u {minutes} minuti.} few {{cards} kartica naučena u {minutes} minute.} other {{cards} kartica naučena u {minutes} minuta.}}} few {{minutes, plural, one {{cards} kartice naučene u {minutes} minuti.} few {{cards} kartice naučene u {minutes} minute.} other {{cards} kartice naučene u {minutes} minuta.}}} other {{minutes, plural, one {{cards} kartica naučeno u {minutes} minuti.} few {{cards} kartica naučeno u {minutes} minute.} other {{cards} kartica naučeno u {minutes} minuta.}}}}";
  expect(validateTranslation(source, hr, "hr", "fluent")).toEqual({ ok: true });
  // ICU's writers that hold a plural as its forms still need the source's
  // nesting.
  expect(validateTranslation(source, hr, "hr", "icu").ok).toBe(false);
});

test("fluent is the adapter's reading, never a config's", () => {
  const config = (library: string) => ({
    project: "p",
    server: "http://x",
    sourceLanguage: "en",
    languages: ["en", "pt"],
    sources: [
      { adapter: "messages", type: "ui", path: "{lang}.json", library },
    ],
  });
  expect(configSchema.safeParse(config("icu")).success).toBe(true);
  expect(configSchema.safeParse(config("fluent")).success).toBe(false);
});

test("a string literal is text under fluent, escapes read; a # inside one is no count (#990)", () => {
  const read = parseIcu('This is a {"{{c1::"}sample{"}}"} cloze.', "fluent");
  expect(read.ok && read.nodes).toEqual([
    { kind: "literal", text: "This is a {{c1::sample}} cloze." },
  ]);
  expect(parseIcu('This is a {"{{c1::"}sample', "icu").ok).toBe(false);
  const escaped = parseIcu(
    '5{"\\u00A0"}km {"\\U01F602"} {"a \\" b \\\\ c"}',
    "fluent",
  );
  expect(escaped.ok && escaped.nodes).toEqual([
    { kind: "literal", text: '5 km 😂 a " b \\ c' },
  ]);
  expect(parseIcu('{"\\q"}', "fluent").ok).toBe(false);
  expect(parseIcu('{"open', "fluent").ok).toBe(false);
  const plural = parseIcu(
    '{n, plural, one {Nueva {"#"}{n}} other {Nuevas {"#"}{n} #}}',
    "fluent",
  );
  expect(plural.ok).toBe(true);
  expect(
    JSON.stringify(plural.ok && plural.nodes).match(/"kind":"count"/g),
  ).toHaveLength(1);
  // Literals are text: a translation may write its own, or none.
  expect(
    validateTranslation(
      "Required for AnkiDroid <= 2.14",
      'Kerak AnkiDroid {"<="} 2.14',
      "uz",
      "fluent",
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation(
      'Use {"{{Field}}"} in a template.',
      'Use {"{{欄位}}"} 在模板中。',
      "zh",
      "fluent",
    ).ok,
  ).toBe(true);
});

test("an escape past Unicode is a parse error, a lone surrogate reads as U+FFFD (#990 review)", () => {
  const past = parseIcu('{"\\UFFFFFF"}', "fluent");
  expect(past.ok).toBe(false);
  expect(past.ok ? "" : past.errors[0]?.message).toMatch(/code point/);
  const lone = parseIcu('{"\\uD800"}', "fluent");
  expect(lone.ok && lone.nodes).toEqual([{ kind: "literal", text: "�" }]);
});

test("a term reference is a placeholder named after the term, its arguments part of it; a term's attribute only selects (#990)", () => {
  const source =
    'Use {-brand} and {-brand-x(capitalization: "upper", n: "a, b")}';
  expect(partsOf(source, "fluent").placeholders).toEqual(
    new Set(["-brand", "-brand-x"]),
  );
  expect(parseIcu("{-brand}", "icu").ok).toBe(false);
  expect(
    parseIcu("{-brand.gender, select, masculine {Byl} other {Bylo}}", "fluent")
      .ok,
  ).toBe(true);
  expect(parseIcu("{-brand.gender}", "fluent").ok).toBe(false);
  expect(parseIcu("{$brand}", "fluent").ok).toBe(false);
  expect(parseIcu('{-brand(case: "gen"}', "fluent").ok).toBe(false);
  // A translation keeps the source's terms, names them as it likes, and
  // may use a term of its own; a variable it adds is still invalid.
  const ok = (text: string) =>
    validateTranslation(source, text, "cs", "fluent");
  expect(ok('Použij {-brand(case: "acc")} a {-brand-x} s {-other}').ok).toBe(
    true,
  );
  const dropped = ok("Použij {-brand-x}");
  expect(dropped.ok ? [] : dropped.errors).toEqual([
    expect.objectContaining({ code: "missing-placeholder", name: "-brand" }),
  ]);
  expect(ok("Použij {-brand} a {-brand-x} {n}").ok).toBe(false);
});

test("a plural is on a variable, a select on a variable or a term's attribute, never on a bare term (#990 review)", () => {
  expect(parseIcu("{-brand, select, other {x}}", "fluent").ok).toBe(false);
  expect(parseIcu("{-brand.gender, plural, other {x}}", "fluent").ok).toBe(
    false,
  );
  expect(parseIcu("{-brand.gender, select, other {x}}", "fluent").ok).toBe(
    true,
  );
});

test("a NUMBER() or DATETIME() format keeps its type, and a translation may change its options (#990)", () => {
  const source = "{remaining_seconds, number, minimumIntegerDigits: 2} s";
  expect(parseIcu(source, "fluent").ok).toBe(true);
  expect(
    validateTranslation(
      source,
      "{remaining_seconds, number, minimumIntegerDigits: 3} s",
      "fr",
      "fluent",
    ).ok,
  ).toBe(true);
  const bare = validateTranslation(
    source,
    "{remaining_seconds} s",
    "fr",
    "fluent",
  );
  expect(bare.ok ? [] : bare.errors.map((e) => e.code)).toEqual([
    "unexpected-format",
  ]);
  expect(
    parseIcu('On {d, date, month: "long", day: "numeric"}', "fluent").ok,
  ).toBe(true);
});

test("a format's style under fluent is Fluent's options, and there is no time format (#990 review)", () => {
  for (const ok of [
    "{n, number}",
    "{n, number, minimumIntegerDigits: 2}",
    '{n, number, style: "percent", maximumFractionDigits: 1}',
    '{d, date, month: "long", day: "numeric"}',
  ])
    expect(parseIcu(ok, "fluent").ok).toBe(true);
  for (const bad of [
    "{n, number, ::percent}",
    "{n, number, style: 'percent'}",
    "{n, number, percent}",
    "{d, date, short}",
    "{t, time}",
    '{n, number, x: "{"}',
    "{n, number, minimumIntegerDigits:\t3}",
    "{n, number, minimumIntegerDigits: 2,\n useGrouping: 0}",
  ]) {
    const read = parseIcu(bad, "fluent");
    expect(read.ok, bad).toBe(false);
  }
  // ICU keeps its own styles.
  expect(parseIcu("{n, number, ::percent}", "icu").ok).toBe(true);
});

test("a Fluent translation selects on what it likes: missing and extra keys take the default, an unpassed variable is a warning (#1032)", () => {
  const v = (source: string, target: string, options = {}) =>
    validateTranslation(source, target, "de", "fluent", options);
  // de genders the user the source only prints.
  expect(
    v(
      "{user} shared a file",
      "{user_gender, select, female {{user} hat eine Datei geteilt (sie)} other {{user} hat eine Datei geteilt}}",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "unpassed-selector", arg: "user_gender" }],
  });
  // de collapses a capitalization, fi selects on one key of two.
  const account =
    "{capitalization, select, lowercase {account} uppercase {Account} other {account}}";
  expect(v(account, "{capitalization, select, other {Konto}}")).toEqual({
    ok: true,
  });
  // As the adapter reads `*[other] Konto` alone: a plural of one branch,
  // on a value the source never counts, has no categories to lack.
  expect(v(account, "{capitalization, plural, other {Konto}}")).toEqual({
    ok: true,
  });
  // On a count, it still lacks the categories the language picks.
  expect(
    v(
      "{n, plural, one {# card} other {# cards}}",
      "{n, plural, other {# Karten}}",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "n", key: "one" }],
  });
  expect(
    v(account, "{capitalization, select, uppercase {Tili} other {tili}}"),
  ).toEqual({ ok: true });
  // A select on a value the source prints, or on a term's attribute, is
  // no warning.
  expect(
    v("{n} files", "{n, select, zero {keine Dateien} other {{n} Dateien}}"),
  ).toEqual({ ok: true });
  expect(
    v(
      "{-brand} is gone",
      "{-brand.gender, select, masculine {{-brand} byl} other {{-brand} bylo}}",
    ),
  ).toEqual({ ok: true });
  // A term's own string selects on its callers' arguments.
  expect(
    v("Firefox", "{case, select, gen {Firefoxu} other {Firefox}}", {
      term: true,
    }),
  ).toEqual({ ok: true });
  // A plural the source never has a value for is the same warning.
  expect(v("Files", "{count, plural, one {Datei} other {Dateien}}")).toEqual({
    ok: true,
    incomplete: [{ code: "unpassed-selector", arg: "count" }],
  });
  // Keys of its own and none of the source's are the source's
  // translated, which the code's value never matches (da's `[sekunder]`).
  const unit =
    "{unit, select, seconds {{n} s} minutes {{n} min} hours {{n} h} other {{n} h}}";
  const da = v(
    unit,
    "{unit, select, sekunder {{n} s} minutter {{n} min} timer {{n} t} other {{n} t}}",
  );
  expect(da.ok ? [] : da.errors.map((e) => "key" in e && e.key)).toEqual([
    "seconds",
    "minutes",
    "hours",
  ]);
  expect(v(unit, "{unit, select, seconds {{n} s} other {{n} t}}")).toEqual({
    ok: true,
  });
  expect(
    v(
      "{capitalization, select, lowercase {account} uppercase {Account} other {account}}",
      "{capitalization, select, lower {účet} upper {Účet} other {Účet}}",
      { term: true },
    ),
  ).toEqual({ ok: true });
  // A count selected on words never matches them, but the default is
  // chosen whatever its key: gl's `[unha]` is a finding, es-MX's
  // `*[otro]`, which the reader carries as `other`, is not.
  const count = "{items, plural, one {# item} other {# items}}";
  const gl = v(
    count,
    "{items, select, unha {{items} elemento} outra {{items} elementos} other {{items} elementos}}",
  );
  expect(gl.ok ? [] : gl.errors).toEqual([
    { code: "unexpected-branch", arg: "items", key: "unha" },
  ]);
  expect(
    v(
      count,
      "{items, select, 1 {un elemento} otro {{items} elementos} other {{items} elementos}}",
    ),
  ).toEqual({ ok: true });
  // Printing what the source does not pass, or dropping what it does,
  // is still invalid.
  expect(v("{user} shared", "{number} geteilt").ok).toBe(false);
  // ICU's rules stand everywhere else.
  expect(
    validateTranslation(
      account,
      "{capitalization, select, other {Konto}}",
      "de",
      "icu",
    ).ok,
  ).toBe(false);
});

test("a select collapsed to a word default, a key in another case, one key of its own, and the same key twice (#1032 review)", () => {
  const v = (source: string, target: string) =>
    validateTranslation(source, target, "de", "fluent");
  const gender = "{g, select, male {his} female {her} other {their}}";
  // `*[neutral] ihr` alone: the reader adds `other` with its text.
  expect(v(gender, "{g, select, neutral {ihr} other {ihr}}")).toEqual({
    ok: true,
  });
  // ga-IE's `[Seconds]` never matches `seconds`.
  const unit =
    "{unit, select, seconds {{n} s} minutes {{n} min} other {{n} h}}";
  const ga = v(
    unit,
    "{unit, select, Seconds {{n} s} minutes {{n} n} other {{n} u}}",
  );
  expect(ga.ok ? [] : ga.errors).toEqual([
    { code: "missing-branch", arg: "unit", key: "seconds" },
  ]);
  // Beside the source's own spelling, another case is a key of its own.
  expect(
    v(
      unit,
      "{unit, select, seconds {{n} s} Seconds {{n} S} minutes {{n} m} other {{n} h}}",
    ),
  ).toEqual({ ok: true });
  // One key of its own is Fluent's asymmetry, not a translated key.
  expect(
    v(
      "{os, select, windows {Ctrl} other {Ctrl}}",
      "{os, select, macos {Cmd} other {Strg}}",
    ),
  ).toEqual({ ok: true });
  // The same select twice, in a branch and in its `other` copy, says
  // its finding once.
  const count =
    "{unit, select, seconds {{amount, plural, one {# s} other {# s}}} other {{amount, plural, one {# h} other {# h}}}}";
  const da = v(
    count,
    "{unit, select, sekunder {{amount, select, en {{amount} sekund} other {{amount} sekunder}}} timer {{amount, select, en {{amount} time} other {{amount} timer}}} other {{amount, select, en {{amount} time} other {{amount} timer}}}}",
  );
  expect(da.ok ? [] : da.errors).toEqual([
    { code: "unexpected-branch", arg: "amount", key: "en" },
  ]);
});

test("a message reference is {@name}: a translation may add one, dropping its source's is missing, and it never selects or formats (#1083)", () => {
  expect(
    partsOf("Erlaubte {@preferences-url-schemes} für {name}", "fluent")
      .placeholders,
  ).toEqual(new Set(["@preferences-url-schemes", "name"]));
  expect(parseIcu("{@trash}", "icu").ok).toBe(false);
  expect(parseIcu("{@trash, select, other {x}}", "fluent").ok).toBe(false);
  expect(parseIcu("{@n, plural, other {x}}", "fluent").ok).toBe(false);
  expect(parseIcu("{@n, number}", "fluent").ok).toBe(false);
  expect(parseIcu("{@-brand}", "fluent").ok).toBe(false);
  // Anki's de: its own word for "URL Schemes", a message en never uses.
  expect(
    validateTranslation(
      "Allowed URL Schemes (space-separated):",
      "Erlaubte {@preferences-url-schemes} (durch Leerzeichen getrennt):",
      "de",
      "fluent",
    ),
  ).toEqual({ ok: true });
  const dropped = validateTranslation(
    "Empty {@trash}",
    "Leeren",
    "de",
    "fluent",
  );
  expect(dropped.ok ? [] : dropped.errors).toEqual([
    expect.objectContaining({ code: "missing-placeholder", name: "@trash" }),
  ]);
  // A variable the source lacks is still a finding: ia's {number}.
  expect(
    validateTranslation(
      "Set your subdomain",
      "Defini tu subdominio {number}",
      "ia",
      "fluent",
    ).ok,
  ).toBe(false);
  // A reference is no variable of the same name, either way.
  expect(
    validateTranslation(
      "{items} in {@trash}",
      "{@items} em {@trash}",
      "pt",
      "fluent",
    ).ok,
  ).toBe(false);
});
