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
      // Its file holds it as forms (#704).
      pluralAsForms: true,
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
  // `-r` takes a two-letter region only; aapt2 reads 419 as b+ (#993).
  expect(androidDirOf("es-419")).toBe("values-b+es+419");
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

test("an escaped &lt;…&gt; or a CDATA <…> is text, its aapt escapes undone; a pull writes a prose tag escaped, a pair as the file writes it (#987)", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="unknown_recipient">&lt;Unknown Recipient&gt;</string>
    <string name="no_name">"Using key: <![CDATA[<no name>]]>"</string>
    <string name="more">&lt;Xliff id=\\"m\\"&gt;%d&lt;/Xliff&gt;</string>
    <string name="bold">&lt;b>Bold&lt;/b> text</string>
    <string name="raw"><b>Raw</b> text</string>
</resources>
`;
  const read = Object.fromEntries(
    androidToEntries(xml, { type: "ui" }).map((e) => [e.id, e.source]),
  );
  expect(read).toMatchObject({
    unknown_recipient: "<Unknown Recipient>",
    no_name: "Using key: <no name>",
    more: '<Xliff id="m">%d</Xliff>',
    bold: "<b>Bold</b> text",
    raw: "<b>Raw</b> text",
  });
  // Its own texts back: the same bytes.
  expect(entriesToAndroid(xml, read, xml)).toBe(xml);
  const out = entriesToAndroid(
    xml,
    {
      unknown_recipient: "<Destinataire inconnu>",
      bold: "<b>Gras</b> texte",
      raw: "<b>Brut</b> texte",
      added: "<b>Nouveau</b> et <sans titre>",
    },
    xml,
  );
  expect(out).toContain(
    '<string name="unknown_recipient">&lt;Destinataire inconnu&gt;</string>',
  );
  expect(out).toContain('<string name="bold">&lt;b>Gras&lt;/b> texte</string>');
  expect(out).toContain('<string name="raw"><b>Brut</b> texte</string>');
  expect(out).toContain(
    '<string name="added"><b>Nouveau</b> et &lt;sans titre&gt;</string>',
  );
  // A target file with none of them takes each tag as the source writes it.
  const target = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n`;
  expect(entriesToAndroid(xml, { bold: "<b>Gras</b>" }, target)).toContain(
    '<string name="bold">&lt;b>Gras&lt;/b></string>',
  );
});

