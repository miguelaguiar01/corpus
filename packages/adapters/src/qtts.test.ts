import { expect, test } from "vitest";
import { qtTsToEntries, qtTsTranslations } from "./qtts";

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
