import { describe, expect, test } from "vitest";
import {
  applyXliffOps,
  entriesToXliff,
  xliffToEntries,
  xliffTranslations,
  xliffUnits,
} from "./xliff";

// Angular's `ng extract-i18n` output, as Ghostfolio keeps it.
const SOURCE_12 = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="signIn" datatype="html">
        <source>Sign in with <x id="START_LINK" ctype="x-a" equiv-text="&lt;a&gt;"/>Google<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/></source>
        <context-group purpose="location">
          <context context-type="sourcefile">apps/client/src/login.html</context>
        </context-group>
        <note priority="1" from="description">The sign-in button</note>
      </trans-unit>
      <trans-unit id="holdings" datatype="html">
        <source>{VAR_PLURAL, plural, =1 {1 holding} other {<x id="INTERPOLATION" equiv-text="{{ count }}"/> holdings}}</source>
      </trans-unit>
      <trans-unit id="amp" datatype="html">
        <source>Fees &amp; taxes</source>
      </trans-unit>
    </body>
  </file>
</xliff>
`;

const TARGET_12 = SOURCE_12.replace(
  'source-language="en"',
  'source-language="en" target-language="de"',
)
  .replace(
    'Google<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/></source>',
    `Google<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/></source>
        <target state="translated">Mit <x id="START_LINK" ctype="x-a" equiv-text="&lt;a&gt;"/>Google<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/> anmelden</target>`,
  )
  .replace(
    "holdings}}</source>",
    `holdings}}</source>
        <target state="new">{VAR_PLURAL, plural, =1 {1 holding} other {<x id="INTERPOLATION" equiv-text="{{ count }}"/> holdings}}</target>`,
  )
  .replace(
    "Fees &amp; taxes</source>",
    `Fees &amp; taxes</source>
        <target state="final">Fees &amp; taxes</target>`,
  );

test("an XLIFF 1.2 source's units are strings, inline elements placeholders and tags (#710)", () => {
  expect(xliffToEntries(SOURCE_12, { type: "ui" })).toEqual([
    {
      id: "signIn",
      type: "ui",
      source: "Sign in with <LINK>Google</LINK>",
      note: "The sign-in button\nUsed in apps/client/src/login.html",
    },
    {
      id: "holdings",
      type: "ui",
      source:
        "{VAR_PLURAL, plural, =1 {1 holding} other {{INTERPOLATION} holdings}}",
      examples: [
        {
          values: { INTERPOLATION: "{{ count }}" },
          rendered: "{{ count }} holdings",
        },
      ],
    },
    { id: "amp", type: "ui", source: "Fees & taxes" },
  ]);
});

test("a target file's translations are the targets someone wrote; `new` is work (#710)", () => {
  expect(xliffTranslations(TARGET_12)).toEqual([
    { id: "signIn", type: "", source: "Mit <LINK>Google</LINK> anmelden" },
    { id: "amp", type: "", source: "Fees & taxes" },
  ]);
});

test("a reversed START/CLOSE pair reads as a close before its open, which does not parse", () => {
  const reversed = `<xliff version="1.2"><file><body><trans-unit id="a"><source>x</source>
    <target state="translated"><x id="CLOSE_LINK"/>Google<x id="START_LINK"/></target></trans-unit></body></file></xliff>`;
  expect(xliffUnits(reversed)[0]?.target).toBe("</LINK>Google<LINK>");
});

test("XLIFF 2.0 units read the same, <ph> and <pc> as placeholder and tag (#710)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="en" trgLang="fr">
  <file id="ngi18n" original="ng.template">
    <unit id="welcome">
      <notes>
        <note category="description">Greeting</note>
        <note category="meaning">home</note>
      </notes>
      <segment state="translated">
        <source>Hello <ph id="0" equiv="INTERPOLATION" disp="{{ name }}"/>, see <pc id="1" equivStart="START_BOLD_TEXT" equivEnd="CLOSE_BOLD_TEXT" type="fmt" dispStart="&lt;b&gt;" dispEnd="&lt;/b&gt;">this</pc></source>
        <target>Bonjour <ph id="0" equiv="INTERPOLATION" disp="{{ name }}"/>, voir <pc id="1" equivStart="START_BOLD_TEXT" equivEnd="CLOSE_BOLD_TEXT" type="fmt" dispStart="&lt;b&gt;" dispEnd="&lt;/b&gt;">ceci</pc></target>
      </segment>
    </unit>
    <unit id="later">
      <segment state="initial">
        <source>Later</source>
        <target>Plus tard</target>
      </segment>
    </unit>
  </file>
</xliff>
`;
  expect(xliffToEntries(xml, { type: "ui" })[0]).toEqual({
    id: "welcome",
    type: "ui",
    source: "Hello {INTERPOLATION}, see <BOLD_TEXT>this</BOLD_TEXT>",
    note: "Greeting\nhome",
    examples: [
      {
        values: { INTERPOLATION: "{{ name }}" },
        rendered: "Hello {{ name }}, see this",
      },
    ],
  });
  expect(xliffTranslations(xml)).toEqual([
    {
      id: "welcome",
      type: "",
      source: "Bonjour {INTERPOLATION}, voir <BOLD_TEXT>ceci</BOLD_TEXT>",
    },
  ]);
});

