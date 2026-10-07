import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluralRulesOf, validateTranslation } from "@corpus/contract";
import { expect, test } from "vitest";
import { GETTEXT_PLURALS } from "./gettextplurals";
import {
  CONTEXT_SEPARATOR,
  entriesToGettext,
  gettextToEntries,
  gettextPluralCategories,
  gettextPluralReading,
  gettextSuggestions,
  gettextTranslations,
  parsePo,
  pluralTable,
  poPluralText,
} from "./gettext";

const indexesOf = (language: string, forms: string | undefined) =>
  pluralTable(language, forms).indexes;

// Joplin's shape: a .pot beside a .po per language.
const POT = `# Joplin translation template
msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

#. The app's name, never translated
#: packages/app/main.ts:12
msgid "Joplin"
msgstr ""

msgctxt "menu"
msgid "Open"
msgstr ""

#: packages/lib/sync.ts:40
msgid ""
"Synchronise %s "
"with \\"%s\\""
msgstr ""

msgid "%d note"
msgid_plural "%d notes"
msgstr[0] ""
msgstr[1] ""

#~ msgid "Old"
#~ msgstr "Alt"
`;

const DE = `msgid ""
msgstr ""
"Language: de\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "Joplin"
msgstr "Joplin"

msgctxt "menu"
msgid "Open"
msgstr "Öffnen"

#, fuzzy
msgid "Synchronise %s with \\"%s\\""
msgstr "Synchronisiere %s"

msgid "%d note"
msgid_plural "%d notes"
msgstr[0] "%d Notiz"
msgstr[1] "%d Notizen"
`;

const RU = `msgid ""
msgstr ""
"Language: ru\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgid "%d note"
msgid_plural "%d notes"
msgstr[0] "%d заметка"
msgstr[1] "%d заметки"
msgstr[2] "%d заметок"
`;

test("a .pot's msgids are strings and keys; a context is joined; continuation lines and escapes read (#718)", () => {
  expect(gettextToEntries(POT, { type: "ui" })).toEqual([
    {
      id: "Joplin",
      type: "ui",
      source: "Joplin",
      keyIsText: true,
      note: "The app's name, never translated\nUsed in packages/app/main.ts:12",
    },
    {
      id: `menu${CONTEXT_SEPARATOR}Open`,
      type: "ui",
      source: "Open",
      keyIsText: true,
    },
    {
      id: 'Synchronise %s with "%s"',
      type: "ui",
      source: 'Synchronise %s with "%s"',
      keyIsText: true,
      note: "Used in packages/lib/sync.ts:40",
    },
    {
      id: "%d note",
      type: "ui",
      source: "{count, plural, one {%d note} other {%d notes}}",
      keyIsText: true,
    },
  ]);
  // The obsolete entry is not read.
  expect(parsePo(POT).map((e) => e.msgid)).not.toContain("Old");
});

test("a .po's translations skip fuzzy rows; plural forms map through Plural-Forms (#718)", () => {
  expect(gettextTranslations(DE, "de")).toEqual([
    { id: "Joplin", type: "", source: "Joplin" },
    { id: `menu${CONTEXT_SEPARATOR}Open`, type: "", source: "Öffnen" },
    {
      id: "%d note",
      type: "",
      source: "{count, plural, one {%d Notiz} other {%d Notizen}}",
    },
  ]);
  // Russian's three forms are one, few and many; other, only decimals'
  // in CLDR, is the last form.
  expect([
    ...indexesOf(
      "ru",
      "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
    ),
  ]).toEqual([
    ["many", 2],
    ["one", 0],
    ["few", 1],
    ["other", 2],
  ]);
  expect(gettextTranslations(RU, "ru")).toEqual([
    {
      id: "%d note",
      type: "",
      source:
        "{count, plural, one {%d заметка} few {%d заметки} many {%d заметок} other {%d заметок}}",
    },
  ]);
});

test("an expression that is not arithmetic, or leaves the range, is not run; CLDR stands in (#718)", () => {
  expect([...indexesOf("de", "nplurals=2; plural=process.exit(1);")]).toEqual([
    ["one", 0],
    ["other", 1],
  ]);
  expect([...indexesOf("de", "nplurals=2; plural=n+5;")]).toEqual([
    ["one", 0],
    ["other", 1],
  ]);
});

test("a category gettext cannot name reads the form its integers take, or other's (#718)", () => {
  // French many is a million, which nplurals=2 holds no form of: it is
  // not read, or an edit to it alone would be lost (#973).
  const fr = `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d note"\nmsgstr[1] "%d notes"\n`;
  expect(gettextTranslations(fr, "fr")[0]?.source).toBe(
    "{count, plural, one {%d note} other {%d notes}}",
  );
  // A tag the config maps from `sr@latin` reads Serbian's rules.
  const sr = fr
    .replace(
      "nplurals=2; plural=(n > 1);",
      "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
    )
    .replace(
      'msgstr[1] "%d notes"',
      'msgstr[1] "%d beleške"\nmsgstr[2] "%d beležaka"',
    );
  expect(gettextTranslations(sr, "sr-Latn")[0]?.source).toBe(
    "{count, plural, one {%d note} few {%d beleške} other {%d beležaka}}",
  );
});

test("a byte-order mark, entries with no blank line between them, octal and hex escapes (#718)", () => {
  const text = `\uFEFFmsgid ""\nmsgstr ""\n"Language: ru\\n"\n"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"\n\nmsgid "a"\nmsgstr "A\\101\\x42"\nmsgid "b"\nmsgstr "B"\n#, fuzzy\nmsgid "c"\nmsgstr "C"\n`;
  expect(gettextTranslations(text, "ru")).toEqual([
    { id: "a", type: "", source: "AAB" },
    { id: "b", type: "", source: "B" },
  ]);
});

