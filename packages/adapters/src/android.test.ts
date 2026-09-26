import { expect, test } from "vitest";
import {
  androidDirOf,
  androidToEntries,
  applyAndroidOps,
  entriesToAndroid,
} from "./android";

const SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<resources
    xmlns:tools="http://schemas.android.com/tools">

    <!-- <string name="commented">Not a string</string> -->
    <string name="app_id" translatable="false">de.danoeh.antennapod</string>
    <string name="login_status">Logged in as %1$s on %2$s.\\n\\nYou can\\'t &amp; won\\'t.</string>
    <string name="quoted">"  Two  spaces  "</string>
    <plurals name="episodes">
        <item quantity="one">%d episode</item>
        <item quantity="other">%d episodes</item>
    </plurals>
    <string name="empty"/>
</resources>
`;

const TARGET = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="login_status"><![CDATA[Kevreet evel <i>%1$s</i> war %2$s.<br/><br/>N\\'hallit ket.]]></string>
    <plurals name="episodes">
        <item quantity="one">%d rann</item>
        <item quantity="other">%d rann</item>
    </plurals>
</resources>
`;

test("strings and plurals read as the editor shows them: escapes and entities undone, a plural as ICU on quantity, untranslatable and commented-out strings skipped (#596)", () => {
  expect(androidToEntries(SOURCE, { type: "ui" })).toEqual([
    {
      id: "login_status",
      type: "ui",
      source: "Logged in as %1$s on %2$s.\n\nYou can't & won't.",
    },
    { id: "quoted", type: "ui", source: "  Two  spaces  " },
    {
      id: "episodes",
      type: "ui",
      source: "{quantity, plural, one {%d episode} other {%d episodes}}",
    },
    { id: "empty", type: "ui", source: "" },
  ]);
  // aapt undoes the escapes inside CDATA too.
  expect(androidToEntries(TARGET, { type: "ui" })[0]?.source).toBe(
    "Kevreet evel <i>%1$s</i> war %2$s.<br/><br/>N'hallit ket.",
  );
});

test("a pull that changes nothing is byte-identical; a changed string and a changed plural are rewritten in place, in the file's style", () => {
  const same = {
    login_status: "Kevreet evel <i>%1$s</i> war %2$s.<br/><br/>N'hallit ket.",
    episodes: "{quantity, plural, one {%d rann} other {%d rann}}",
  };
  expect(entriesToAndroid(SOURCE, same, TARGET)).toBe(TARGET);
  const changed = entriesToAndroid(
    SOURCE,
    {
      ...same,
      episodes:
        "{quantity, plural, one {%d rann} two {%d rann} other {%d rann}}",
    },
    TARGET,
  );
  expect(changed).toBe(
    TARGET.replace(
      '        <item quantity="other">',
      '        <item quantity="two">%d rann</item>\n        <item quantity="other">',
    ),
  );
  const cdata = entriesToAndroid(
    SOURCE,
    { ...same, login_status: "<i>%1$s</i> war %2$s" },
    TARGET,
  );
  expect(cdata).toContain(
    '<string name="login_status"><![CDATA[<i>%1$s</i> war %2$s]]></string>',
  );
});

test("a new string is escaped and appended before </resources>; a new plural as a <plurals> block; a missing file starts from a bare resources element", () => {
  const out = entriesToAndroid(
    SOURCE,
    {
      login_status:
        'Connecté en tant que %1$s sur %2$s.\nC\'est "ça" & <b>plus</b> @',
      episodes: "{quantity, plural, one {%d épisode} other {%d épisodes}}",
    },
    undefined,
  );
  expect(out).toBe(`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="login_status">Connecté en tant que %1$s sur %2$s.\\nC\\'est \\"ça\\" &amp; <b>plus</b> @</string>
    <plurals name="episodes">
        <item quantity="one">%d épisode</item>
        <item quantity="other">%d épisodes</item>
    </plurals>
</resources>
`);
  expect(entriesToAndroid(SOURCE, { quoted: "@ first" }, undefined)).toContain(
    '<string name="quoted">\\@ first</string>',
  );
  expect(entriesToAndroid(SOURCE, { quoted: "a < b" }, undefined)).toContain(
    '<string name="quoted">a &lt; b</string>',
  );
});

test("proposal ops edit, add and remove a string in the source file", () => {
  const out = applyAndroidOps(SOURCE, [
    { kind: "edit", id: "quoted", text: "Plain" },
    { kind: "add", id: "added", text: "New one" },
    { kind: "delete", id: "empty" },
  ]);
  expect(out).toContain('<string name="quoted">Plain</string>');
  expect(out).toContain(
    '    <string name="added">New one</string>\n</resources>',
  );
  expect(out).not.toContain('name="empty"');
  expect(out).toContain('<!-- <string name="commented">');
});

