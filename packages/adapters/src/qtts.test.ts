import { expect, test } from "vitest";
import { entriesToQtTs, qtTsToEntries, qtTsTranslations } from "./qtts";

// qBittorrent's shapes: lupdate's template as the source.
const EN = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1">
<context>
    <name>AboutDialog</name>
    <message>
        <location filename="../gui/aboutdialog.ui" line="15"/>
        <source>About qBittorrent</source>
        <translation type="unfinished"></translation>
    </message>
    <message>
        <location filename="../gui/utils.cpp" line="40"/>
        <source>N/A</source>
        <comment>This date is unavailable</comment>
        <translation type="unfinished"></translation>
    </message>
    <message>
        <source>N/A</source>
        <comment>This comment is unavailable</comment>
        <translation type="unfinished"></translation>
    </message>
</context>
<context>
    <name>misc</name>
    <message>
        <location filename="../base/utils/misc.cpp" line="59"/>
        <source>Use &quot;%1&quot;&#xa0;now</source>
        <extracomment>%1 is a program name</extracomment>
        <translation type="unfinished"></translation>
    </message>
    <!-- <message><source>Hidden</source></message> -->
    <message>
        <source>Old text</source>
        <translation type="vanished">Alter Text</translation>
    </message>
</context>
</TS>
`;

const DE = EN.replace('<TS version="2.1">', '<TS version="2.1" language="de">')
  .replace(
    '<source>About qBittorrent</source>\n        <translation type="unfinished"></translation>',
    "<source>About qBittorrent</source>\n        <translation>Über qBittorrent</translation>",
  )
  .replace(
    '<comment>This date is unavailable</comment>\n        <translation type="unfinished"></translation>',
    '<comment>This date is unavailable</comment>\n        <translation type="unfinished">k. A.</translation>',
  )
  .replace(
    '<extracomment>%1 is a program name</extracomment>\n        <translation type="unfinished"></translation>',
    "<extracomment>%1 is a program name</extracomment>\n        <translation>„%1“&#xa0;jetzt nutzen</translation>",
  );

test("a .ts file's messages: Qt's identity, entities decoded, notes, vanished and commented out not read (#740)", () => {
  expect(qtTsToEntries(EN, { type: "ui" })).toEqual([
    {
      id: "AboutDialog | About qBittorrent",
      type: "ui",
      source: "About qBittorrent",
      note: "Used in ../gui/aboutdialog.ui:15",
    },
    {
      id: "AboutDialog | N/A | This date is unavailable",
      type: "ui",
      source: "N/A",
      note: "This date is unavailable\nUsed in ../gui/utils.cpp:40",
    },
    {
      id: "AboutDialog | N/A | This comment is unavailable",
      type: "ui",
      source: "N/A",
      note: "This comment is unavailable",
    },
    {
      id: 'misc | Use "%1" now',
      type: "ui",
      source: 'Use "%1" now',
      note: "%1 is a program name\nUsed in ../base/utils/misc.cpp:59",
    },
  ]);
});

test("a target's translations are its finished ones; unfinished text is work (#740)", () => {
  expect(qtTsTranslations(DE)).toEqual([
    {
      id: "AboutDialog | About qBittorrent",
      type: "",
      source: "Über qBittorrent",
    },
    {
      id: 'misc | Use "%1" now',
      type: "",
      source: "„%1“ jetzt nutzen",
    },
  ]);
});

test("length variants seed the first; single quotes, CRLF, relative locations, empty comments and odd references read as Qt reads them (#740)", () => {
  const xml = `<TS version="2.1" language="de">\r\n<context encoding="UTF-8">\r\n    <name>W</name>\r\n    <message>\r\n        <location filename="w.cpp" line="+5"/>\r\n        <source>Long\r\nline</source>\r\n        <comment></comment>\r\n        <translation variants="yes"><lengthvariant>Lang</lengthvariant><lengthvariant>L</lengthvariant></translation>\r\n    </message>\r\n    <message>\r\n        <source>Draft &#x110000;</source>\r\n        <translation type='unfinished'>Entwurf</translation>\r\n    </message>\r\n</context>\r\n</TS>\r\n`;
  expect(qtTsToEntries(xml, { type: "ui" })).toEqual([
    {
      id: "W | Long\nline",
      type: "ui",
      source: "Long\nline",
      note: "Used in w.cpp",
    },
    { id: "W | Draft &#x110000;", type: "ui", source: "Draft &#x110000;" },
  ]);
  expect(qtTsTranslations(xml)).toEqual([
    { id: "W | Long\nline", type: "", source: "Lang" },
  ]);
});