test("a tie goes to the lower index: pt with (n != 1) reads one from msgstr[0] (#718)", () => {
  const pt = `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] "%d ficheiro"\nmsgstr[1] "%d ficheiros"\n`;
  for (const language of ["pt", "fr"])
    expect(gettextTranslations(pt, language)[0]?.source).toMatch(
      /^\{count, plural, one \{%d ficheiro\}/,
    );
});

const read = (text: string, language: string) =>
  Object.fromEntries(
    gettextTranslations(text, language).map((e) => [e.id, e.source]),
  );
const DE_LANG = { tag: "de", code: "de" };
const RU_LANG = { tag: "ru", code: "ru" };

test("pulling a .po's own translations back writes the same bytes, CRLF and fuzzy rows kept (#719)", () => {
  expect(entriesToGettext(POT, read(DE, "de"), DE, DE_LANG)).toBe(DE);
  expect(entriesToGettext(POT, read(RU, "ru"), RU, RU_LANG)).toBe(RU);
  const crlf = DE.replace(/\n/g, "\r\n");
  expect(entriesToGettext(POT, read(crlf, "de"), crlf, DE_LANG)).toBe(crlf);
});

test("a changed msgstr is rewritten alone, wrapped as msgmerge wraps it (#719)", () => {
  const long =
    "- Standort: Erlaubt das Anhängen von geografischen Standortinformationen an eine Notiz.";
  const out = entriesToGettext(
    POT,
    { ...read(DE, "de"), [`menu${CONTEXT_SEPARATOR}Open`]: long },
    DE,
    DE_LANG,
  );
  expect(out).toBe(
    DE.replace(
      'msgstr "Öffnen"',
      'msgstr ""\n"- Standort: Erlaubt das Anhängen von geografischen Standortinformationen an "\n"eine Notiz."',
    ),
  );
  // Newlines split lines, quotes and backslashes are escaped, a word
  // longer than a line stays whole, a wide character counts two.
  expect(
    entriesToGettext(
      POT,
      { Joplin: 'Zeile "eins"\\\nZeile zwei' },
      DE,
      DE_LANG,
    ),
  ).toContain(
    'msgid "Joplin"\nmsgstr ""\n"Zeile \\"eins\\"\\\\\\n"\n"Zeile zwei"\n',
  );
  const ja =
    "ノートにファイルを添付するのとファイルシステムの同期に必要です。".repeat(
      2,
    );
  expect(entriesToGettext(POT, { Joplin: ja }, DE, DE_LANG)).toContain(
    'msgstr ""\n"ノートにファイルを添付するのとファイルシステムの同期に必要です。ノートにファ"\n"イルを添付するのとファイルシステムの同期に必要です。"\n',
  );
});

test("writing a fuzzy row clears its fuzzy flag and previous msgid, keeping other flags (#719)", () => {
  const fuzzy = DE.replace(
    '#, fuzzy\nmsgid "Synchronise',
    '#, fuzzy, c-format\n#| msgid "Synchronise %s"\nmsgid "Synchronise',
  );
  const id = 'Synchronise %s with "%s"';
  expect(
    entriesToGettext(POT, { [id]: "Synchronisiere %s" }, fuzzy, DE_LANG),
  ).toBe(
    DE.replace(
      '#, fuzzy\nmsgid "Synchronise',
      '#, c-format\nmsgid "Synchronise',
    ),
  );
  expect(
    entriesToGettext(POT, { [id]: "Synchronisiere %s mit „%s“" }, DE, DE_LANG),
  ).toBe(
    DE.replace(
      '#, fuzzy\nmsgid "Synchronise %s with \\"%s\\""\nmsgstr "Synchronisiere %s"',
      'msgid "Synchronise %s with \\"%s\\""\nmsgstr "Synchronisiere %s mit „%s“"',
    ),
  );
});

test("a new ru plural lands as msgstr[0..2], appended from the template before obsolete entries (#719)", () => {
  const ru = RU.replace(
    /\nmsgid "%d note"[^]*$/,
    '\n#~ msgid "Old"\n#~ msgstr "Старое"\n',
  );
  const out = entriesToGettext(
    POT,
    {
      "%d note":
        "{count, plural, one {%d заметка} few {%d заметки} many {%d заметок} other {%d заметки}}",
    },
    ru,
    RU_LANG,
  );
  expect(out).toBe(
    ru.replace(
      "\n#~",
      '\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d заметка"\nmsgstr[1] "%d заметки"\nmsgstr[2] "%d заметок"\n\n#~',
    ),
  );
  expect(read(out, "ru")["%d note"]).toBe(
    "{count, plural, one {%d заметка} few {%d заметки} many {%d заметок} other {%d заметок}}",
  );
  // A plain text is written into every form (#1092).
  const refused: string[] = [];
  expect(
    entriesToGettext(POT, { "%d note": "заметки" }, RU, RU_LANG, (id) =>
      refused.push(id),
    ),
  ).toContain(
    'msgid_plural "%d notes"\nmsgstr[0] "заметки"\nmsgstr[1] "заметки"\nmsgstr[2] "заметки"',
  );
  expect(refused).toEqual([]);
});

test("a form no category reads, Latvian's for zero alone, keeps the file's text (#719)", () => {
  const lv = `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2);\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d piezīme"\nmsgstr[1] "%d piezīmes"\nmsgstr[2] "Nav piezīmju"\n`;
  const out = entriesToGettext(
    POT,
    {
      "%d note":
        "{count, plural, zero {%d piezīmju} one {%d piezīme} other {%d piezīmes!}}",
    },
    lv,
    { tag: "lv", code: "lv" },
  );
  expect(out).toBe(lv.replace('"%d piezīmes"', '"%d piezīmes!"'));
});

// French's forms as CLDR 48 has them: one, many (a million), other.
const FR = "((n==0 || n==1)) ? 0 : ((!(n==0) && n%1000000==0)) ? 1 : 2";
const SR =
  "((n%10==1 && !(n%100==11))) ? 0 : (((n%10>=2 && n%10<=4) && !(n%100>=12 && n%100<=14))) ? 1 : 2";

test("a missing target starts from the template, its Language and charset set (#719)", () => {
  const pot = POT.replace(
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Language: \\n"\n"Content-Type: text/plain; charset=CHARSET\\n"',
  );
  const out = entriesToGettext(pot, { Joplin: "Joplin" }, undefined, {
    tag: "sr-Latn",
    code: "sr@latin",
  });
  expect(out).toBe(
    pot
      .replace(
        '"Language: \\n"',
        `"Language: sr@latin\\n"\n"Plural-Forms: nplurals=3; plural=${SR};\\n"`,
      )
      .replace("charset=CHARSET", "charset=UTF-8")
      .replace('msgid "Joplin"\nmsgstr ""', 'msgid "Joplin"\nmsgstr "Joplin"')
      // Serbian's three forms, as its header says (#786).
      .replace('msgstr[1] ""\n\n#~', 'msgstr[1] ""\nmsgstr[2] ""\n\n#~'),
  );
  // A template with no Language line gets one.
  expect(entriesToGettext(POT, {}, undefined, DE_LANG)).toContain(
    '"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: de\\n"\n',
  );
});

test("an appended entry goes above the comments and flags of the first obsolete entry, in the file's line endings (#719)", () => {
  const de = DE.replace(
    /\nmsgid "%d note"[^]*$/,
    '\n# translator note\n#, fuzzy\n#~ msgid "Old"\n#~ msgstr "Alt"\n',
  );
  const plural = "{count, plural, one {%d Notiz} other {%d Notizen}}";
  const note =
    'msgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d Notiz"\nmsgstr[1] "%d Notizen"\n\n';
  expect(entriesToGettext(POT, { "%d note": plural }, de, DE_LANG)).toBe(
    de.replace("# translator note", `${note}# translator note`),
  );
  const crlfPot = POT.replace(/\n/g, "\r\n");
  const appended = entriesToGettext(
    crlfPot,
    { "%d note": plural },
    de,
    DE_LANG,
  );
  expect(appended).not.toContain("\r");
});

test("a no-wrap entry breaks at newlines alone; a new file drops the template header's fuzzy flag (#719)", () => {
  const long = "word ".repeat(30).trim();
  const noWrap = DE.replace('msgid "Joplin"', '#, no-wrap\nmsgid "Joplin"');
  expect(entriesToGettext(POT, { Joplin: long }, noWrap, DE_LANG)).toContain(
    `#, no-wrap\nmsgid "Joplin"\nmsgstr "${long}"\n`,
  );
  const pot = POT.replace(
    'msgid ""\nmsgstr ""',
    '#, fuzzy\nmsgid ""\nmsgstr ""',
  );
  const out = entriesToGettext(pot, {}, undefined, DE_LANG);
  expect(out).not.toContain("#, fuzzy");
  expect(out.startsWith('# Joplin translation template\nmsgid ""\n')).toBe(
    true,
  );
});

test("a missing target started from a source .po keeps its entries and header with every msgstr empty, as msginit starts one (#725)", () => {
  const out = entriesToGettext(
    DE,
    { [`menu${CONTEXT_SEPARATOR}Open`]: "Ouvrir" },
    undefined,
    {
      tag: "fr",
      code: "fr",
    },
  );
  expect(out).toBe(`msgid ""
msgstr ""
"Language: fr\\n"
"Plural-Forms: nplurals=3; plural=${FR};\\n"

msgid "Joplin"
msgstr ""

msgctxt "menu"
msgid "Open"
msgstr "Ouvrir"

msgid "Synchronise %s with \\"%s\\""
msgstr ""

msgid "%d note"
msgid_plural "%d notes"
msgstr[0] ""
msgstr[1] ""
msgstr[2] ""
`);
  // A plural Corpus holds is written; the others stay empty.
  const plural = entriesToGettext(
    DE,
    { "%d note": "{count, plural, one {%d note} other {%d notes}}" },
    undefined,
    { tag: "fr", code: "fr" },
  );
  expect(plural).toContain(
    'msgid_plural "%d notes"\nmsgstr[0] "%d note"\nmsgstr[1] "%d notes"\nmsgstr[2] "%d notes"\n',
  );
  expect(plural).toContain('msgid "Joplin"\nmsgstr ""\n');
});

test("a missing target started from a source .po drops its obsolete entries, and a headerless one is emptied too (#725)", () => {
  const withObsolete = `${DE}\n# old note\n#~ msgid "Gone"\n#~ msgstr "Weg"\n`;
  const out = entriesToGettext(withObsolete, {}, undefined, {
    tag: "fr",
    code: "fr",
  });
  expect(out).not.toContain("#~");
  expect(out).not.toContain("old note");
  expect(out.endsWith('msgstr[2] ""\n')).toBe(true);
  const headerless = 'msgid "Joplin"\nmsgstr "Joplin"\n';
  expect(
    entriesToGettext(headerless, {}, undefined, { tag: "fr", code: "fr" }),
  ).toBe('msgid "Joplin"\nmsgstr ""\n');
});

test("a fuzzy entry is a suggestion, never a translation; an empty fuzzy one is none (#721)", () => {
  const po = `msgid ""
msgstr ""
"Language: de\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "Joplin"
msgstr "Joplin"

#, fuzzy
msgid "Open"
msgstr "Öffnen?"

#, fuzzy
msgid "Close"
msgstr ""

#, fuzzy
msgid "%d note"
msgid_plural "%d notes"
msgstr[0] "%d Notiz"
msgstr[1] "%d Notizen"
`;
  expect(gettextTranslations(po, "de").map((e) => e.id)).toEqual(["Joplin"]);
  expect(gettextSuggestions(po, "de")).toEqual([
    { id: "Open", type: "", source: "Öffnen?" },
    {
      id: "%d note",
      type: "",
      source: "{count, plural, one {%d Notiz} other {%d Notizen}}",
    },
  ]);
});

test("a target started from a template takes its language's Plural-Forms from the CLDR table; a language the table lacks keeps the template's, said once (#786)", () => {
  const en = `msgid ""
msgstr ""
"Language: en\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d file"
msgstr[1] "%d files"
`;
  const pl = entriesToGettext(
    en,
    {
      "%d file":
        "{count, plural, one {%d plik} few {%d pliki} many {%d plików} other {%d pliku}}",
    },
    undefined,
    { tag: "pl", code: "pl" },
  );
  expect(pl).toContain(
    '"Plural-Forms: nplurals=3; plural=(n==1) ? 0 : (((n%10>=2 && n%10<=4) && !(n%100>=12 && n%100<=14))) ? 1 : 2;\\n"',
  );
  expect(pl).toContain(
    'msgstr[0] "%d plik"\nmsgstr[1] "%d pliki"\nmsgstr[2] "%d plików"\n',
  );
  // A .pot's placeholder header gets the language's line; a tag with a
  // region falls back to its language.
  const pot = en
    .replace('"Language: en\\n"', '"Language: \\n"')
    .replace(
      "nplurals=2; plural=(n != 1);",
      "nplurals=INTEGER; plural=EXPRESSION;",
    )
    .replace(
      'msgstr[0] "%d file"\nmsgstr[1] "%d files"',
      'msgstr[0] ""\nmsgstr[1] ""',
    );
  expect(
    entriesToGettext(pot, {}, undefined, { tag: "ru-RU", code: "ru_RU" }),
  ).toContain('"Plural-Forms: nplurals=3; plural=');
  // A language CLDR has no rule for keeps the template's line.
  const notes: string[] = [];
  const xx = entriesToGettext(
    en,
    {},
    undefined,
    { tag: "tlh", code: "tlh" },
    undefined,
    (note) => notes.push(note),
  );
  expect(xx).toContain('"Plural-Forms: nplurals=2; plural=(n != 1);\\n"');
  expect(notes).toEqual([
    "no CLDR plural rule for tlh; the new file's Plural-Forms is the template's, or none",
  ]);
});

test("a new file's plural entries hold as many msgstrs as its language's forms (#786)", () => {
  const en = `msgid ""
msgstr ""
"Language: en\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

msgid "%d file"
msgid_plural "%d files"
msgstr[0] "%d file"
msgstr[1] "%d files"
`;
  const ru = entriesToGettext(en, {}, undefined, { tag: "ru", code: "ru" });
  expect(ru).toContain(
    'msgid_plural "%d files"\nmsgstr[0] ""\nmsgstr[1] ""\nmsgstr[2] ""\n',
  );
  const ja = entriesToGettext(en, {}, undefined, { tag: "ja", code: "ja" });
  expect(ja).toContain('msgid_plural "%d files"\nmsgstr[0] ""\n');
  expect(ja).not.toContain("msgstr[1]");
});

test("a Plural-Forms msgmerge wrapped over two lines is replaced whole; a tag's case does not matter (#786)", () => {
  const ru = `msgid ""
msgstr ""
"Language: ru\\n"
"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && "
"n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"
"Content-Type: text/plain; charset=UTF-8\\n"

msgid "File"
msgstr "Файл"
`;
  const de = entriesToGettext(ru, {}, undefined, { tag: "de", code: "de" });
  expect(de).toContain(
    '"Language: de\\n"\n"Plural-Forms: nplurals=2; plural=(n==1) ? 0 : 1;\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n',
  );
  expect(de).not.toContain("n%10<=4");
  expect(
    entriesToGettext(ru, {}, undefined, { tag: "pt-pt", code: "pt_PT" }),
  ).toContain(
    `"Plural-Forms: nplurals=3; plural=${GETTEXT_PLURALS["pt-PT"]!.plural};\\n"`,
  );
});

test("a header line with trailing whitespace after its closing quote ends its field; the fields after it stay (#818)", () => {
  const en = `msgid ""
msgstr ""
"Language: en\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"   
"X-Generator: Poedit\\n"

msgid "File"
msgstr "File"
`;
  const de = entriesToGettext(en, {}, undefined, { tag: "de", code: "de" });
  expect(de).toContain('"X-Generator: Poedit\\n"');
  expect(de).toContain('"Plural-Forms: nplurals=2; plural=(n==1) ? 0 : 1;\\n"');
});

const RU_HEADER = `msgid ""\nmsgstr ""\n"Language: ru\\n"\n"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"\n`;
const RU_PLURAL =
  "{count, plural, one {%d файл} few {%d файла} many {%d файлов} other {%d файла}}";

test("an entry with no msgstr takes its translation after its msgid, never at the start of the file (#833)", () => {
  const po = `${RU_HEADER}\nmsgid "Open"\n\nmsgid "Close"\nmsgstr ""\n`;
  expect(entriesToGettext(po, { Open: "Открыть" }, po, RU_LANG)).toBe(
    `${RU_HEADER}\nmsgid "Open"\nmsgstr "Открыть"\n\nmsgid "Close"\nmsgstr ""\n`,
  );
  const noted = `${RU_HEADER}\nmsgid "Open"\n# a translator's note\n`;
  expect(entriesToGettext(noted, { Open: "Открыть" }, noted, RU_LANG)).toBe(
    `${RU_HEADER}\nmsgid "Open"\nmsgstr "Открыть"\n# a translator's note\n`,
  );
  const plural = `${RU_HEADER}\nmsgid "%d file"\nmsgid_plural "%d files"\n`;
  const out = entriesToGettext(
    plural,
    { "%d file": RU_PLURAL },
    plural,
    RU_LANG,
  );
  expect(out).toBe(
    `${plural}msgstr[0] "%d файл"\nmsgstr[1] "%d файла"\nmsgstr[2] "%d файлов"\n`,
  );
});

test("a gapped plural takes each missing msgstr[n] in its place (#833)", () => {
  const entry = `msgid "%d file"\nmsgid_plural "%d files"\n`;
  const gapped = `${RU_HEADER}\n${entry}msgstr[0] "a"\nmsgstr[2] "c"\n`;
  const want = `${RU_HEADER}\n${entry}msgstr[0] "%d файл"\nmsgstr[1] "%d файла"\nmsgstr[2] "%d файлов"\n`;
  expect(
    entriesToGettext(gapped, { "%d file": RU_PLURAL }, gapped, RU_LANG),
  ).toBe(want);
  const headless = `${RU_HEADER}\n${entry}msgstr[2] "c"\n`;
  expect(
    entriesToGettext(headless, { "%d file": RU_PLURAL }, headless, RU_LANG),
  ).toBe(want);
  // A new file started from a gapped template: one entry, no blank line in it.
  const pot = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\n${entry}msgstr[0] ""\nmsgstr[2] ""\n`;
  const fresh = entriesToGettext(
    pot,
    { "%d file": RU_PLURAL },
    undefined,
    RU_LANG,
  );
  expect(fresh).toContain(
    `${entry}msgstr[0] "%d файл"\nmsgstr[1] "%d файла"\nmsgstr[2] "%d файлов"\n`,
  );
  expect(parsePo(fresh)).toHaveLength(2);
});

test("an entry with no msgstr ends at the next msgid or comment, as msgfmt reads it (#842)", () => {
  const po = `${RU_HEADER}\nmsgid "Open"\n#: src/b.ts:2\nmsgid "Close"\nmsgstr ""\n`;
  const entries = parsePo(po);
  expect(entries.map((e) => e.msgid)).toEqual(["", "Open", "Close"]);
  expect(entries[2]?.references).toEqual(["src/b.ts:2"]);
  expect(entries[1]?.references).toEqual([]);
  const bare = `${RU_HEADER}\nmsgid "Open"\nmsgid "Close"\nmsgstr ""\n`;
  expect(parsePo(bare).map((e) => e.msgid)).toEqual(["", "Open", "Close"]);
  expect(
    entriesToGettext(po, { Open: "Открыть", Close: "Закрыть" }, po, RU_LANG),
  ).toBe(
    `${RU_HEADER}\nmsgid "Open"\nmsgstr "Открыть"\n#: src/b.ts:2\nmsgid "Close"\nmsgstr "Закрыть"\n`,
  );
});

const LV_HEADER = `msgid ""\nmsgstr ""\n"Language: lv\\n"\n"Plural-Forms: nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2);\\n"\n`;
const LV = { tag: "lv", code: "lv" };
const LV_PLURAL =
  "{count, plural, zero {%d nulle} one {%d viens} other {%d daudz}}";
const lvEntry = `msgid "%d file"\nmsgid_plural "%d files"\n`;
const forms = (po: string) =>
  parsePo(po).find((e) => e.msgid === "%d file")!.msgstr;

test("a Plural-Forms index no CLDR category reads is filled from the category most of its integers are, never left empty (#848)", () => {
  const pot = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\n${lvEntry}msgstr[0] ""\nmsgstr[1] ""\n`;
  const fresh = `${LV_HEADER}\n${lvEntry}msgstr[0] ""\nmsgstr[1] ""\nmsgstr[2] ""\n`;
  const written = forms(
    entriesToGettext(pot, { "%d file": LV_PLURAL }, fresh, LV),
  );
  expect(written[2]).toBe("%d nulle");
  expect(written.every((f) => f !== "")).toBe(true);
  // A file short of that form gets it; one that holds text there keeps it.
  const short = `${LV_HEADER}\n${lvEntry}msgstr[0] "${written[0]}"\nmsgstr[1] "${written[1]}"\n`;
  expect(
    forms(entriesToGettext(pot, { "%d file": LV_PLURAL }, short, LV))[2],
  ).toBe("%d nulle");
  const held = `${LV_HEADER}\n${lvEntry}msgstr[0] "${written[0]}"\nmsgstr[1] "${written[1]}"\nmsgstr[2] "mans"\n`;
  expect(entriesToGettext(pot, { "%d file": LV_PLURAL }, held, LV)).toBe(held);
  // An entry appended from a source-language .po takes none of its text.
  const enPo = `msgid ""\nmsgstr ""\n"Language: en\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\n${lvEntry}msgstr[0] "%d file"\nmsgstr[1] "%d files"\n`;
  const fil = `msgid ""\nmsgstr ""\n"Language: fil\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n`;
  const appended = forms(
    entriesToGettext(
      enPo,
      { "%d file": "{count, plural, one {%d O} other {%d X}}" },
      fil,
      { tag: "fil", code: "fil" },
    ),
  );
  expect(appended.every((f) => f !== "")).toBe(true);
});

test("a keyword with its string right after it, and escaped UTF-8 bytes, read as msgfmt reads them (#849)", () => {
  const po = `${RU_HEADER}\nmsgid "a"\nmsgstr"B"\n\nmsgid "b"\nmsgstr "caf\\303\\251 \\xe2\\x82\\xac \\351"\n`;
  const read = Object.fromEntries(
    gettextTranslations(po, "ru").map((e) => [e.id, e.source]),
  );
  expect(read).toEqual({ a: "B", b: "café € é" });
  expect(entriesToGettext(po, read, po, RU_LANG)).toBe(po);
  expect(entriesToGettext(po, { a: "Bee" }, po, RU_LANG)).toBe(
    po.replace('msgstr"B"', 'msgstr "Bee"'),
  );
  // An escaped BOM is a character like any other.
  const bom = `${RU_HEADER}\nmsgid "c"\nmsgstr "\\357\\273\\277x"\n`;
  expect(gettextTranslations(bom, "ru")[0]?.source).toBe("\uFEFFx");
  // A keyword alone on its line takes the string on the next.
  const split = `${RU_HEADER}\nmsgid "d"\nmsgstr\n"D"\n`;
  expect(gettextTranslations(split, "ru")).toEqual([
    { id: "d", type: "", source: "D" },
  ]);
});

test("surplus msgstrs go cleanly, every one of them, whatever the template's last byte (#864)", () => {
  const plHeader = `msgid ""\nmsgstr ""\n"Language: pl\\n"\n"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"\n`;
  const entry = `msgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] "a"\nmsgstr[1] "b"\nmsgstr[2] "c"`;
  const ja = { tag: "ja", code: "ja" };
  // Appended into an existing file: three forms to one, no blank line.
  const template = `${plHeader}\n${entry}\n\nmsgid "Bye"\nmsgstr "Pa"\n`;
  const existing = `msgid ""\nmsgstr ""\n"Language: ja\\n"\n"Plural-Forms: nplurals=1; plural=0;\\n"\n\nmsgid "Bye"\nmsgstr "Sayonara"\n`;
  const out = entriesToGettext(
    template,
    { "%d file": "{count, plural, other {%d fairu}}" },
    existing,
    ja,
  );
  expect(out.endsWith(`msgid_plural "%d files"\nmsgstr[0] "%d fairu"\n`)).toBe(
    true,
  );
  // A new file from a template with no final newline ends as it does.
  const bare = `${plHeader}\n${entry}`;
  expect(
    entriesToGettext(bare, {}, undefined, ja).endsWith('msgstr[0] ""'),
  ).toBe(true);
});

test("a character's escaped bytes split across continuation lines read as one, as msgfmt reads them (#926)", () => {
  const file = (msgstr: string) =>
    `msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "x"\n${msgstr}\n`;
  const read = (msgstr: string) =>
    gettextTranslations(file(msgstr), "de").map((e) => e.source);
  // msgfmt reads each as "café".
  expect(read('msgstr ""\n"caf\\303"\n"\\251"')).toEqual(["café"]);
  expect(read('msgstr "caf\\303\\251"')).toEqual(["café"]);
  // Each string's escapes are its own: a short one never takes the next
  // line's digits.
  expect(read('msgstr ""\n"\\30"\n"3"')).toEqual(["\x183"]);
  expect(read('msgstr ""\n"\\x4"\n"1"')).toEqual(["\x041"]);
  expect(read('msgstr ""\n"\\1"\n"01\\102"')).toEqual(["\x0101B"]);
});

test("a target file's categories are the ones its Plural-Forms picks, or its language's table without one (#951)", () => {
  const po = (forms: string) =>
    `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Plural-Forms: ${forms}\\n"\n`;
  // Italian's files write nplurals=2, where CLDR adds many.
  expect(
    gettextPluralCategories(po("nplurals=2; plural=(n != 1);"), "it"),
  ).toEqual(["one", "other"]);
  expect(gettextPluralCategories(undefined, "it")).toEqual(
    GETTEXT_PLURALS.it!.forms,
  );
  // Polish reads no form for other, which only fractions reach.
  expect(
    gettextPluralCategories(
      po(
        "nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
      ),
      "pl",
    ),
  ).toEqual(["one", "few", "many"]);
  expect(gettextPluralCategories('msgid ""\nmsgstr ""\n', "ja")).toEqual([
    "other",
  ]);
  // A file with no rule is read in CLDR's order, as the reader and the
  // writer read it; the table is for a file not there yet (#973).
  expect(gettextPluralCategories('msgid ""\nmsgstr ""\n', "cs")).toEqual([
    "one",
    "few",
    "many",
    "other",
  ]);
  for (const missing of [undefined, "", "\n"])
    expect(gettextPluralCategories(missing, "cs")).toEqual(
      GETTEXT_PLURALS.cs!.forms,
    );
});

test("a plural entry short of its nplurals is left byte for byte while its reading is unchanged (#981)", () => {
  const ug = `msgid ""\nmsgstr ""\n"Language: ug\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] "%d ھۆججەت"\n`;
  const lang = { tag: "ug", code: "ug" };
  const read = Object.fromEntries(
    gettextTranslations(ug, "ug").map((e) => [e.id, e.source]),
  );
  expect(read["%d file"]).toBe(
    "{count, plural, one {%d ھۆججەت} other {%d ھۆججەت}}",
  );
  expect(entriesToGettext(ug, read, ug, lang)).toBe(ug);
  const edited = entriesToGettext(
    ug,
    { "%d file": "{count, plural, one {%d A} other {%d B}}" },
    ug,
    lang,
  );
  expect(parsePo(edited).find((e) => e.msgid === "%d file")!.msgstr).toEqual([
    "%d A",
    "%d B",
  ]);
  // Its branches in another order are the same reading.
  const reordered = {
    "%d file": "{count, plural, other {%d ھۆججەت} one {%d ھۆججەت}}",
  };
  expect(entriesToGettext(ug, reordered, ug, lang)).toBe(ug);
  // A fuzzy one taken as it stands is written: its flag goes.
  const fuzzy = ug.replace('msgid "%d file"', '#, fuzzy\nmsgid "%d file"');
  expect(entriesToGettext(fuzzy, read, fuzzy, lang)).toBe(
    ug.replace(
      'msgstr[0] "%d ھۆججەت"\n',
      'msgstr[0] "%d ھۆججەت"\nmsgstr[1] "%d ھۆججەت"\n',
    ),
  );
});

const po = (forms: string, lang: string, body: string) =>
  `msgid ""\nmsgstr ""\n"Language: ${lang}\\n"\n"Plural-Forms: ${forms}\\n"\n\nmsgid "%d file"\nmsgid_plural "%d files"\n${body}`;
const seedOf = (text: string, lang: string) =>
  gettextTranslations(text, lang).find((e) => e.id === "%d file")?.source;
const CEB = "nplurals=2; plural=(n != 1);";
const GV = "nplurals=3; plural=n == 1 ? 0 : (n == 2 ? 1 : 2);";
const HE =
  "nplurals=4; plural=(n == 1) ? 0 : ((n == 2) ? 1 : ((n > 10 && n % 10 == 0) ? 2 : 3));";

test("a Plural-Forms that leaves a form no CLDR category reads is read as the file's own: =k where one integer reaches it (#982)", () => {
  const ceb = po(CEB, "ceb", `msgstr[0] "S"\nmsgstr[1] "P"\n`);
  expect(seedOf(ceb, "ceb")).toBe("{count, plural, =1 {S} other {P}}");
  expect(gettextPluralCategories(ceb, "ceb")).toEqual(["=1", "other"]);
  const written = entriesToGettext(
    ceb,
    { "%d file": "{count, plural, =1 {A} other {B}}" },
    ceb,
    { tag: "ceb", code: "ceb" },
  );
  expect(forms(written)).toEqual(["A", "B"]);
  expect(
    entriesToGettext(ceb, { "%d file": seedOf(ceb, "ceb")! }, ceb, {
      tag: "ceb",
      code: "ceb",
    }),
  ).toBe(ceb);

  const gv = po(GV, "gv", `msgstr[0] "A1"\nmsgstr[1] "A2"\nmsgstr[2] "A3"\n`);
  expect(seedOf(gv, "gv")).toBe("{count, plural, =1 {A1} =2 {A2} other {A3}}");
  expect(gettextPluralCategories(gv, "gv")).toEqual(["=1", "=2", "other"]);
  expect(
    forms(
      entriesToGettext(
        gv,
        { "%d file": "{count, plural, =1 {B1} =2 {B2} other {B3}}" },
        gv,
        { tag: "gv", code: "gv" },
      ),
    ),
  ).toEqual(["B1", "B2", "B3"]);
});

test("a form whose integers are exactly a category CLDR dropped reads as it: Hebrew's many before CLDR 42 (#982)", () => {
  const he = po(
    HE,
    "he",
    `msgstr[0] "H0"\nmsgstr[1] "H1"\nmsgstr[2] "H2"\nmsgstr[3] "H3"\n`,
  );
  expect(seedOf(he, "he")).toBe(
    "{count, plural, one {H0} two {H1} many {H2} other {H3}}",
  );
  expect(gettextPluralCategories(he, "he")).toEqual([
    "one",
    "two",
    "many",
    "other",
  ]);
  expect(
    forms(
      entriesToGettext(
        he,
        { "%d file": "{count, plural, one {a} two {b} many {c} other {d}}" },
        he,
        { tag: "he", code: "he" },
      ),
    ),
  ).toEqual(["a", "b", "c", "d"]);
});

test("a key the text lacks keeps the form the file holds, and fills an empty one with the branch ICU picks for it (#982)", () => {
  const lang = { tag: "ceb", code: "ceb" };
  // A seed from before the file's own reading: one {P} other {P}.
  const held = po(CEB, "ceb", `msgstr[0] "S"\nmsgstr[1] "P"\n`);
  expect(
    forms(
      entriesToGettext(
        held,
        { "%d file": "{count, plural, one {P} other {Q}}" },
        held,
        lang,
      ),
    ),
  ).toEqual(["S", "Q"]);
  // An empty form takes what ICU shows for 1: ceb's one.
  const empty = po(CEB, "ceb", `msgstr[0] ""\nmsgstr[1] ""\n`);
  expect(
    forms(
      entriesToGettext(
        empty,
        { "%d file": "{count, plural, one {torrent} other {mga torrent}}" },
        empty,
        lang,
      ),
    ),
  ).toEqual(["torrent", "mga torrent"]);
});

test("a file whose rule coarsens CLDR, or leaves no form unread, reads as before (#982)", () => {
  expect(
    seedOf(
      po("nplurals=2; plural=(n > 1);", "fr", `msgstr[0] "a"\nmsgstr[1] "b"\n`),
      "fr",
    ),
  ).toBe("{count, plural, one {a} other {b}}");
  // Portuguese's (n != 1) splits CLDR's one (0 and 1) but reads every form.
  expect(
    seedOf(
      po(
        "nplurals=2; plural=(n != 1);",
        "pt",
        `msgstr[0] "a"\nmsgstr[1] "b"\n`,
      ),
      "pt",
    ),
  ).toBe("{count, plural, one {a} other {b}}");
  expect(
    seedOf(
      po(
        "nplurals=2; plural=(n != 1);",
        "de",
        `msgstr[0] "a"\nmsgstr[1] "b"\n`,
      ),
      "de",
    ),
  ).toBe("{count, plural, one {a} other {b}}");
});

test("a form no key fits leaves the file read by CLDR's categories, that form keeping its text: the million rule in Galician (#982)", () => {
  const MILLION =
    "nplurals=3; plural=n == 1 ? 0 : n != 0 && n % 1000000 == 0 ? 1 : 2;";
  const gl = po(MILLION, "gl", `msgstr[0] "a"\nmsgstr[1] "m"\nmsgstr[2] "c"\n`);
  expect(seedOf(gl, "gl")).toBe("{count, plural, one {a} other {c}}");
  expect(gettextPluralCategories(gl, "gl")).toEqual(["one", "other"]);
  expect(
    forms(
      entriesToGettext(
        gl,
        { "%d file": "{count, plural, one {A} other {C}}" },
        gl,
        {
          tag: "gl",
          code: "gl",
        },
      ),
    ),
  ).toEqual(["A", "m", "C"]);
  // A form that 8 and 1008 reach is not =8.
  const odd = po(
    "nplurals=2; plural=(n % 1000 == 8 ? 0 : 1);",
    "de",
    `msgstr[0] "e"\nmsgstr[1] "o"\n`,
  );
  expect(gettextPluralCategories(odd, "de")).not.toContain("=8");
});
test("an =N the file has no form for is refused by name, never dropped: in a CLDR-keyed file and in one keyed as it picks (#982)", () => {
  const cases: [string, string, string, string][] = [
    [
      "nplurals=2; plural=(n != 1);",
      "de",
      `msgstr[0] "a"\nmsgstr[1] "b"\n`,
      "{count, plural, =1 {Eine} other {# Dateien}}",
    ],
    [
      "nplurals=2; plural=(n != 1);",
      "de",
      `msgstr[0] "a"\nmsgstr[1] "b"\n`,
      "{count, plural, =0 {Keine} one {Eine} other {#}}",
    ],
    [
      CEB,
      "ceb",
      `msgstr[0] "S"\nmsgstr[1] "P"\n`,
      "{count, plural, =0 {Z} =1 {S} other {P}}",
    ],
  ];
  for (const [header, tag, body, text] of cases) {
    const file = po(header, tag, body);
    const refused: string[] = [];
    expect(
      entriesToGettext(
        file,
        { "%d file": text },
        file,
        { tag, code: tag },
        (id) => refused.push(id),
      ),
    ).toBe(file);
    expect(refused).toEqual(["%d file"]);
  }
});

test("a row kept from before a file was keyed as it picks leaves the file as it is (#982)", () => {
  const before = (header: string, tag: string, forms: string[]) => {
    const t = pluralTable(tag, header);
    return poPluralText(forms, t.indexes, t.categories);
  };
  const cases: [string, string, string[]][] = [
    [CEB, "ceb", ["S"]],
    [CEB, "ceb", ["", "P"]],
    [
      "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2);",
      "lv",
      ["A", "B"],
    ],
    [HE, "he", ["a", "b", "", "d"]],
  ];
  for (const [header, tag, held] of cases) {
    const file = po(
      header,
      tag,
      held.map((f, i) => `msgstr[${i}] "${f}"\n`).join(""),
    );
    expect(
      entriesToGettext(file, { "%d file": before(header, tag, held) }, file, {
        tag,
        code: tag,
      }),
      `${tag} ${held.join("/")}`,
    ).toBe(file);
  }
});

test("a form a few integers reach is keyed by each: Filipino's (n > 1) reads =0, =1 and other (#982)", () => {
  const TL = "nplurals=2; plural=(n > 1);";
  const tl = po(TL, "tl", `msgstr[0] "X"\nmsgstr[1] "Y"\n`);
  const lang = { tag: "tl", code: "tl" };
  expect(seedOf(tl, "tl")).toBe("{count, plural, =0 {X} =1 {X} other {Y}}");
  expect(gettextPluralCategories(tl, "tl")).toEqual(["=0", "=1", "other"]);
  // The keys one form is read by, which take one text (#1060).
  expect(gettextPluralReading(tl, "tl").shared).toEqual([["=0", "=1"]]);
  expect(gettextPluralReading(po(TL, "fr", ""), "fr").shared).toEqual([]);
  const write = (text: string, refused?: (id: string) => void) =>
    entriesToGettext(tl, { "%d file": text }, tl, lang, refused);
  expect(forms(write("{count, plural, =0 {a} =1 {a} other {b}}"))).toEqual([
    "a",
    "b",
  ]);
  expect(forms(write("{count, plural, =1 {a} other {b}}"))).toEqual(["a", "b"]);
  const refused: string[] = [];
  expect(
    write("{count, plural, =0 {a} =1 {c} other {b}}", (id) => refused.push(id)),
  ).toBe(tl);
  expect(refused).toEqual(["%d file"]);
});

test("validation refuses a Filipino draft exactly where the writer cannot hold it (#1060 review)", () => {
  const TL = "nplurals=2; plural=(n > 1);";
  const tl = po(TL, "tl", `msgstr[0] "X"\nmsgstr[1] "Y"\n`);
  const lang = { tag: "tl", code: "tl" };
  const { categories, shared } = gettextPluralReading(tl, "tl");
  const source = "{count, plural, one {%d file} other {%d files}}";
  for (const [library, text] of [
    ["printf", "{count, plural, =0 {100%%} =1 {100%} other {%d b}}"],
    ["printf", "{count, plural, =0 {%d a} =1 {%d a} other {%d b}}"],
    ["printf", "{count, plural, =0 {%d a} =1 {%d  a} other {%d b}}"],
    ["icu", "{count, plural, =0 {{count} f} =1 {{ count } f} other {# b}}"],
    ["icu", "{count, plural, =0 {# f} =1 {# f} other {# b}}"],
    ["icu", "{count, plural, =0 {<b>x</b>} =1 {<b >x</b>} other {# b}}"],
  ] as const) {
    let refused = false;
    entriesToGettext(tl, { "%d file": text }, tl, lang, () => {
      refused = true;
    });
    const result = validateTranslation(source, text, "tl", library, {
      pluralForms: categories,
      pluralShared: shared,
    });
    const shares =
      !result.ok && result.errors.some((e) => e.code === "shared-form");
    expect(shares, text).toBe(refused);
  }
});

const OC = `msgid ""\nmsgstr ""\n"Language: oc\\n"\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\nmsgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] "%d fichièr"\nmsgstr[1] "%d fichièrs"\n`;
const OC_POT = `msgid "%d file"\nmsgid_plural "%d files"\nmsgstr[0] ""\nmsgstr[1] ""\n`;

test("a tag with no plural data reads its forms by English's categories (#966)", () => {
  expect(pluralRulesOf("oc").resolvedOptions().locale).toBe("en");
  expect(pluralTable("oc", "nplurals=2; plural=(n > 1);").categories).toEqual([
    "one",
    "other",
  ]);
  expect(pluralRulesOf("pl").resolvedOptions().locale).toBe("pl");
  expect(
    pluralTable(
      "pl",
      "nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);",
    ).categories,
  ).toEqual(["one", "few", "many"]);
});

test("an Occitan file reads and writes the same under a Polish and an English locale (#966)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-966-"));
  const script = path.join(dir, "probe.mts");
  const adapters = fileURLToPath(new URL("./index.ts", import.meta.url));
  writeFileSync(
    script,
    `import { gettextTranslations, gettextPluralCategories, entriesToGettext } from ${JSON.stringify(adapters)};
const oc = ${JSON.stringify(OC)};
const seeds = gettextTranslations(oc, "oc");
const written = entriesToGettext(${JSON.stringify(OC_POT)}, { "%d file": "{count, plural, one {%d fichièr nòu} other {%d fichièrs nòus}}" }, oc, { tag: "oc", code: "oc" });
process.stdout.write(JSON.stringify({ locale: new Intl.PluralRules().resolvedOptions().locale, seeds, categories: gettextPluralCategories(oc, "oc"), written }));
`,
  );
  const under = (lang: string) => {
    const run = spawnSync(process.execPath, ["--import", "tsx", script], {
      // Where tsx resolves from.
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: lang,
        LC_ALL: lang,
      },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const { locale, ...read } = JSON.parse(run.stdout) as {
      locale: string;
      categories: string[];
    };
    // The child runs under the locale asked for, or nothing is tested.
    expect(locale).toBe(lang.slice(0, 5).replace("_", "-"));
    return read;
  };
  const polish = under("pl_PL.UTF-8");
  expect(polish).toEqual(under("en_US.UTF-8"));
  expect(polish.categories).toEqual(["one", "other"]);
  rmSync(dir, { recursive: true, force: true });
}, 60_000);

