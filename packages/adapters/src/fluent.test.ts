import { expect, test } from "vitest";
import { applyFluentOps, entriesToFluent, fluentToEntries } from "./fluent";

const SOURCE = `# Files
trash = Trash
empty-trash = Empty {trash}
operations-running = {$running} {$running ->
    [one] operation
    *[other] operations
  } running ({$percent}%)...
dismiss = Dismiss
multi = First line
    second line
`;

const GL = `trash = Lixo
operations-running =
    { $running } { $running ->
        [one] operación
       *[other] operacións
    } executándose ({ $percent }%)...
dismiss = Descartar
`;

test("messages read as ICU: variables and references are placeholders, a select on a count is a plural, a multi-line value keeps its line break (#597)", () => {
  expect(fluentToEntries(SOURCE, { type: "ui" })).toEqual([
    { id: "trash", type: "ui", source: "Trash" },
    { id: "empty-trash", type: "ui", source: "Empty {trash}" },
    {
      id: "operations-running",
      type: "ui",
      source:
        "{running} {running, plural, one {operation} other {operations}} running ({percent}%)...",
    },
    { id: "dismiss", type: "ui", source: "Dismiss" },
    { id: "multi", type: "ui", source: "First line\nsecond line" },
  ]);
  expect(fluentToEntries(GL, { type: "ui" })[1]?.source).toBe(
    "{running} {running, plural, one {operación} other {operacións}} executándose ({percent}%)...",
  );
});

test("a select on other keys is an ICU select; numeric keys are exact; a plural whose default is not other gets one", () => {
  const ftl = `a = {$n ->
    [0] none
    [one] one
   *[many] many
  }
b = {$g ->
    [unha] unha
   *[outra] outra
  }
`;
  expect(fluentToEntries(ftl, { type: "ui" }).map((e) => e.source)).toEqual([
    "{n, plural, =0 {none} one {one} many {many} other {many}}",
    "{g, select, unha {unha} outra {outra} other {outra}}",
  ]);
});

test("attributes, terms, functions and string literals are refused by name, all at once", () => {
  const ftl = `login = Log in
    .title = Log in to your account
-brand = COSMIC
size = { NUMBER($n) } bytes
brace = Use {"{"} here
ok = Fine
`;
  expect(() => fluentToEntries(ftl, { type: "ui" })).toThrow(
    /login has an attribute \(\.title\); -brand is a term; size calls a function; brace has a string literal/,
  );
});

test("an unchanged pull is byte-identical; a changed message is rewritten in its own layout", () => {
  const same = {
    trash: "Lixo",
    "operations-running":
      "{running} {running, plural, one {operación} other {operacións}} executándose ({percent}%)...",
    dismiss: "Descartar",
  };
  expect(entriesToFluent(SOURCE, same, GL)).toBe(GL);
  expect(
    entriesToFluent(
      SOURCE,
      {
        ...same,
        "operations-running":
          "{running} {running, plural, one {operación} many {operacións} other {operacións}} en curso ({percent}%)...",
      },
      GL,
    ),
  ).toBe(`trash = Lixo
operations-running =
    { $running } { $running ->
        [one] operación
        [many] operacións
       *[other] operacións
    } en curso ({ $percent }%)...
dismiss = Descartar
`);
});

test("a new message is appended in the file's layout; a reference stays a reference; a missing file is the source's structure with its values translated", () => {
  const out = entriesToFluent(
    SOURCE,
    { "empty-trash": "Baleirar {trash}" },
    GL,
  );
  expect(out).toBe(`${GL}empty-trash = Baleirar { trash }\n`);
  expect(
    entriesToFluent(SOURCE, { trash: "Lixo", multi: "Unha\ndúas" }, undefined),
  ).toBe(`# Files
trash = Lixo
multi = Unha
    dúas
`);
});

test("proposal ops edit, add and remove a message in the source file", () => {
  const out = applyFluentOps(SOURCE, [
    { kind: "edit", id: "dismiss", text: "Close" },
    { kind: "add", id: "added", text: "New {count}" },
    { kind: "delete", id: "multi" },
  ]);
  expect(out).toContain("dismiss = Close\n");
  expect(out.endsWith("added = New {$count}\n")).toBe(true);
  expect(out).not.toContain("multi =");
  expect(out).not.toContain("second line");
});

