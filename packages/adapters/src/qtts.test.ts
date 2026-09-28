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