test("a plain text for a gettext plural is written into every form (#1092)", () => {
  const pot = `msgid "%d card"\nmsgid_plural "%d cards"\nmsgstr[0] ""\nmsgstr[1] ""\n`;
  const po = (lang: string, forms: string, msgstr: string[]) =>
    `msgid ""\nmsgstr ""\n"Language: ${lang}\\n"\n"Plural-Forms: ${forms}\\n"\n\nmsgid "%d card"\nmsgid_plural "%d cards"\n${msgstr.map((t, i) => `msgstr[${i}] "${t}"`).join("\n")}\n`;
  const refused: string[] = [];
  const write = (lang: string, forms: string, msgstr: string[], text: string) =>
    entriesToGettext(
      pot,
      { "%d card": text },
      po(lang, forms, msgstr),
      { tag: lang, code: lang },
      (id) => refused.push(id),
    );
  expect(write("ja", "nplurals=1; plural=0;", [""], "%d カード")).toBe(
    po("ja", "nplurals=1; plural=0;", ["%d カード"]),
  );
  expect(
    write("ja", "nplurals=2; plural=(n != 1);", ["", ""], "%d カード"),
  ).toBe(po("ja", "nplurals=2; plural=(n != 1);", ["%d カード", "%d カード"]));
  expect(write("de", "nplurals=2; plural=(n != 1);", ["", ""], "Karten")).toBe(
    po("de", "nplurals=2; plural=(n != 1);", ["Karten", "Karten"]),
  );
  // A file whose forms already all hold the text is left as it is.
  const same = po("de", "nplurals=2; plural=(n != 1);", ["Karten", "Karten"]);
  expect(entriesToGettext(pot, { "%d card": "Karten" }, same, DE_LANG)).toBe(
    same,
  );
  // A broken plural, or text beside one, is still refused.
  write(
    "de",
    "nplurals=2; plural=(n != 1);",
    ["", ""],
    "{count, plural, one {x}",
  );
  write(
    "de",
    "nplurals=2; plural=(n != 1);",
    ["", ""],
    "Frei: {count, plural, one {# Karte} other {# Karten}}",
  );
  expect(refused).toEqual(["%d card", "%d card"]);
});

