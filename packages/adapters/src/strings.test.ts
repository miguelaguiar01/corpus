import { expect, test } from "vitest";
import {
  applyStringsOps,
  entriesToStrings,
  stringsToEntries,
  stringsTranslations,
} from "./strings";
import { decodeText, encodeText } from "./text";

const SOURCE = `//
//  Localizable.strings
//  Stats
//

// Modules
"CPU" = "CPU";
"Open CPU settings" = "Open CPU settings";

/* The used part of a disk */
"Used disk memory" = "%0 of %1 used";
/* No comment provided by engineer. */
"Quote" = "Say \\"hi\\"\\n\\tthen \\U00e9";
version = 2;
"Tagged" = "Tagged"; // ai-translated
`;

test("a .strings file reads its pairs, quoted or bare, its escapes, and the comment directly above a key as its note (#1037)", () => {
  expect(stringsToEntries(SOURCE, { type: "ui" })).toEqual([
    { id: "CPU", type: "ui", source: "CPU", note: "Modules" },
    { id: "Open CPU settings", type: "ui", source: "Open CPU settings" },
    {
      id: "Used disk memory",
      type: "ui",
      source: "%0 of %1 used",
      note: "The used part of a disk",
    },
    { id: "Quote", type: "ui", source: 'Say "hi"\n\tthen é' },
    { id: "version", type: "ui", source: "2" },
    { id: "Tagged", type: "ui", source: "Tagged" },
  ]);
  // Consecutive comment lines are one note; a blank line parts them.
  expect(
    stringsToEntries(`// one\n// two\n"a" = "A";\n// gone\n\n"b" = "B";\n`, {
      type: "ui",
    }),
  ).toEqual([
    { id: "a", type: "ui", source: "A", note: "one\ntwo" },
    { id: "b", type: "ui", source: "B" },
  ]);
  expect(stringsTranslations(`"a" = "Ä";`)).toEqual([
    { id: "a", type: "", source: "Ä" },
  ]);
});

test("a .strings file that does not read is refused with its line (#1037)", () => {
  expect(() =>
    stringsToEntries(`"a" = "A"\n"b" = "B";\n`, { type: "ui" }),
  ).toThrow(/line 2: "a" lacks its ;/);
  expect(() =>
    stringsToEntries(`"a" = "A";\n"a" = "B";\n`, { type: "ui" }),
  ).toThrow(/line 2: "a" is written twice/);
  expect(() => stringsToEntries(`"a" = "A;\n`, { type: "ui" })).toThrow(
    /never closes/,
  );
});

test("a pull rewrites only a changed value, puts a missing key after its source neighbour, and starts a new file as the source (#1037)", () => {
  const target = `// Modules\n"CPU" = "CPU";\n"Used disk memory" = "%0 von %1 belegt";\n"Tagged" = "Tagged"; // ai-translated\n`;
  expect(
    entriesToStrings(
      SOURCE,
      { "Used disk memory": "%0 von %1 belegt" },
      target,
    ),
  ).toBe(target);
  expect(
    entriesToStrings(
      SOURCE,
      {
        "Used disk memory": "%0 von %1 genutzt",
        "Open CPU settings": "CPU-Einstellungen öffnen",
        Tagged: 'Mit "Tag"',
      },
      target,
    ),
  ).toBe(
    `// Modules\n"CPU" = "CPU";\n"Open CPU settings" = "CPU-Einstellungen öffnen";\n"Used disk memory" = "%0 von %1 genutzt";\n"Tagged" = "Mit \\"Tag\\""; // ai-translated\n`,
  );
  // CRLF is kept, a new line too.
  expect(
    entriesToStrings(
      SOURCE,
      { "Open CPU settings": "Öffnen" },
      `"CPU" = "CPU";\r\n`,
    ),
  ).toBe(`"CPU" = "CPU";\r\n"Open CPU settings" = "Öffnen";\r\n`);
  // A new language takes every key, as Xcode writes them.
  const fresh = entriesToStrings(SOURCE, { CPU: "Prozessor" });
  expect(fresh).toBe(SOURCE.replace('"CPU" = "CPU";', '"CPU" = "Prozessor";'));
});

test("proposals edit, add and remove pairs in the source file, a removal taking its note (#1037)", () => {
  const out = applyStringsOps(SOURCE, [
    { kind: "edit", id: "CPU", text: "Processor" },
    { kind: "delete", id: "Used disk memory" },
    { kind: "add", id: "New one", text: "New" },
  ] as never);
  expect(out).toBe(
    SOURCE.replace('"CPU" = "CPU";', '"CPU" = "Processor";')
      .replace(
        `/* The used part of a disk */\n"Used disk memory" = "%0 of %1 used";\n`,
        "",
      )
      .concat(`"New one" = "New";\n`),
  );
});