test("a language's values directory by Android's rule", () => {
  expect(androidDirOf("de")).toBe("values-de");
  expect(androidDirOf("pt-BR")).toBe("values-pt-rBR");
  expect(androidDirOf("pt_BR")).toBe("values-pt-rBR");
  expect(androidDirOf("es-419")).toBe("values-es-r419");
  expect(androidDirOf("sr-Latn")).toBe("values-b+sr+Latn");
});

test("markup with attributes reads and writes verbatim; only the text between tags is escaped (#632 review)", () => {
  const xml = `<resources>\n    <string name="a">Hi <xliff:g id="name">%1$s</xliff:g>, <a href='https://x.org/?a=1&amp;b=2'>docs</a></string>\n</resources>\n`;
  const [entry] = androidToEntries(xml, { type: "ui" });
  expect(entry?.source).toBe(
    `Hi <xliff:g id="name">%1$s</xliff:g>, <a href='https://x.org/?a=1&b=2'>docs</a>`,
  );
  const edited = entriesToAndroid(
    xml,
    { a: `Olá <xliff:g id="name">%1$s</xliff:g>, it's "a<b"` },
    xml,
  );
  expect(
    entriesToAndroid(
      xml,
      { a: `Ver <a href='https://x.org/?a=1&b=2'>docs</a>` },
      xml,
    ),
  ).toContain(`<a href='https://x.org/?a=1&amp;b=2'>docs</a>`);
  expect(edited).toContain(
    `<string name="a">Olá <xliff:g id="name">%1$s</xliff:g>, it\\'s \\"a&lt;b\\"</string>`,
  );
});

test("non-ASCII spaces are text, not whitespace aapt collapses", () => {
  const xml = `<resources>\n    <string name="a">Prix\u00a0: 5\u3000円</string>\n</resources>\n`;
  expect(androidToEntries(xml, { type: "ui" })[0]?.source).toBe(
    "Prix\u00a0: 5\u3000円",
  );
});

test("a product variant is left alone; the default is the string", () => {
  const xml = `<resources>\n    <string name="a">Phone</string>\n    <string name="a" product="tablet">Tablet</string>\n</resources>\n`;
  expect(androidToEntries(xml, { type: "ui" })).toEqual([
    { id: "a", type: "ui", source: "Phone" },
  ]);
  expect(entriesToAndroid(xml, { a: "Telemóvel" }, xml)).toBe(
    xml.replace(">Phone<", ">Telemóvel<"),
  );
});

test("an empty self-closed string stays as it is, and filled keeps its attributes", () => {
  const xml = `<resources>\n    <string name="a" tools:ignore="X"/>\n</resources>\n`;
  expect(entriesToAndroid(xml, { a: "" }, xml)).toBe(xml);
  expect(entriesToAndroid(xml, { a: "Olá" }, xml)).toContain(
    `<string name="a" tools:ignore="X">Olá</string>`,
  );
});

test("a changed plural item is edited where it is; comments and order between items stay", () => {
  const xml = `<resources>\n    <plurals name="p">\n        <!-- singular -->\n        <item quantity="one">%d rann</item>\n        <item quantity="other">%d rann</item>\n    </plurals>\n</resources>\n`;
  expect(
    entriesToAndroid(
      xml,
      { p: "{quantity, plural, one {%d rann} few {%d rann} other {%d ranno}}" },
      xml,
    ),
  ).toBe(
    xml
      .replace(
        '<item quantity="one">%d rann</item>',
        '<item quantity="one">%d rann</item>\n        <item quantity="few">%d rann</item>',
      )
      .replace(
        ">%d rann</item>\n    </plurals>",
        ">%d ranno</item>\n    </plurals>",
      ),
  );
});

test("a new string's kind is the source's; references and out-of-range entities are safe", () => {
  const source = `<resources>\n    <string name="s">{quantity, plural, one {x} other {y}}</string>\n    <string name="ref">@string/s</string>\n    <string name="e">A&#9999999;</string>\n</resources>\n`;
  expect(androidToEntries(source, { type: "ui" }).map((e) => e.id)).toEqual([
    "s",
    "e",
  ]);
  expect(androidToEntries(source, { type: "ui" })[1]?.source).toBe(
    "A&#9999999;",
  );
  expect(
    entriesToAndroid(
      source,
      { s: "{quantity, plural, one {x} other {y}}" },
      undefined,
    ),
  ).toContain('<string name="s">');
});

test("an unchanged pull of a large file is linear", () => {
  const n = 6000;
  const lines = Array.from(
    { length: n },
    (_, i) => `    <string name="k${i}">Text ${i}</string>`,
  );
  const xml = `<resources>\n${lines.join("\n")}\n</resources>\n`;
  const same = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`k${i}`, `Text ${i}`]),
  );
  const started = Date.now();
  expect(entriesToAndroid(xml, same, xml)).toBe(xml);
  expect(entriesToAndroid(xml, same, undefined)).toBe(
    xml.replace(
      "<resources>",
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>',
    ),
  );
  expect(Date.now() - started).toBeLessThan(2000);
});
