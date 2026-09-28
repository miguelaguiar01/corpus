import { expect, test } from "vitest";
import {
  CONTEXT_SEPARATOR,
  gettextToEntries,
  gettextTranslations,
  parsePo,
  pluralCategoryIndexes,
} from "./gettext";

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
    ...pluralCategoryIndexes(
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
  expect([
    ...pluralCategoryIndexes("de", "nplurals=2; plural=process.exit(1);"),
  ]).toEqual([
    ["one", 0],
    ["other", 1],
  ]);
  expect([...pluralCategoryIndexes("de", "nplurals=2; plural=n+5;")]).toEqual([
    ["one", 0],
    ["other", 1],
  ]);
});

test("a category gettext cannot name reads the form its integers take, or other's (#718)", () => {
  // French many is a million: the expression gives it index 1.
  const fr = `msgid ""\nmsgstr ""\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\nmsgid "%d note"\nmsgid_plural "%d notes"\nmsgstr[0] "%d note"\nmsgstr[1] "%d notes"\n`;
  expect(gettextTranslations(fr, "fr")[0]?.source).toBe(
    "{count, plural, one {%d note} many {%d notes} other {%d notes}}",
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
