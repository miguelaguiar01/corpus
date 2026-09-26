import { expect, test } from "vitest";
import {
  androidDirOf,
  androidLanguageOf,
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

test("a values directory is a language by Android's rule, and back", () => {
  expect(androidLanguageOf("values")).toBeUndefined();
  expect(androidLanguageOf("values-de")).toBe("de");
  expect(androidLanguageOf("values-pt-rBR")).toBe("pt-BR");
  expect(androidLanguageOf("values-b+sr+Latn")).toBe("sr-Latn");
  expect(androidLanguageOf("values-in")).toBe("in");
  expect(androidLanguageOf("values-night")).toBeUndefined();
  expect(androidLanguageOf("values-v21")).toBeUndefined();
  expect(androidDirOf("de")).toBe("values-de");
  expect(androidDirOf("pt-BR")).toBe("values-pt-rBR");
  expect(androidDirOf("pt_BR")).toBe("values-pt-rBR");
  expect(androidDirOf("es-419")).toBe("values-es-r419");
  expect(androidDirOf("sr-Latn")).toBe("values-b+sr+Latn");
});