// Transmission's af.po header, as Transifex writes it (#1101).
const AF = `# SOME DESCRIPTIVE TITLE.
# Copyright (C) 2008, 2009 Transmission authors
# This file is distributed under the same license as the PACKAGE package.
# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR.
#
# Translators:
# Pieter Schalk Schoeman <pieter@sonbesie.co.za>, 2022
# Adriaan Joubert, 2023
# Gideon Wentink <gjwentink@gmail.com>, 2017-2019, 2024
#
#, fuzzy
msgid ""
msgstr ""
"Project-Id-Version: PACKAGE VERSION\\n"
"PO-Revision-Date: 2017-01-26 19:47+0000\\n"
"Last-Translator: Gideon Wentink <gjwentink@gmail.com>, 2024\\n"
"Language-Team: Afrikaans (https://app.transifex.com/transmissionbt/teams/33778/af/)\\n"
"Language: af\\n"
"MIME-Version: 1.0\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

# Jan: keep this short
#. TRANSLATORS: the app's name
#: ../cli/cli.cc:94
#, c-format
msgid "Open %s"
msgstr "Open %s"

#
msgid "Quit"
msgstr "Verlaat"
`;

test("a new file started from a target .po keeps none of that target's translators: no credits, translator comments, Last-Translator, Language-Team or revision date (#1101)", () => {
  const out = entriesToGettext(AF, {}, undefined, { tag: "sw", code: "sw" });
  expect(out).toBe(`# SOME DESCRIPTIVE TITLE.
# Copyright (C) 2008, 2009 Transmission authors
# This file is distributed under the same license as the PACKAGE package.
# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR.
#
msgid ""
msgstr ""
"Project-Id-Version: PACKAGE VERSION\\n"
"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\\n"
"Last-Translator: FULL NAME <EMAIL@ADDRESS>\\n"
"Language-Team: LANGUAGE <LL@li.org>\\n"
"Language: sw\\n"
"MIME-Version: 1.0\\n"
"Plural-Forms: nplurals=2; plural=(n==1) ? 0 : 1;\\n"

#. TRANSLATORS: the app's name
#: ../cli/cli.cc:94
#, c-format
msgid "Open %s"
msgstr ""

msgid "Quit"
msgstr ""
`);
  // A file the language has is its own: its translators stay.
  const own = AF.replace('"Language: af\\n"', '"Language: sw\\n"');
  expect(
    entriesToGettext(AF, { Quit: "Acha" }, own, { tag: "sw", code: "sw" }),
  ).toContain("# Jan: keep this short\n");
});