test("a blank target with nothing to write stays blank", () => {
  expect(entriesToFluent(SOURCE, {}, "\n")).toBe("\n");
});

test("a placeholder named like a message is still a variable where the source uses it as one", () => {
  const source = `items = Items
count = {$items} {$items ->
    [one] item
    *[other] items
  } in {trash}
trash = Trash
`;
  expect(
    entriesToFluent(
      source,
      {
        count:
          "{items} {items, plural, one {elemento} other {elementos}} em {items}",
      },
      undefined,
    ),
  ).toContain("count = {$items} {$items ->");
  expect(
    entriesToFluent(
      source,
      {
        count:
          "{items} {items, plural, one {elemento} other {elementos}} em {trash}",
      },
      undefined,
    ),
  ).toContain("} em {trash}");
});

test("review of #634: a key with no ] is refused, not a stack overflow; a BOM keeps the first message; } may sit at column 0", () => {
  expect(() =>
    fluentToEntries("a = { $n ->\n    [one x\n", { type: "ui" }),
  ).toThrow(/a has a select Corpus does not read/);
  const bom = "﻿trash = Trash\nother = Other\n";
  expect(fluentToEntries(bom, { type: "ui" }).map((e) => e.id)).toEqual([
    "trash",
    "other",
  ]);
  expect(entriesToFluent(bom, { trash: "Lixo" }, bom)).toBe(
    "﻿trash = Lixo\nother = Other\n",
  );
  expect(
    fluentToEntries("a = {$n ->\n    [one] x\n   *[other] y\n}\nb = B\n", {
      type: "ui",
    }).map((e) => e.id),
  ).toEqual(["a", "b"]);
});

test("a select's default survives as other, and a changed one keeps it", () => {
  const source = "a = {$g ->\n    [female] her\n   *[male] his\n  }\n";
  expect(fluentToEntries(source, { type: "ui" })[0]?.source).toBe(
    "{g, select, female {her} male {his} other {his}}",
  );
  expect(
    entriesToFluent(
      source,
      { a: "{g, select, female {dela} male {dele} other {dele}}" },
      source,
    ),
  ).toBe(
    "a = {$g ->\n    [female] dela\n    [male] dele\n   *[other] dele\n  }\n",
  );
});

test("an empty pattern and a line starting with . [ or * are written as Fluent reads them, and read back", () => {
  const source = "a = A\nb = {$n ->\n    [one] one\n   *[other] other\n  }\n";
  const out = entriesToFluent(
    source,
    { a: ".config is\n[not] *special*", b: "{n, plural, one {} other {x}}" },
    undefined,
  );
  expect(out).toBe(
    'a = {"."}config is\n    {"["}not] *special*\nb = {$n ->\n    [one] {""}\n   *[other] x\n  }\n',
  );
  expect(fluentToEntries(out, { type: "ui" }).map((e) => e.source)).toEqual([
    ".config is\n[not] *special*",
    "{n, plural, one {} other {x}}",
  ]);
  expect(entriesToFluent("a = A\n", { a: "" }, undefined)).toBe('a = {""}\n');
});

test("a CRLF file stays CRLF on a change, an append and a delete", () => {
  const crlf = "a = A\r\nb = B\r\nc = C\r\n";
  expect(entriesToFluent(crlf, { a: "Um\ndois", d: "D" }, crlf)).toBe(
    "a = Um\r\n    dois\r\nb = B\r\nc = C\r\nd = D\r\n",
  );
  expect(applyFluentOps(crlf, [{ kind: "delete", id: "b" }])).toBe(
    "a = A\r\nc = C\r\n",
  );
});

test("a line that starts with whitespace and then . [ or * is escaped too", () => {
  const text = "texto\n  .attr = x\n  [nota] y";
  const out = entriesToFluent("a = A\n", { a: text }, undefined);
  expect(fluentToEntries(out, { type: "ui" })[0]?.source).toBe(
    "texto\n.attr = x\n[nota] y",
  );
});
