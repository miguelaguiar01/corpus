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

test("attributes, functions and number literals are refused by name, a message at a time, and the rest read (#991)", () => {
  const ftl = `login = Log in
    .title = Log in to your account
size = { PLATFORM() } bytes
num = { 5 } items
ok = Fine
`;
  const refused: [string, string][] = [];
  const read = fluentToEntries(ftl, {
    type: "ui",
    onRefused: (id, reason) => refused.push([id, reason]),
  });
  expect(read.map((e) => e.id)).toEqual(["ok"]);
  expect(refused.map(([id]) => id)).toEqual(["login", "size", "num"]);
  expect(refused.map(([, reason]) => reason.split(";")[0])).toEqual([
    "login has an attribute (.title)",
    "size calls a function",
    "num has a number literal",
  ]);
});

test("a message Fluent's own parser reads as Junk is refused by name, the rest read (#991)", () => {
  for (const junk of [
    "a = { $n -> [0] none [1] one *[other] { $n } many }",
    "a = { $n -> [one] x\n *[other] y\n}",
    "a = { $n ->\n [one] x\n [other] y\n}",
    "a = { $n ->\n *[one] x\n *[other] y\n}",
    "a = { $n ->\n [one] x\n *[other] y }",
  ]) {
    const refused: string[] = [];
    const read = fluentToEntries(`${junk}\nb = B\n`, {
      type: "ui",
      onRefused: (id) => refused.push(id),
    });
    expect(refused, junk).toEqual(["a"]);
    expect(
      read.map((e) => e.id),
      junk,
    ).toEqual(["b"]);
  }
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
  const refused: string[] = [];
  fluentToEntries("a = { $n ->\n    [one x\n", {
    type: "ui",
    onRefused: (_, reason) => refused.push(reason),
  });
  expect(refused[0]).toMatch(/a has a select Corpus does not read/);
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

test("a message whose placeable never closes ends at the next entry, as Fluent's parser restarts there (#991 review)", () => {
  const refused: string[] = [];
  const read = fluentToEntries("z = Z\na = Hello { $name\nb = B\nc = C\n", {
    type: "ui",
    onRefused: (id) => refused.push(id),
  });
  expect(read.map((e) => e.id)).toEqual(["z", "b", "c"]);
  expect(refused).toEqual(["a"]);
});

test('a string literal reads as written, and a # in a plural\'s variant as the literal {"#"}, so # stays the count (#990)', () => {
  const ftl = `cloze = This is a { "{{c1::" }sample{ "}}" } cloze deletion.
nbsp = 5{"\\u00A0"}km
legacy = Required for AnkiDroid { "<=" } 2.14
due = { $number ->
    [one] Nueva #{ $number }
   *[other] Nuevas #{ $number }
  }
`;
  const read = fluentToEntries(ftl, { type: "ui" });
  expect(read.map((e) => [e.id, e.source])).toEqual([
    ["cloze", 'This is a {"{{c1::"}sample{"}}"} cloze deletion.'],
    ["nbsp", '5{"\\u00A0"}km'],
    ["legacy", 'Required for AnkiDroid {"<="} 2.14'],
    [
      "due",
      '{number, plural, one {Nueva {"#"}{number}} other {Nuevas {"#"}{number}}}',
    ],
  ]);
  // An unchanged pull writes the same bytes.
  const translations = Object.fromEntries(read.map((e) => [e.id, e.source]));
  expect(entriesToFluent(ftl, translations, ftl)).toBe(ftl);
});

test('a changed message writes a literal back as written and {"#"} as a plain #', () => {
  const source = `cloze = This is a { "{{c1::" }sample{ "}}" } cloze deletion.
due = { $number ->
    [one] New #{ $number }
   *[other] New #{ $number }
  }
`;
  const out = entriesToFluent(
    source,
    {
      cloze: 'Isto é um {"{{c1::"}exemplo{"}}"} de omissão.',
      due: '{number, plural, one {Nueva {"#"}{number}} other {Nuevas {"#"}{number} y # más}}',
    },
    undefined,
  );
  expect(out).toBe(`cloze = Isto é um { "{{c1::" }exemplo{ "}}" } de omissão.
due = { $number ->
    [one] Nueva #{ $number }
   *[other] Nuevas #{ $number } y { $number } más
  }
`);
  const back = Object.fromEntries(
    fluentToEntries(out, { type: "ui" }).map((e) => [e.id, e.source]),
  );
  expect(back.cloze).toBe('Isto é um {"{{c1::"}exemplo{"}}"} de omissão.');
  expect(back.due).toBe(
    '{number, plural, one {Nueva {"#"}{number}} other {Nuevas {"#"}{number} y {number} más}}',
  );
});

test("a # literal outside a plural is written back as read; an escape Fluent does not know is refused (#990 review)", () => {
  const source = 'a = Issue { "#" }{ $n } open\nb = Tab {"\\t"} here\n';
  const refused: string[] = [];
  const read = fluentToEntries(source, {
    type: "ui",
    onRefused: (id) => refused.push(id),
  });
  expect(read.map((e) => [e.id, e.source])).toEqual([
    ["a", 'Issue {"#"}{n} open'],
  ]);
  expect(refused).toEqual(["b"]);
  const out = applyFluentOps(source, [
    { kind: "edit", id: "a", text: 'Issue {"#"}{n} closed' },
  ]);
  expect(out).toBe('a = Issue { "#" }{ $n } closed\nb = Tab {"\\t"} here\n');
  expect(fluentToEntries(out, { type: "ui" })[0]!.source).toBe(
    'Issue {"#"}{n} closed',
  );
  // Inside a select within a plural the # is Fluent's text again.
  const nested = entriesToFluent(
    "c = { $n ->\n    [one] x\n   *[other] y\n  }\n",
    {
      c: '{n, plural, one {{g, select, f {Nº {"#"}} other {No {"#"}}}} other {{n}}}',
    },
    undefined,
  );
  expect(nested).toContain("[f] Nº #");
  expect(nested).not.toContain('"#"');
});

test("a term is a string, its references placeholders named after it, its arguments kept as written (#990)", () => {
  const ftl = `-brand = Firefox
-brand-x = { $capitalization ->
    [upper] Firefox Relay
   *[lower] firefox relay
  }
use = Use { -brand } and { -brand-x(capitalization: "upper") }
`;
  const refused: string[] = [];
  const read = fluentToEntries(ftl, {
    type: "ui",
    onRefused: (id) => refused.push(id),
  });
  expect(refused).toEqual([]);
  expect(read.map((e) => [e.id, e.source])).toEqual([
    ["-brand", "Firefox"],
    [
      "-brand-x",
      "{capitalization, select, upper {Firefox Relay} lower {firefox relay} other {firefox relay}}",
    ],
    ["use", 'Use {-brand} and {-brand-x(capitalization: "upper")}'],
  ]);
  const same = Object.fromEntries(read.map((e) => [e.id, e.source]));
  expect(entriesToFluent(ftl, same, ftl)).toBe(ftl);
  const out = entriesToFluent(
    ftl,
    {
      "-brand": "Firefoxu",
      use: 'Use {-brand-x(case: "gen")} e {-brand}',
    },
    ftl,
  );
  expect(out).toContain("-brand = Firefoxu\n");
  expect(out).toContain('use = Use { -brand-x(case: "gen") } e { -brand }\n');
});

test("a term's attributes are kept, never strings, and a select on one reads as a select on -term.attr (#990)", () => {
  const cs = `-brand = Relay
    .gender = masculine
gone = { -brand.gender ->
    [masculine] Byl pryč
   *[other] Bylo pryč
  }
`;
  const read = fluentToEntries(cs, { type: "ui" });
  expect(read.map((e) => [e.id, e.source])).toEqual([
    ["-brand", "Relay"],
    ["gone", "{-brand.gender, select, masculine {Byl pryč} other {Bylo pryč}}"],
  ]);
  const out = entriesToFluent(
    cs,
    {
      "-brand": "Relayi",
      gone: "{-brand.gender, select, masculine {Byl odstraněn} other {Bylo odstraněno}}",
    },
    cs,
  );
  expect(out).toBe(`-brand = Relayi
    .gender = masculine
gone = { -brand.gender ->
    [masculine] Byl odstraněn
   *[other] Bylo odstraněno
  }
`);
  // A message's attributes, a term reference as a selector, and a
  // message attribute as a placeable are still refused.
  const refused: string[] = [];
  fluentToEntries(
    "a = A\n    .title = T\nb = { -brand ->\n    *[x] y\n  }\nc = { a.title }\n",
    { type: "ui", onRefused: (id) => refused.push(id) },
  );
  expect(refused).toEqual(["a", "b", "c"]);
});

test("a select on a term's attribute is never a plural; a # in a term's argument is no count (#990 review)", () => {
  const ftl = `a = { -brand.gender ->
    [one] Byl
   *[other] Bylo
  }
b = { $n ->
    [one] { -brand(x: "#1") } x
   *[other] y
  }
c = Use { -brand (case: "gen") } now
`;
  const read = Object.fromEntries(
    fluentToEntries(ftl, { type: "ui" }).map((e) => [e.id, e.source]),
  );
  expect(read.a).toBe("{-brand.gender, select, one {Byl} other {Bylo}}");
  expect(read.b).toBe('{n, plural, one {{-brand(x: "#1")} x} other {y}}');
  expect(read.c).toBe('Use {-brand(case: "gen")} now');
  const out = entriesToFluent(
    ftl,
    {
      a: "{-brand.gender, select, one {Byl} other {Bylo #}}",
      b: '{n, plural, one {{-brand(x: "#1")} z} other {y}}',
    },
    ftl,
  );
  expect(out).toContain("*[other] Bylo #\n");
  expect(out).toContain('[one] { -brand(x: "#1") } z\n');
});

test("a new target file takes a term's value, not the source's attributes (#990 review)", () => {
  const en = "-brand = Relay\n    .gender = masculine\nhi = Hi { -brand }\n";
  expect(
    entriesToFluent(
      en,
      { "-brand": "Relais", hi: "Salut {-brand}" },
      undefined,
    ),
  ).toBe("-brand = Relais\nhi = Salut { -brand }\n");
});

test("NUMBER() and DATETIME() read as ICU formats, options kept as the style, and write back as Fluent's functions (#990)", () => {
  const ftl = `left = { NUMBER($remaining_seconds, minimumIntegerDigits: 2) } s
count = { NUMBER($n) } items
when = On { DATETIME($d, month: "long", day: "numeric") }
day = On { DATETIME($d) }
`;
  const refused: string[] = [];
  const read = Object.fromEntries(
    fluentToEntries(ftl, {
      type: "ui",
      onRefused: (id) => refused.push(id),
    }).map((e) => [e.id, e.source]),
  );
  expect(refused).toEqual([]);
  expect(read).toEqual({
    left: "{remaining_seconds, number, minimumIntegerDigits: 2} s",
    count: "{n, number} items",
    when: 'On {d, date, month: "long", day: "numeric"}',
    day: "On {d, date}",
  });
  expect(entriesToFluent(ftl, read, ftl)).toBe(ftl);
  const out = entriesToFluent(
    ftl,
    {
      left: "{remaining_seconds, number, minimumIntegerDigits: 3} s restantes",
      count: "{n, number} elementos",
      when: 'Em {d, date, day: "numeric", month: "long"}',
      day: "Em {d, date}",
    },
    ftl,
  );
  expect(out)
    .toBe(`left = { NUMBER($remaining_seconds, minimumIntegerDigits: 3) } s restantes
count = { NUMBER($n) } elementos
when = Em { DATETIME($d, day: "numeric", month: "long") }
day = Em { DATETIME($d) }
`);
  // Any other function, a function on a literal, and a function as a
  // selector are still refused.
  const still: string[] = [];
  fluentToEntries(
    'a = { PLATFORM() }\nb = { NUMBER(5) }\nc = { NUMBER($n) ->\n   *[other] x\n  }\nd = { NUMBER($n, x: "{") }\n',
    { type: "ui", onRefused: (id) => still.push(id) },
  );
  expect(still).toEqual(["a", "b", "c", "d"]);
});

test("a # in a format's option within a plural's variant is no count; only spaces may precede a call (#990 review)", () => {
  const ftl = `a = { $n ->
    [one] { NUMBER($n, x: "#") } y
   *[other] z
  }
b = { NUMBER\t($n) }
`;
  const refused: string[] = [];
  const read = Object.fromEntries(
    fluentToEntries(ftl, {
      type: "ui",
      onRefused: (id) => refused.push(id),
    }).map((e) => [e.id, e.source]),
  );
  expect(read.a).toBe('{n, plural, one {{n, number, x: "#"} y} other {z}}');
  expect(refused).toEqual(["b"]);
});

test("a select whose only variant is the default reads as that variant's text (#1032)", () => {
  const ftl = "account = { $capitalization ->\n   *[other] Konto\n  }\n";
  expect(fluentToEntries(ftl, { type: "ui" })[0]!.source).toBe("Konto");
  expect(entriesToFluent(ftl, { account: "Konto" }, ftl)).toBe(ftl);
});
