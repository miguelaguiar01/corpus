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
      note: "The sign-in button",
    },
    {
      id: "holdings",
      type: "ui",
      source:
        "{VAR_PLURAL, plural, =1 {1 holding} other {{INTERPOLATION} holdings}}",
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