test("a target's credits are dropped in the forms real headers write them: an email alone, dotted or unspaced years, a translator field, names after a credit (#1101)", () => {
  // Joplin's sv.po and hr.po headers, and a ru one.
  const header = `# Swedish translation for Joplin.
# Copyright (C) 2026 Laurent Cozic
# This file is distributed under the same license as the Joplin-CLI package.
# Jonatan Nyberg, 2023, 2024, 2025, 2026.
# Isak Bergdahl
# Daniel Nylander
# Hrvoje Mandić <trbuhom@net.hr>
# Milo Ivir <mail@milotype.de>, 2021., 2022., 2023., 2025.
# Anna Svensson <anna@example.org>, 2019,2020
# e83e85c2c00c9ff2c6ba7eb229e3d1c4_821f2e7 <edba9ab8cdf576ab3824ac292775127d_640234>, 2017
# Gideon van Melle <translations@gvmelle.com>, 2025
# "Chen,Wei-Ting" <benson94879453@gmail.com>, 2026.
# Overloaded @ Orama Interactive http://orama-interactive.com/ <manoschool@yahoo.gr>, 2020, 2022.
# FIRST Translator Ji-Hyeon Gim <potatogim@potatogim.net>, YEAR.
# Björn Ek, 2024-04-01
# Previous-Translator: Титан <fignin@ya.ru>
# Last-Translator: Dmitriy Q <atsip-help@yandex.ru>
# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR.
# SPDX-FileCopyrightText: 2026 summoner <summoner@disroot.org>
#
msgid ""
msgstr ""
"Language: sv\\n"

msgid "Quit"
msgstr "Avsluta"
`;
  expect(
    entriesToGettext(header, {}, undefined, { tag: "da", code: "da" }),
  ).toMatch(
    /^# Swedish translation for Joplin\.\n# Copyright \(C\) 2026 Laurent Cozic\n# This file is distributed under the same license as the Joplin-CLI package\.\n# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR\.\n# SPDX-FileCopyrightText: 2026 summoner <summoner@disroot\.org>\n#\nmsgid ""\n/,
  );
});