test("a crossed or mismatched START/CLOSE pair does not read as nested (#710)", () => {
  const unit = (target: string) =>
    `<xliff version="1.2"><file><body><trans-unit id="a"><source>x</source><target state="translated">${target}</target></trans-unit></body></file></xliff>`;
  expect(
    xliffUnits(
      unit(
        '<x id="START_LINK"/>a<x id="START_BOLD_TEXT"/>b<x id="CLOSE_LINK"/>c<x id="CLOSE_BOLD_TEXT"/>',
      ),
    )[0]?.target,
  ).toBe("<LINK>a<BOLD_TEXT>b</LINK>c</BOLD_TEXT>");
  expect(
    xliffUnits(unit('<x id="START_LINK_1"/>a<x id="CLOSE_LINK"/>'))[0]?.target,
  ).toBe("<LINK_1>a</LINK_1>");
});

test("comments, fuzzy matches, ignorables and native code are not the unit's text (#710)", () => {
  const xml = `<xliff version="1.2"><file><body>
    <trans-unit id = "q">
      <!-- <source>old</source> -->
      <source>New <!-- note --><bpt id="1">&lt;b&gt;</bpt>bold<ept id="1">&lt;/b&gt;</ept><it pos="open">&lt;i&gt;</it></source>
      <alt-trans><target>Fuzzy</target><note from="description">not ours</note></alt-trans>
      <x id="PH" equiv-text="{{ a > b }}"/>
    </trans-unit>
  </body></file></xliff>`;
  expect(xliffUnits(xml)).toEqual([
    { id: "q", source: "New <p1>bold</p1>", translated: false },
  ]);
  expect(() =>
    xliffUnits(
      '<xlf:xliff><xlf:file><xlf:body><xlf:trans-unit id="a"><xlf:source>x</xlf:source></xlf:trans-unit></xlf:body></xlf:file></xlf:xliff>',
    ),
  ).toThrow(/namespace prefix/);
});