test("pulling a .ts file's own translations back writes the same bytes (#741)", () => {
  const own = Object.fromEntries(
    qtTsTranslations(DE).map((e) => [e.id, e.source]),
  );
  expect(entriesToQtTs(EN, own, DE, { tag: "de", code: "de" })).toBe(DE);
});

test("a changed translation is spliced alone, unfinished dropped, escaped as the file escapes (#741)", () => {
  const out = entriesToQtTs(
    EN,
    { "AboutDialog | N/A | This date is unavailable": 'Datum „n/a"  ' },
    DE,
    { tag: "de", code: "de" },
  );
  expect(out).toBe(
    DE.replace(
      '<translation type="unfinished">k. A.</translation>',
      "<translation>Datum „n/a&quot; &#xa0;</translation>",
    ),
  );
  // A file that writes its quotes raw keeps them raw.
  const raw = DE.replace(
    "<source>About qBittorrent</source>",
    '<source>About "qBittorrent"</source>',
  ).replace("&quot;%1&quot;", '"%1"');
  const rawOut = entriesToQtTs(
    EN,
    { 'AboutDialog | About "qBittorrent"': 'Über "qBittorrent"' },
    raw,
    { tag: "de", code: "de" },
  );
  expect(rawOut).toContain('<translation>Über "qBittorrent"</translation>');
});

test("a message the file lacks is inserted after its neighbour; a missing file starts from the template (#741)", () => {
  const without = DE.replace(
    /\n {4}<message>\n {8}<location filename="\.\.\/gui\/aboutdialog\.ui" line="15"\/>[\s\S]*?<\/message>/,
    "",
  );
  expect(without).not.toContain("About qBittorrent");
  expect(
    entriesToQtTs(
      EN,
      { "AboutDialog | About qBittorrent": "Über qBittorrent" },
      without,
      { tag: "de", code: "de" },
    ),
  ).toBe(DE);
  const fresh = entriesToQtTs(
    EN,
    { "AboutDialog | About qBittorrent": "Über qBittorrent" },
    undefined,
    { tag: "sr-Latn", code: "sr@latin" },
  );
  expect(fresh).toContain('<TS version="2.1" language="sr@latin">');
  expect(qtTsTranslations(fresh)).toEqual([
    {
      id: "AboutDialog | About qBittorrent",
      type: "",
      source: "Über qBittorrent",
    },
  ]);
  // The template's vanished row stays vanished.
  expect(fresh).toContain(
    '<translation type="vanished">Alter Text</translation>',
  );
});

test("a fresh target empties the template's numerus forms; a vanished message comes back in place; lupdate's references and bytes (#741)", () => {
  const withPlural = EN.replace(
    "</context>\n</TS>",
    `    <message numerus="yes">\n        <source>%n file(s)</source>\n        <translation><numerusform>%n file</numerusform><numerusform>%n files</numerusform></translation>\n    </message>\n</context>\n</TS>`,
  );
  const fresh = entriesToQtTs(withPlural, {}, undefined, {
    tag: "de",
    code: "de",
  });
  expect(fresh).toContain(
    '<translation type="unfinished"><numerusform></numerusform><numerusform></numerusform></translation>',
  );
  // German has the message only as vanished; the source has it again.
  const vanished = DE.replace(
    "<translation>Über qBittorrent</translation>",
    '<translation type="vanished">Über qBittorrent</translation>',
  );
  expect(
    entriesToQtTs(
      EN,
      { "AboutDialog | About qBittorrent": "Über qBittorrent" },
      vanished,
      { tag: "de", code: "de" },
    ),
  ).toBe(DE);
  // An ideographic space as a reference, a control character as <byte>.
  const out = entriesToQtTs(
    EN,
    { "AboutDialog | About qBittorrent": "Über\u3000qBittorrent\u0001" },
    DE,
    { tag: "de", code: "de" },
  );
  expect(out).toContain(
    '<translation>Über&#x3000;qBittorrent<byte value="x1"/></translation>',
  );
  expect(
    qtTsTranslations(out).find(
      (e) => e.id === "AboutDialog | About qBittorrent",
    )?.source,
  ).toBe("Über\u3000qBittorrent\u0001");
});