test("a target's header comment keeps every line that is no credit: titles and licences with a year, a bug address, a licence's name; a Translators block ends where its credits do (#1101)", () => {
  const start = (comment: string, body = 'msgid "Quit"\nmsgstr "Avsluta"\n') =>
    entriesToGettext(
      `${comment}msgid ""\nmsgstr ""\n"Language: sv\\n"\n\n${body}`,
      {},
      undefined,
      { tag: "da", code: "da" },
    );
  const kept = `# German translation of foo, 2005.
# This file is put in the public domain, 2020.
# Report bugs to <bugs@example.org>
# Jonatan Nyberg, 2023.
# GNU General Public License
`;
  expect(start(kept)).toMatch(
    /^# German translation of foo, 2005\.\n# This file is put in the public domain, 2020\.\n# Report bugs to <bugs@example\.org>\n# GNU General Public License\nmsgid ""\n/,
  );
  // An unclosed block, or one closed by `# `, stops at its credits.
  for (const close of ["", "# \n"])
    expect(
      start(
        `# Translators:\n# Anna Svensson <anna@example.org>, 2019\n${close}# Copyright (C) 2020 Foo\n# This file is distributed under the same license as Foo.\n`,
      ),
    ).toMatch(
      /^# Copyright \(C\) 2020 Foo\n# This file is distributed under the same license as Foo\.\nmsgid ""\n/,
    );
  // A blank line between the header comment and the header.
  expect(
    start("# Title\n# Anna Svensson <anna@example.org>, 2019\n\n"),
  ).toMatch(/^# Title\n\nmsgid ""\n/);
  // A target by its Language alone drops its obsolete entries too.
  expect(
    start(
      "",
      'msgid "Quit"\nmsgstr ""\n\n#~ msgid "Old"\n#~ msgstr "Gammal"\n',
    ),
  ).not.toContain("#~");
});

test("a long header comment line is read in linear time (#1101)", () => {
  for (const line of [
    `# x <${"@".repeat(40_000)}`,
    `# ${"a <".repeat(15_000)}`,
    `# x <${"a@".repeat(20_000)}a`,
    `# Name${", 2020.".repeat(6_000)}x`,
    `# N <a@b>${", 2020".repeat(7_000)}!`,
    `# ${" <a@b>".repeat(7_000)}x`,
  ]) {
    const started = performance.now();
    entriesToGettext(
      `${line}\nmsgid ""\nmsgstr ""\n"Language: sv\\n"\n\nmsgid "Quit"\nmsgstr "Avsluta"\n`,
      {},
      undefined,
      { tag: "da", code: "da" },
    );
    expect(performance.now() - started, line.slice(0, 12)).toBeLessThan(1000);
  }
});

test("a target's licence and links in brackets are kept; a credit is one whatever its name's words; a BOM, a trailing space and a blank line beside credits change nothing (#1101 review)", () => {
  const start = (comment: string, prefix = "") =>
    entriesToGettext(
      `${prefix}${comment}msgid ""\nmsgstr ""\n"Language: sv\\n"\n\nmsgid "Quit"\nmsgstr "Avsluta"\n`,
      {},
      undefined,
      { tag: "da", code: "da" },
    );
  const kept = `# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
# Homepage: <https://foo.org>
# Jonatan Nyberg, 2023.
# Free Software Foundation
`;
  expect(start(kept)).toMatch(
    /^# You should have received a copy of the GNU General Public License\n# along with this program\. {2}If not, see <http:\/\/www\.gnu\.org\/licenses\/>\.\n# Homepage: <https:\/\/foo\.org>\n# Free Software Foundation\nmsgid ""\n/,
  );
  // Names that hold a title's words are names where an address and a
  // year sign them.
  expect(
    start(
      "# Title\n# Friedrich List <fl@example.de>, 2020.\n# Jane Report <jr@example.org>, 2019\n",
    ),
  ).toMatch(/^# Title\nmsgid ""\n/);
  // A copyright line is kept however it is signed; an address's words
  // are its own.
  expect(
    start(
      "# Copyright (C) 2019 Jane Doe <jane@example.org>, 2019.\n# (c) Jane Doe <jane@example.org>, 2019\n# Ivan Petrov <ivan@list.ru>\n",
    ),
  ).toMatch(
    /^# Copyright \(C\) 2019 Jane Doe <jane@example\.org>, 2019\.\n# \(c\) Jane Doe <jane@example\.org>, 2019\nmsgid ""\n/,
  );
  // A BOM, a Translators line with a trailing space, and credits alone
  // above a blank line.
  expect(
    start("# Anna Svensson <anna@example.org>, 2019\n\n", "\uFEFF"),
  ).toMatch(/^\uFEFFmsgid ""\n/);
  expect(
    start(
      "# Title\n# Translators: \n# Anna Svensson <anna@example.org>, 2019\n",
    ),
  ).toMatch(/^# Title\nmsgid ""\n/);
});
