import { expect, test } from "vitest";
import {
  CONTEXT_SEPARATOR,
  gettextToEntries,
  gettextTranslations,
  parsePo,
  pluralIndexCategories,
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
  expect(
    pluralIndexCategories(
      "ru",
      "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
    ),
  ).toEqual(["one", "few", "many"]);
  expect(gettextTranslations(RU, "ru")).toEqual([
    {
      id: "%d note",
      type: "",
      source:
        "{count, plural, one {%d заметка} few {%d заметки} many {%d заметок} other {%d заметок}}",
    },
  ]);
});

test("an expression that is not arithmetic is not run (#718)", () => {
  expect(
    pluralIndexCategories("de", "nplurals=2; plural=process.exit(1);"),
  ).toEqual(["one", "other"]);
});