// lupdate's numerus layout: a form a line.
const numerus = (language: string, forms: string[], state = "") =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1"${language ? ` language="${language}"` : ""}>
<context>
    <name>Main</name>
    <message numerus="yes">
        <source>%n file(s)</source>
        <translation${state}>
${forms.map((f) => `            <numerusform>${f}</numerusform>`).join("\n")}
        </translation>
    </message>
</context>
</TS>
`;

test("numerus forms read as one plural on count through Qt's rules, and write back in its order (#743)", () => {
  const template = numerus("", ["", ""], ' type="unfinished"');
  expect(qtTsToEntries(template, { type: "ui" })[0]?.source).toBe(
    "{count, plural, other {%n file(s)}}",
  );
  const pl = numerus("pl", ["%n plik", "%n pliki", "%n plików"]);
  const read = qtTsTranslations(pl, "pl")[0]!.source;
  expect(read).toBe(
    "{count, plural, one {%n plik} few {%n pliki} many {%n plików} other {%n plików}}",
  );
  const PL = { tag: "pl", code: "pl" };
  expect(entriesToQtTs(template, { "Main | %n file(s)": read }, pl, PL)).toBe(
    pl,
  );
  // French counts 0 and 1 as the singular: two forms, where CLDR has three.
  const fr = numerus("fr", ["%n fichier", "%n fichiers"]);
  const frRead = qtTsTranslations(fr, "fr")[0]!.source;
  expect(frRead).toBe(
    "{count, plural, one {%n fichier} many {%n fichiers} other {%n fichiers}}",
  );
  expect(
    entriesToQtTs(template, { "Main | %n file(s)": frRead }, fr, {
      tag: "fr",
      code: "fr",
    }),
  ).toBe(fr);
  // A new Russian plural lands as three forms, in lupdate's layout.
  expect(
    entriesToQtTs(
      template,
      {
        "Main | %n file(s)":
          "{count, plural, one {%n файл} few {%n файла} many {%n файлов} other {%n файла}}",
      },
      undefined,
      { tag: "ru", code: "ru" },
    ),
  ).toBe(numerus("ru", ["%n файл", "%n файла", "%n файлов"]));
  // A plain text for a numerus message is refused.
  const refused: string[] = [];
  expect(
    entriesToQtTs(template, { "Main | %n file(s)": "plik" }, pl, PL, (id) =>
      refused.push(id),
    ),
  ).toBe(pl);
  expect(refused).toEqual(["Main | %n file(s)"]);
  // A template's self-closing plural translation starts empty.
  const closed = template.replace(
    /<translation type="unfinished">[\s\S]*?<\/translation>/,
    "<translation/>",
  );
  expect(entriesToQtTs(closed, {}, undefined, PL)).toContain(
    '<translation type="unfinished"></translation>',
  );
});

test("Qt's own counts: Macedonian by n%10, one form where Qt has no rule, older codes; no form ships empty; length variants kept (#743)", () => {
  const template = numerus("", ["", ""], ' type="unfinished"');
  const id = "Main | %n file(s)";
  // Macedonian's singular is read and written.
  const mk = numerus("mk", ["%n датотека", "%n датотеки", "%n датотеки"]);
  expect(qtTsTranslations(mk, "mk")[0]!.source).toMatch(/one \{%n датотека\}/);
  // Asturian has no Qt rule: one form, kept on a pull of its own.
  const ast = numerus("ast", ["%n ficheros"]);
  const AST = { tag: "ast", code: "ast" };
  expect(
    entriesToQtTs(
      template,
      { [id]: qtTsTranslations(ast, "ast")[0]!.source },
      ast,
      AST,
    ),
  ).toBe(ast);
  // iw is Hebrew to Qt: two forms.
  const iw = numerus("iw", ["%n קובץ", "%n קבצים"]);
  expect(
    entriesToQtTs(
      template,
      { [id]: qtTsTranslations(iw, "iw")[0]!.source },
      iw,
      {
        tag: "iw",
        code: "iw",
      },
    ),
  ).toBe(iw);
  // A fresh Latvian file: the zero form takes other's text, not nothing.
  const lv = entriesToQtTs(
    template,
    {
      [id]: "{count, plural, zero {%n failu} one {%n fails} other {%n faili}}",
    },
    undefined,
    { tag: "lv", code: "lv" },
  );
  expect(lv).not.toContain("<numerusform></numerusform>");
  // A file that leaves that form empty is left as it is on a pull of
  // its own translations.
  const lvFile = numerus("lv", ["%n fails", "%n faili", ""]);
  expect(
    entriesToQtTs(
      template,
      { [id]: qtTsTranslations(lvFile, "lv")[0]!.source },
      lvFile,
      { tag: "lv", code: "lv" },
    ),
  ).toBe(lvFile);
  // A form with length variants, left as it was, keeps them.
  const pl = numerus("pl", [
    "<lengthvariant>%n plik</lengthvariant><lengthvariant>%n p.</lengthvariant>",
    "%n pliki",
    "%n plików",
  ]);
  const changed = entriesToQtTs(
    template,
    {
      [id]: "{count, plural, one {%n plik} few {%n pliki!} many {%n plików} other {%n plików}}",
    },
    pl,
    { tag: "pl", code: "pl" },
  );
  expect(changed).toContain(
    '<numerusform variants="yes"><lengthvariant>%n plik</lengthvariant><lengthvariant>%n p.</lengthvariant></numerusform>',
  );
  expect(changed).toContain("<numerusform>%n pliki!</numerusform>");
});

test("a qsTrId message is keyed by its id, which a changed source keeps, and pull writes it back by that id (#745)", () => {
  const template = (source: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1">
<context>
    <name></name>
    <message id="msg.hello">
        <source>${source}</source>
        <translation type="unfinished"></translation>
    </message>
</context>
<context>
    <name>Main</name>
    <message>
        <source>Quit</source>
        <translation type="unfinished"></translation>
    </message>
</context>
</TS>
`;
  expect(
    qtTsToEntries(template("Hello"), { type: "ui" }).map((e) => e.id),
  ).toEqual(["msg.hello", "Main | Quit"]);
  expect(qtTsToEntries(template("Hi there"), { type: "ui" })[0]!.id).toBe(
    "msg.hello",
  );
  const de = template("Hello")
    .replace(
      '<source>Hello</source>\n        <translation type="unfinished"></translation>',
      "<source>Hello</source>\n        <translation>Hallo</translation>",
    )
    .replace(
      '<source>Quit</source>\n        <translation type="unfinished"></translation>',
      "<source>Quit</source>\n        <translation>Beenden</translation>",
    );
  expect(qtTsTranslations(de, "de")).toEqual([
    { id: "msg.hello", type: "", source: "Hallo" },
    { id: "Main | Quit", type: "", source: "Beenden" },
  ]);
  const language = { tag: "de", code: "de" };
  // A no-op pull writes the same bytes; a changed one lands in its message.
  expect(
    entriesToQtTs(
      template("Hello"),
      { "msg.hello": "Hallo", "Main | Quit": "Beenden" },
      de,
      language,
    ),
  ).toBe(de);
  expect(
    entriesToQtTs(template("Hello"), { "msg.hello": "Servus" }, de, language),
  ).toBe(
    de.replace(
      "<translation>Hallo</translation>",
      "<translation>Servus</translation>",
    ),
  );
});