describe("writing targets back (#711)", () => {
  const link = (text: string) =>
    `<x id="START_LINK" ctype="x-a" equiv-text="&lt;a&gt;"/>${text}<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/>`;
  const SOURCE = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="signIn" datatype="html">
        <source>Sign in with ${link("Google")}</source>
        <note priority="1" from="description">The sign-in button</note>
      </trans-unit>
      <trans-unit id="count" datatype="html">
        <source>{VAR_PLURAL, plural, =1 {one item} other {<x id="INTERPOLATION" equiv-text="{{ n }}"/> items}}</source>
      </trans-unit>
      <trans-unit id="later" datatype="html">
        <source>Later</source>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
  const TARGET = SOURCE.replace(
    'source-language="en"',
    'source-language="en" target-language="de"',
  )
    .replace(
      `Sign in with ${link("Google")}</source>`,
      `Sign in with ${link("Google")}</source>
        <target state="translated">Mit ${link("Google")} anmelden</target>`,
    )
    .replace(
      "<source>Later</source>",
      `<source>Later</source>
        <target state="new">Later</target>`,
    );

  test("what the file holds writes back byte for byte", () => {
    const translations = Object.fromEntries(
      xliffTranslations(TARGET).map((e) => [e.id, e.source]),
    );
    expect(entriesToXliff(SOURCE, translations, TARGET, "de")).toBe(TARGET);
  });

  test("a changed target keeps its inline elements; a new one fills in; a state that said work is translated", () => {
    const out = entriesToXliff(
      SOURCE,
      {
        signIn: "Über <LINK>Google</LINK> anmelden & weiter",
        count:
          "{VAR_PLURAL, plural, =1 {ein Element} other {{INTERPOLATION} Elemente}}",
        later: "Später",
      },
      TARGET,
      "de",
    );
    expect(out).toContain(
      `<target state="translated">Über ${link("Google")} anmelden &amp; weiter</target>`,
    );
    expect(out).toContain(
      `<source>{VAR_PLURAL, plural, =1 {one item} other {<x id="INTERPOLATION" equiv-text="{{ n }}"/> items}}</source>
        <target state="translated">{VAR_PLURAL, plural, =1 {ein Element} other {<x id="INTERPOLATION" equiv-text="{{ n }}"/> Elemente}}</target>`,
    );
    expect(out).toContain(`<target state="translated">Später</target>`);
    expect(xliffTranslations(out).map((e) => e.id)).toEqual([
      "signIn",
      "count",
      "later",
    ]);
  });

  test("a missing target file is the source file with its language, and a unit the file lacks is appended", () => {
    const fresh = entriesToXliff(SOURCE, { later: "Später" }, undefined, "fr");
    expect(fresh).toContain('<file target-language="fr" source-language="en"');
    expect(xliffTranslations(fresh)).toEqual([
      { id: "later", type: "", source: "Später" },
    ]);
    const short = TARGET.replace(
      /\s*<trans-unit id="later"[\s\S]*?<\/trans-unit>/,
      "",
    );
    const grown = entriesToXliff(SOURCE, { later: "Später" }, short, "de");
    expect(xliffTranslations(grown).map((e) => e.id)).toEqual([
      "signIn",
      "later",
    ]);
  });

  test("a proposal edits, adds and removes units in the source file", () => {
    let out = applyXliffOps(SOURCE, [
      { kind: "edit", id: "signIn", text: "Log in with <LINK>Google</LINK>" },
    ]);
    expect(out).toContain(`<source>Log in with ${link("Google")}</source>`);
    out = applyXliffOps(out, [
      { kind: "add", id: "fresh", text: "Fresh & new" },
      { kind: "delete", id: "later" },
    ]);
    expect(
      xliffToEntries(out, { type: "ui" }).map((e) => [e.id, e.source]),
    ).toEqual([
      ["signIn", "Log in with <LINK>Google</LINK>"],
      [
        "count",
        "{VAR_PLURAL, plural, =1 {one item} other {{INTERPOLATION} items}}",
      ],
      ["fresh", "Fresh & new"],
    ]);
  });
});

