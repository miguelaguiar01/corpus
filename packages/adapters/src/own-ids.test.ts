import { expect, test } from "vitest";
import { entriesToAndroid } from "./android";
import { entriesToFluent } from "./fluent";
import { entriesToGettext } from "./gettext";
import { entriesToQtTs } from "./qtts";
import { entriesToMessages, entriesToTable } from "./write";
import { entriesToXcstrings, serializeXcstrings } from "./xcstrings";
import { entriesToXliff } from "./xliff";
import { entriesToYaml } from "./yaml";

// An id named like an Object.prototype member is an id like any other: a
// map without it has no translation for it, and one with it has (#845).
const NAMES = ["toString", "constructor", "__proto__", "hasOwnProperty"];
const without = { other: "Autre" };
const withEach = (name: string) => Object.fromEntries([[name, "Fait"]]);

const each = (
  write: (name: string, translations: Record<string, string>) => string,
) => {
  for (const name of NAMES) {
    const kept = write(name, without);
    expect(kept).not.toContain("undefined");
    expect(kept).not.toContain("Fait");
    expect(write(name, withEach(name))).toContain("Fait");
  }
};

test("messages and table writers", () => {
  const json = (name: string) =>
    JSON.stringify({ [name]: "Done", other: "Other" });
  // A key path through the prototype stays refused by name (splice.ts).
  for (const name of NAMES) {
    const kept = () => entriesToMessages(json(name), without);
    const written = () => entriesToMessages(json(name), withEach(name));
    if (name === "__proto__" || name === "constructor") {
      expect(kept).toThrow("is not a valid key path");
      expect(written).toThrow("is not a valid key path");
      continue;
    }
    expect(kept()).not.toContain("undefined");
    expect(written()).toContain("Fait");
  }
  each((name, t) =>
    entriesToTable(JSON.stringify([{ id: name, text: "Done" }]), t, {
      id: "id",
      text: "text",
    }),
  );
});

test("gettext writer", () => {
  const po = (name: string) =>
    `msgid ""\nmsgstr ""\n"Language: fr\\n"\n\nmsgid "${name}"\nmsgstr ""\n\nmsgid "other"\nmsgstr ""\n`;
  const fr = { tag: "fr", code: "fr" };
  each((name, t) => entriesToGettext(po(name), t, po(name), fr));
  each((name, t) => entriesToGettext(po(name), t, undefined, fr));
});

test("xliff writer", () => {
  const xlf = (name: string) =>
    `<?xml version="1.0" encoding="UTF-8" ?>\n<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n  <file source-language="en" target-language="fr" datatype="plaintext" original="ng2.template">\n    <body>\n      <trans-unit id="${name}" datatype="html">\n        <source>Done</source>\n      </trans-unit>\n    </body>\n  </file>\n</xliff>\n`;
  each((name, t) => entriesToXliff(xlf(name), t, xlf(name), "fr"));
});

test("qt-ts writer", () => {
  const ts = (name: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="fr">\n<context>\n    <name>A</name>\n    <message id="${name}">\n        <source>Done</source>\n        <translation type="unfinished"></translation>\n    </message>\n</context>\n</TS>\n`;
  each((name, t) =>
    entriesToQtTs(ts(name), t, ts(name), { tag: "fr", code: "fr" }),
  );
});

test("yaml writer", () => {
  const lang = { source: "en", code: "fr" };
  each((name, t) =>
    entriesToYaml(`en:\n  ${name}: Done\n`, t, `fr:\n  ${name}: Old\n`, lang),
  );
  each((name, t) =>
    entriesToYaml(`en:\n  ${name}: Done\n`, t, undefined, lang),
  );
});

test("fluent and android writers", () => {
  const ftl = (name: string) => `${name.replace(/_/g, "x")} = Done\n`;
  each((name, t) => {
    const id = name.replace(/_/g, "x");
    const own = Object.hasOwn(t, name) ? { [id]: t[name]! } : without;
    return entriesToFluent(ftl(name), own, ftl(name)).replace(id, name);
  });
  const xml = (name: string) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="${name}">Done</string>\n</resources>\n`;
  each((name, t) => entriesToAndroid(xml(name), t, xml(name)));
});

test("xcstrings writer", () => {
  const catalog = (name: string) =>
    `${serializeXcstrings({
      sourceLanguage: "en",
      strings: {
        [name]: {
          localizations: {
            fr: { stringUnit: { state: "translated", value: "Vieux" } },
          },
        },
      },
      version: "1.0",
    })}\n`;
  each((name, t) => entriesToXcstrings(catalog(name), t, "fr"));
});