test("pull escapes as lupdate's tsProtect() does, character by character, in either file style (#747)", () => {
  // Qt's linguist/shared/ts.cpp tsProtect(): the five XML entities; below
  // 0x20 but tab and newline, <byte>; a space above 0x7f, a reference;
  // anything else, U+007F included, as it is. A raw-quote file keeps
  // quotes and spaces raw but may not hold a control character.
  const file = (sample: string) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1" language="de">
<context>
    <name>W</name>
    <message>
        <source>Sample</source>
        <translation>${sample}</translation>
    </message>
    <message>
        <source>Text</source>
        <translation>Alt</translation>
    </message>
</context>
</TS>
`;
  const written = (style: string, text: string) => {
    const out = entriesToQtTs(file(style), { "W | Text": text }, file(style), {
      tag: "de",
      code: "de",
    });
    return /<source>Text<\/source>\s*<translation>([\s\S]*?)<\/translation>/.exec(
      out,
    )![1]!;
  };
  const table: [string, string, string][] = [
    // [character, as lupdate writes it, in a raw-quote file]
    ["\u0001", '<byte value="x1"/>', '<byte value="x1"/>'],
    ["\u001b", '<byte value="x1b"/>', '<byte value="x1b"/>'],
    ["a\rb", 'a<byte value="xd"/>b', 'a<byte value="xd"/>b'],
    ["\u007f", "\u007f", "\u007f"],
    ["\u0085", "&#x85;", "\u0085"],
    [" ", "&#xa0;", " "],
    [" ", "&#x2028;", " "],
    [" ", "&#x2029;", " "],
    ["　", "&#x3000;", "　"],
    ['"', "&quot;", '"'],
    ["a\tb\nc", "a\tb\nc", "a\tb\nc"],
    ["a\r\nb", 'a<byte value="xd"/>\nb', 'a<byte value="xd"/>\nb'],
  ];
  for (const [character, entities, raw] of table) {
    expect(written("&quot;x&quot;", character)).toBe(entities);
    expect(written('"x"', character)).toBe(raw);
  }
  // What is written reads back as the text.
  const back = entriesToQtTs(
    file("&quot;x&quot;"),
    { "W | Text": "\u0085\u2028\u0001a\r\nb" },
    file("&quot;x&quot;"),
    { tag: "de", code: "de" },
  );
  expect(qtTsTranslations(back).find((e) => e.id === "W | Text")?.source).toBe(
    "\u0085\u2028\u0001a\r\nb",
  );
});

test("a missing message goes in after a vanished one the template has again, so the file keeps the template's order (#776)", () => {
  const message = (source: string, translation: string) => `
    <message>
        <source>${source}</source>
        ${translation}
    </message>`;
  const ts = (language: string, body: string) =>
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1"${language}>
<context>
    <name>W</name>${body}
</context>
</TS>
`;
  const template = ts(
    "",
    ["A", "B", "C"]
      .map((s) => message(s, '<translation type="unfinished"></translation>'))
      .join(""),
  );
  const de = ts(
    ' language="de"',
    message("A", "<translation>Ah</translation>") +
      message("B", '<translation type="vanished">Beh</translation>'),
  );
  const out = entriesToQtTs(template, { "W | B": "Be", "W | C": "Ce" }, de, {
    tag: "de",
    code: "de",
  });
  expect(qtTsTranslations(out).map((e) => e.id)).toEqual([
    "W | A",
    "W | B",
    "W | C",
  ]);
  expect(out.indexOf("<source>B</source>")).toBeLessThan(
    out.indexOf("<source>C</source>"),
  );
});

