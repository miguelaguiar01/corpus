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
    "{g, select, unha {unha} outra {outra}}",
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