test("a UTF-16 file decodes with its byte order and encodes back to the same bytes; UTF-8 stays UTF-8 (#1037)", () => {
  const text = `\uFEFF"a" = "Ä";\n`;
  for (const encoding of ["utf16le", "utf16be"] as const) {
    const bytes = encodeText(text, encoding);
    expect([...bytes.slice(0, 2)]).toEqual(
      encoding === "utf16le" ? [0xff, 0xfe] : [0xfe, 0xff],
    );
    expect(decodeText(bytes)).toEqual({ text, encoding });
  }
  const utf8 = new TextEncoder().encode(`"a" = "Ä";\n`);
  expect(decodeText(utf8)).toEqual({ text: `"a" = "Ä";\n`, encoding: "utf8" });
  expect(encodeText(`"a" = "Ä";\n`, "utf8")).toEqual(utf8);
});

test("escapes as CoreFoundation reads them: octal, \\U with up to four hex digits, the C letters, and any other character itself (#1037)", () => {
  expect(
    stringsToEntries(`"a" = "\\101\\U41\\Ue9\\u\\a\\v\\q";`, { type: "ui" })[0]!
      .source,
  ).toBe("AAéu\x07\vq");
});

test('a "key"; alone keeps its key when its value is written, and a removal never takes a pair before it on its line (#1037)', () => {
  expect(entriesToStrings(`"Done";\n`, { Done: "Terminé" }, `"Done";\n`)).toBe(
    `"Done" = "Terminé";\n`,
  );
  expect(
    applyStringsOps(`"Done";\n`, [
      { kind: "edit", id: "Done", text: "Finished" },
    ]),
  ).toBe(`"Done" = "Finished";\n`);
  const two = `"title" = "Title"; /* the window title */\n"quit" = "Quit";\n`;
  expect(stringsToEntries(two, { type: "ui" })).toEqual([
    { id: "title", type: "ui", source: "Title" },
    { id: "quit", type: "ui", source: "Quit" },
  ]);
  expect(applyStringsOps(two, [{ kind: "delete", id: "quit" }])).toBe(
    `"title" = "Title"; /* the window title */\n`,
  );
  expect(
    applyStringsOps(`"a" = "A"; "b" = "B";\n`, [{ kind: "delete", id: "b" }]),
  ).toBe(`"a" = "A";\n`);
});

test("a missing key the source puts first goes before the file's first key, and many missing keys write in one pass (#1037)", () => {
  expect(
    entriesToStrings(`"a" = "A";\n"b" = "B";\n`, { a: "Ä" }, `"b" = "B";\n`),
  ).toBe(`"a" = "Ä";\n"b" = "B";\n`);
  const keys = Array.from({ length: 10_000 }, (_, i) => `key${i}`);
  const source = keys.map((k) => `"${k}" = "${k}";`).join("\n") + "\n";
  const target =
    keys
      .filter((_, i) => i % 10 !== 0)
      .map((k) => `"${k}" = "${k}";`)
      .join("\n") + "\n";
  const missing = Object.fromEntries(
    keys.filter((_, i) => i % 10 === 0).map((k) => [k, `${k}!`]),
  );
  const started = performance.now();
  const out = entriesToStrings(source, missing, target);
  expect(performance.now() - started).toBeLessThan(2000);
  expect(stringsToEntries(out, { type: "ui" }).map((e) => e.id)).toEqual(keys);
});

test("a byte-order mark stays the file's first character: a key inserted first and a first pair removed go after it (#1037)", () => {
  const bom = "\uFEFF";
  expect(
    entriesToStrings(
      `"a" = "A";\n"b" = "B";\n`,
      { a: "Ä" },
      `${bom}"b" = "B";\n`,
    ),
  ).toBe(`${bom}"a" = "Ä";\n"b" = "B";\n`);
  expect(
    applyStringsOps(`${bom}/* first */\n"a" = "A";\n"b" = "B";\n`, [
      { kind: "delete", id: "a" },
    ]),
  ).toBe(`${bom}"b" = "B";\n`);
  expect(stringsToEntries(`"a" = "\\U";`, { type: "ui" })[0]!.source).toBe(
    "\0",
  );
});

test("UTF-16 is written with its byte-order mark, so a blank UTF-16 file a pull fills reads back; an add into a mark alone writes no blank line (#1037)", () => {
  const filled = entriesToStrings(
    `"title" = "Title";\n`,
    { title: "Titre" },
    "\uFEFF\n",
  );
  for (const encoding of ["utf16le", "utf16be"] as const) {
    const bytes = encodeText(filled, encoding);
    expect(
      stringsTranslations(decodeText(bytes).text).map((e) => e.source),
    ).toEqual(["Titre"]);
  }
  expect(
    applyStringsOps("\uFEFF", [{ kind: "add", id: "new", text: "New" }]),
  ).toBe(`\uFEFF"new" = "New";\n`);
});