test("a vanished id message in another context is no anchor for a missing message (#776)", () => {
  const template = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1">
<context>
    <name>New</name>
    <message id="x.id">
        <source>X</source>
        <translation type="unfinished"></translation>
    </message>
    <message>
        <source>Y</source>
        <translation type="unfinished"></translation>
    </message>
</context>
</TS>
`;
  const de = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1" language="de">
<context>
    <name>Old</name>
    <message id="x.id">
        <source>X</source>
        <translation type="vanished">Iks</translation>
    </message>
</context>
<context>
    <name>New</name>
</context>
</TS>
`;
  const out = entriesToQtTs(template, { "New | Y": "Ypsilon" }, de, {
    tag: "de",
    code: "de",
  });
  expect(qtTsTranslations(out, "de").map((e) => e.id)).toEqual(["New | Y"]);
  expect(out.indexOf("Ypsilon")).toBeGreaterThan(
    out.indexOf("<name>New</name>"),
  );
});

test("a numerus translation no plural holds is work, named once, and a pull leaves it as the file has it (#751)", () => {
  const de = numerus("de", ["%n Datei", "%n {x"]);
  const unread: string[] = [];
  expect(qtTsTranslations(de, "de", (id) => unread.push(id))).toEqual([]);
  expect(unread).toEqual(["Main | %n file(s)"]);
  // Corpus holds nothing for it, so a pull writes nothing there.
  expect(
    entriesToQtTs(numerus("", ["", ""], ' type="unfinished"'), {}, de, {
      tag: "de",
      code: "de",
    }),
  ).toBe(de);
});

test("a numerus form that reads as a branch of its own is work too, so a pull never rewrites it (#751)", () => {
  const de = numerus("de", ["%n Datei} other {%n x", "%n Dateien"]);
  const unread: string[] = [];
  expect(qtTsTranslations(de, "de", (id) => unread.push(id))).toEqual([]);
  expect(unread).toEqual(["Main | %n file(s)"]);
  // Readable forms still read, and pull their own text back unchanged.
  const ok = numerus("de", ["%n Datei", "%n Dateien"]);
  const read = qtTsTranslations(ok, "de");
  expect(read).toHaveLength(1);
  expect(
    entriesToQtTs(
      numerus("", ["", ""], ' type="unfinished"'),
      { "Main | %n file(s)": read[0]!.source },
      ok,
      { tag: "de", code: "de" },
    ),
  ).toBe(ok);
});