test("a pull writes a tag XML cannot hold as an element escaped, and a prose tag's verb counts in its place (#987 review)", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="a">x</string>\n</resources>\n`;
  const out = entriesToAndroid(
    xml,
    {
      a: "a<br>b",
      b: "<fichier.ext> ok",
      c: '<xliff:g id="n">%d</xliff:g> left <b>bold',
    },
    xml,
  );
  expect(out).toContain('<string name="a">a&lt;br&gt;b</string>');
  expect(out).toContain('<string name="b">&lt;fichier.ext&gt; ok</string>');
  expect(out).toContain(
    '<string name="c"><xliff:g id="n">%d</xliff:g> left &lt;b&gt;bold</string>',
  );
  expect(
    applyAndroidOps(xml, [{ kind: "add", id: "d", text: "a<br>b" }]),
  ).toContain('<string name="d">a&lt;br&gt;b</string>');
});

test("a values directory's language is androidDirOf's inverse, a non-language qualifier none (#993)", async () => {
  const { androidLanguageOf, androidDirOf } = await import("./android");
  for (const tag of [
    "de",
    "pt-BR",
    "es-419",
    "sr-Latn",
    "zh-Hant-TW",
    "iw",
    // A variant is lower-case, as BCP 47 writes it (#1120).
    "ca-valencia",
    "ca-ES-valencia",
    "de-1996",
  ])
    expect(androidLanguageOf(androidDirOf(tag))).toBe(tag);
  expect(androidLanguageOf("values-b+ca+valencia")).toBe("ca-valencia");
  expect(androidLanguageOf("values-b+ca+ES+VALENCIA")).toBe("ca-ES-valencia");
  expect(androidLanguageOf("values-b+de+1996")).toBe("de-1996");
  // A numeric region has no -r form: aapt2 takes it as b+ only.
  expect(androidDirOf("es-419")).toBe("values-b+es+419");
  // Car is Android Automotive's UI mode, never a language.
  expect(androidLanguageOf("values-car")).toBeUndefined();
  // Another case or the b+ form of a -r region still names the
  // language, which init compares with androidDirOf's directory.
  expect(androidLanguageOf("values-EN")).toBe("en");
  expect(androidLanguageOf("values-b+pt+BR")).toBe("pt-BR");
  expect(androidLanguageOf("values-b+sr+latn")).toBe("sr-Latn");
  for (const dir of [
    "values",
    "values-sw360dp",
    "values-night",
    "values-v21",
    "values-land",
    "values-pt-rBR-night",
  ])
    expect(androidLanguageOf(dir)).toBeUndefined();
});

test("a plural with a key no quantity names (=N) is refused by name and leaves the file as it is; a new file omits it (#1055)", () => {
  const exact =
    "{quantity, plural, =0 {keine} one {%d Folge} other {%d Folgen}}";
  const refused: [string, string][] = [];
  const out = entriesToAndroid(
    SOURCE,
    { episodes: exact, login_status: "Angemeldet als %1$s auf %2$s." },
    TARGET,
    (id, text) => refused.push([id, text]),
  );
  expect(refused).toEqual([["episodes", exact]]);
  expect(out).toBe(
    TARGET.replace(
      /(?<=<!\[CDATA\[)[^\]]*/,
      () => "Angemeldet als %1$s auf %2$s.",
    ),
  );
  // A key that is no category at all is refused too.
  const odd = "{quantity, plural, one {%d Folge} some {%d} other {%d Folgen}}";
  const again: string[] = [];
  expect(
    entriesToAndroid(SOURCE, { episodes: odd }, TARGET, (id) => again.push(id)),
  ).toBe(TARGET);
  expect(again).toEqual(["episodes"]);
  // A new file omits the key and writes the rest.
  const fresh: string[] = [];
  expect(
    entriesToAndroid(
      SOURCE,
      { episodes: exact, quoted: "Zwei" },
      undefined,
      (id) => fresh.push(id),
    ),
  ).toBe(`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="quoted">Zwei</string>
</resources>
`);
  expect(fresh).toEqual(["episodes"]);
  // A plural of categories only, one the language may not use included,
  // is patched item by item.
  const none: string[] = [];
  expect(
    entriesToAndroid(
      SOURCE,
      {
        episodes:
          "{quantity, plural, one {%d rann} few {%d rann} other {%d rannoù}}",
      },
      TARGET,
      (id) => none.push(id),
    ),
  ).toBe(
    TARGET.replace(
      `        <item quantity="other">%d rann</item>`,
      `        <item quantity="few">%d rann</item>\n        <item quantity="other">%d rannoù</item>`,
    ),
  );
  expect(none).toEqual([]);
});

test("a proposal of a plural with an =N branch throws, as the messages adapter's does (#1055)", () => {
  expect(() =>
    applyAndroidOps(SOURCE, [
      {
        kind: "edit",
        id: "episodes",
        text: "{quantity, plural, =0 {no episodes} one {%d episode} other {%d episodes}}",
      },
    ]),
  ).toThrow(
    "android: episodes is a plural a <plurals> cannot hold (an =N branch, or a key that is no plural category)",
  );
  expect(() =>
    applyAndroidOps(SOURCE, [
      {
        kind: "add",
        id: "seasons",
        text: "{quantity, plural, =1 {one season} other {%d seasons}}",
      },
    ]),
  ).toThrow("android: seasons is a plural a <plurals> cannot hold");
});

test("a plural the file already holds is never refused, though an item's literal braces read as a key (#1055 review)", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <plurals name="more">
        <item quantity="one">x</item>
        <item quantity="other">%d episodes } or {n} more</item>
    </plurals>
</resources>
`;
  const [entry] = androidToEntries(xml, { type: "ui" });
  const refused: string[] = [];
  expect(
    entriesToAndroid(xml, { more: entry!.source }, xml, (id) =>
      refused.push(id),
    ),
  ).toBe(xml);
  expect(refused).toEqual([]);
});
