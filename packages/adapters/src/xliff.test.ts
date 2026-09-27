import { expect, test } from "vitest";
import { xliffToEntries, xliffTranslations, xliffUnits } from "./xliff";

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