describe("writing, the review's cases (#711)", () => {
  test("a <source/> unit takes its own target, not the next unit's", () => {
    const xml = `<xliff version="1.2"><file><body>
      <trans-unit id="e"><source/></trans-unit>
      <trans-unit id="k"><source>K</source></trans-unit>
    </body></file></xliff>`;
    const out = entriesToXliff(xml, { e: "E" }, xml, "de");
    expect(xliffUnits(out)).toEqual([
      { id: "e", source: "", target: "E", translated: true },
      { id: "k", source: "K", translated: false },
    ]);
  });

  test("a <target/> in <alt-trans> or a comment is not the unit's", () => {
    const xml = `<xliff version="1.2"><file><body>
      <trans-unit id="a"><source>A</source>
        <!-- <target/> -->
        <alt-trans><target/></alt-trans>
      </trans-unit>
    </body></file></xliff>`;
    const out = entriesToXliff(xml, { a: "Ä" }, xml, "de");
    expect(out).toContain(
      `<source>A</source>\n      <target state="translated">Ä</target>`,
    );
    expect(out).toContain("<alt-trans><target/></alt-trans>");
  });

  test("a CRLF file stays CRLF", () => {
    const xml = [
      `<xliff version="1.2"><file><body>`,
      `      <trans-unit id="a"><source>A</source></trans-unit>`,
      `      <trans-unit id="b"><source>B</source></trans-unit>`,
      `</body></file></xliff>`,
      "",
    ].join("\r\n");
    const out = entriesToXliff(xml, { a: "Ä" }, xml, "de");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    const removed = applyXliffOps(xml, [{ kind: "delete", id: "b" }]);
    expect(removed).not.toContain("\r\r");
    expect(removed.replace(/\r\n/g, "")).not.toContain("\n");
  });

  test("2.0: a repeated placeholder keeps each element's id; trgLang, segment state and a new unit", () => {
    const source = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="en">
  <file id="ngi18n" original="ng.template">
    <unit id="pair">
      <segment state="initial">
        <source><ph id="0" equiv="INTERPOLATION" disp="{{ a }}"/> and <ph id="1" equiv="INTERPOLATION" disp="{{ b }}"/></source>
      </segment>
    </unit>
  </file>
</xliff>
`;
    const out = entriesToXliff(
      source,
      { pair: "{INTERPOLATION} und {INTERPOLATION}" },
      undefined,
      "de",
    );
    expect(out).toContain('trgLang="de"');
    expect(out).toContain('<segment state="translated">');
    expect(out).toContain(
      `<target><ph id="0" equiv="INTERPOLATION" disp="{{ a }}"/> und <ph id="1" equiv="INTERPOLATION" disp="{{ b }}"/></target>`,
    );
    const added = applyXliffOps(source, [
      { kind: "add", id: "fresh", text: "Fresh" },
    ]);
    expect(xliffToEntries(added, { type: "ui" }).map((e) => e.id)).toEqual([
      "pair",
      "fresh",
    ]);
  });
});

test("a placeholder's equiv-text, 2.0's disp, is the unit's example, so the preview and the slots show what the app substitutes (#714)", () => {
  const v12 = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="hello" datatype="html">
        <source>Hello <x id="INTERPOLATION" equiv-text="{{ user.name }}"/>, see <x id="START_LINK" ctype="x-a" equiv-text="&lt;a href=&quot;/x&quot;&gt;"/>docs<x id="CLOSE_LINK" ctype="x-a" equiv-text="&lt;/a&gt;"/></source>
      </trans-unit>
      <trans-unit id="plain" datatype="html">
        <source>No placeholders</source>
      </trans-unit>
      <trans-unit id="bare" datatype="html">
        <source>Hi <x id="INTERPOLATION"/></source>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
  const [hello, plain, bare] = xliffToEntries(v12, { type: "ui" });
  expect(hello!.examples).toEqual([
    {
      values: { INTERPOLATION: "{{ user.name }}" },
      rendered: "Hello {{ user.name }}, see docs",
    },
  ]);
  expect(plain!.examples).toBeUndefined();
  expect(bare!.examples).toBeUndefined();
  const v20 = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="en">
  <file id="ngi18n" original="ng.template">
    <unit id="hello">
      <segment>
        <source>Hello <ph id="0" equiv="INTERPOLATION" disp="{{ name }}"/></source>
      </segment>
    </unit>
  </file>
</xliff>
`;
  expect(xliffToEntries(v20, { type: "ui" })[0]!.examples).toEqual([
    { values: { INTERPOLATION: "{{ name }}" }, rendered: "Hello {{ name }}" },
  ]);
});

test("a unit's source locations follow its note as `Used in`, as the gettext and qt-ts sources write them (#772)", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="save" datatype="html">
        <source>Save</source>
        <context-group purpose="location">
          <context context-type="sourcefile">src/app/a.html</context>
          <context context-type="linenumber">12</context>
        </context-group>
        <context-group purpose="location">
          <context context-type="sourcefile">src/app/b.html</context>
          <context context-type="linenumber">3</context>
        </context-group>
        <note priority="1" from="description">The save button</note>
      </trans-unit>
      <trans-unit id="bare" datatype="html">
        <source>Bare</source>
        <context-group purpose="location">
          <context context-type="sourcefile">src/app/c.ts</context>
        </context-group>
      </trans-unit>
      <trans-unit id="none" datatype="html">
        <source>None</source>
        <note from="description">Only a note</note>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
  const [save, bare, none] = xliffToEntries(xml, { type: "ui" });
  expect(save!.note).toBe(
    "The save button\nUsed in src/app/a.html:12 src/app/b.html:3",
  );
  expect(bare!.note).toBe("Used in src/app/c.ts");
  expect(none!.note).toBe("Only a note");
});

test("locations read through spaced and prefixed attributes, and from 2.0's location notes (#772)", () => {
  const v12 = `<?xml version="1.0" encoding="UTF-8" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
  <file source-language="en" datatype="plaintext" original="ng2.template">
    <body>
      <trans-unit id="a" datatype="html">
        <source>A</source>
        <context-group purpose="location"/>
        <context-group purpose="location">
          <context context-type="linenumber"/>
          <context x-context-type="sourcefile">9</context>
          <context context-type = "sourcefile">src/a.html</context>
          <context context-type='linenumber'>4</context>
        </context-group>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
  expect(xliffToEntries(v12, { type: "ui" })[0]!.note).toBe(
    "Used in src/a.html:4",
  );
  const v20 = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="en">
  <file id="ngi18n" original="ng.template">
    <unit id="b">
      <notes>
        <note category="description">Greeting</note>
        <note category="location">src/app/b.html:12</note>
        <note category="location">src/app/c.html:3,5</note>
      </notes>
      <segment>
        <source>B</source>
      </segment>
    </unit>
  </file>
</xliff>
`;
  expect(xliffToEntries(v20, { type: "ui" })[0]!.note).toBe(
    "Greeting\nUsed in src/app/b.html:12 src/app/c.html:3,5",
  );
});

test("a removal takes the unit alone where other markup shares its line (#847)", () => {
  const one = `<?xml version="1.0"?><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file source-language="en" datatype="plaintext" original="a"><body><trans-unit id="a"><source>A</source></trans-unit><trans-unit id="b"><source>B</source></trans-unit></body></file></xliff>\n`;
  expect(applyXliffOps(one, [{ kind: "delete", id: "b" }])).toBe(
    one.replace('<trans-unit id="b"><source>B</source></trans-unit>', ""),
  );
  const grouped = `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file source-language="en" datatype="plaintext" original="a">\n    <body>\n      <group id="g"><trans-unit id="a"><source>A</source></trans-unit>\n      </group>\n    </body>\n  </file>\n</xliff>\n`;
  expect(applyXliffOps(grouped, [{ kind: "delete", id: "a" }])).toBe(
    grouped.replace('<trans-unit id="a"><source>A</source></trans-unit>', ""),
  );
  const lines = `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\r\n  <file source-language="en" datatype="plaintext" original="a">\r\n    <body>\r\n      <trans-unit id="a">\r\n        <source>A</source>\r\n      </trans-unit>\r\n    </body>\r\n  </file>\r\n</xliff>\r\n`;
  expect(applyXliffOps(lines, [{ kind: "delete", id: "a" }])).toBe(
    lines.replace(/\r\n {6}<trans-unit id="a">[\s\S]*?<\/trans-unit>/, ""),
  );
});
