import { expect, test } from "vitest";
import { validateTranslation } from "./validate";
import {
  branchingNodes,
  parseIcu,
  placeholdersOf,
  pluralArgsOf,
  pluralBranch,
  pluralCategoriesOf,
  selectArgsOf,
  tagsOf,
  isVoidTag,
  refusalAdvice,
  placeholderWrittenOf,
} from "./icu";

const SIGHTING =
  "{person} foi {person_gender, select, m {visto} f {vista}} à janela {room_de} às {hour} — e não estava {person_gender, select, m {sozinho} f {sozinha}}.";

test("parses the §5 sighting string into the expected tree", () => {
  const result = parseIcu(SIGHTING);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const kinds = result.nodes.map((n) => n.kind);
  expect(kinds).toEqual([
    "placeholder",
    "literal",
    "select",
    "literal",
    "placeholder",
    "literal",
    "placeholder",
    "literal",
    "select",
    "literal",
  ]);
  const select = result.nodes[2];
  if (select?.kind !== "select") throw new Error("expected select");
  expect(select.arg).toBe("person_gender");
  expect(Object.keys(select.branches)).toEqual(["m", "f"]);
  expect(select.branches.m).toEqual([{ kind: "literal", text: "visto" }]);
});

test("plain text is a single literal", () => {
  const result = parseIcu("Corpus");
  if (!result.ok) throw new Error("expected ok");
  expect(result.nodes).toEqual([{ kind: "literal", text: "Corpus" }]);
});

test("select branches may contain placeholders", () => {
  const result = parseIcu("{g, select, m {seu {item}} f {sua {item}}}");
  if (!result.ok) throw new Error("expected ok");
  const select = result.nodes[0];
  if (select?.kind !== "select") throw new Error("expected select");
  expect(select.branches.m).toEqual([
    { kind: "literal", text: "seu " },
    { kind: "placeholder", name: "item" },
  ]);
});

test.each([
  ["plural without other", "{n, plural, one {# item}}", /other/],
  ["nested select", "{a, select, x {{b, select, y {t}}}}", /nest/i],
  ["unbalanced open brace", "olá {name", /unclosed|unbalanced/i],
  ["stray close brace", "olá } mundo", /unmatched/i],
  ["empty placeholder name", "olá {}", /name/i],
  ["invalid placeholder name", "olá {two words}", /name/i],
  ["a name that starts with a digit but is not a number", "olá {1a}", /name/i],
  ["select without branches", "{g, select,}", /branch/i],
  ["unknown argument type", "{n, foo}", /select|supported/i],
])("rejects %s with a specific error", (_label, source, pattern) => {
  const result = parseIcu(source);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]?.message).toMatch(pattern);
    expect(result.errors[0]?.position).toBeTypeOf("number");
  }
});

test("error positions point at the offending syntax", () => {
  const result = parseIcu("abc {n, plural, one {x}}");
  if (result.ok) throw new Error("expected failure");
  expect(result.errors[0]?.position).toBe(4);
});

test("placeholdersOf collects placeholder names, including inside branches", () => {
  expect(placeholdersOf(SIGHTING)).toEqual(
    new Set(["person", "room_de", "hour"]),
  );
  expect(placeholdersOf("{g, select, m {seu {item}} f {sua {coisa}}}")).toEqual(
    new Set(["item", "coisa"]),
  );
});

test("selectArgsOf collects select argument names", () => {
  expect(selectArgsOf(SIGHTING)).toEqual(new Set(["person_gender"]));
  expect(selectArgsOf("plain")).toEqual(new Set());
});

test("braces are structural: no ICU quote-escaping in the v1 subset", () => {
  const result = parseIcu("it''s {name}");
  if (!result.ok) throw new Error("expected ok");
  expect(result.nodes[0]).toEqual({ kind: "literal", text: "it''s " });
});

test("a select branch key may be a number", () => {
  const result = parseIcu(
    "{n, select, 1 {falta 1 marca} other {faltam {n} marcas}}",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  const select = result.nodes.find((n) => n.kind === "select");
  expect(
    select && select.kind === "select" && Object.keys(select.branches),
  ).toEqual(["1", "other"]);
});

test("a select branch key is a word or a number, nothing in between", () => {
  expect(parseIcu("{n, select, 12abc {x} other {y}}").ok).toBe(false);
  expect(parseIcu("{n, select, 0 {x} other {y}}").ok).toBe(true);
  // A numeric argument name is ICU; a digit-led word is not a name.
  expect(parseIcu("{1, select, one {x} other {y}}").ok).toBe(true);
  expect(parseIcu("{1a, select, one {x} other {y}}").ok).toBe(false);
});

test("a plural parses with categories, =N exact branches and # for the count", () => {
  const result = parseIcu(
    "{n, plural, =0 {Nenhuma marca.} one {Falta # marca.} other {Faltam # marcas.}}",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes).toEqual([
    {
      kind: "plural",
      arg: "n",
      branches: {
        "=0": [{ kind: "literal", text: "Nenhuma marca." }],
        one: [
          { kind: "literal", text: "Falta " },
          { kind: "count", arg: "n" },
          { kind: "literal", text: " marca." },
        ],
        other: [
          { kind: "literal", text: "Faltam " },
          { kind: "count", arg: "n" },
          { kind: "literal", text: " marcas." },
        ],
      },
    },
  ]);
  expect([...pluralArgsOf("{n, plural, one {#} other {#}} {m}")]).toEqual([
    "n",
  ]);
});

test("# outside a plural branch is text; a plural needs other and known keys; plurals cannot nest", () => {
  const plain = parseIcu("Ticket #{n} {g, select, m {#} other {#}}");
  expect(plain.ok).toBe(true);
  if (!plain.ok) throw new Error("parse failed");
  expect(plain.nodes[0]).toEqual({ kind: "literal", text: "Ticket #" });
  const select = plain.nodes.find((node) => node.kind === "select");
  expect(select?.kind === "select" && select.branches.m).toEqual([
    { kind: "literal", text: "#" },
  ]);
  expect(parseIcu("{n, plural, one {x}}")).toMatchObject({
    ok: false,
    errors: [{ message: "plural needs an other branch" }],
  });
  expect(parseIcu("{n, plural, some {x} other {y}}")).toMatchObject({
    ok: false,
    errors: [
      { message: expect.stringMatching(/invalid plural branch key "some"/) },
    ],
  });
  expect(parseIcu("{n, plural, 1 {x} other {y}}").ok).toBe(false);
  expect(
    parseIcu("{n, plural, one {{m, plural, other {y}}} other {z}}"),
  ).toMatchObject({
    ok: false,
    errors: [{ message: "plurals cannot nest" }],
  });
  expect(
    parseIcu("{n, plural, one {{g, select, m {a} f {b}}} other {z}}"),
  ).toMatchObject({
    ok: false,
    errors: [{ message: "selects cannot nest" }],
  });
});

test("pluralCategoriesOf follows the runtime's CLDR data and is empty for an unknown tag; pluralBranch picks exact, then category, then other", () => {
  expect(pluralCategoriesOf("en")).toEqual(["one", "other"]);
  expect(pluralCategoriesOf("ja")).toEqual(["other"]);
  expect(pluralCategoriesOf("not a tag")).toEqual([]);
  // A well-formed tag the runtime has no data for is unknown too.
  expect(pluralCategoriesOf("tlh")).toEqual([]);
  expect(pluralCategoriesOf("ru")).toEqual(["one", "few", "many", "other"]);
  // An underscore code is the same language to the runtime.
  expect(pluralCategoriesOf("ru_RU")).toEqual(["one", "few", "many", "other"]);
  expect(pluralBranch({ few: [], other: [] }, "3", "ru_RU")).toBe("few");
  expect(pluralBranch({ one: [], other: [] }, "1", "tlh")).toBe("other");
  const branches = { "=0": [], one: [], few: [], other: [] };
  expect(pluralBranch(branches, "0", "ru")).toBe("=0");
  expect(pluralBranch(branches, "1", "ru")).toBe("one");
  expect(pluralBranch(branches, "3", "ru")).toBe("few");
  expect(pluralBranch(branches, "3", "en")).toBe("other");
  expect(pluralBranch(branches, "many", "en")).toBe("other");
});

test("rich-text tags parse as nodes with their children, nest, and self-close; a lone < is text", () => {
  const result = parseIcu(
    "By continuing you accept the <link>terms of <b>use</b></link>. <icon/> a < b",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes).toEqual([
    { kind: "literal", text: "By continuing you accept the " },
    {
      kind: "tag",
      name: "link",
      children: [
        { kind: "literal", text: "terms of " },
        {
          kind: "tag",
          name: "b",
          children: [{ kind: "literal", text: "use" }],
        },
      ],
    },
    { kind: "literal", text: ". " },
    { kind: "tag", name: "icon", children: [] },
    { kind: "literal", text: " a < b" },
  ]);
  expect([...tagsOf("Received {n} from <url></url>. <checkoutDocs/>")]).toEqual(
    ["url", "checkoutDocs"],
  );
  // A tag may hold a placeholder and sit inside a branch.
  const inside = parseIcu("{g, select, m {<b>{name}</b>} other {{name}}}");
  expect(inside.ok).toBe(true);
});

test("a tag name may be a number, as react-i18next indexes Trans children", () => {
  const result = parseIcu("Shared by <2>{name}</2> <0/>");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes).toEqual([
    { kind: "literal", text: "Shared by " },
    {
      kind: "tag",
      name: "2",
      children: [{ kind: "placeholder", name: "name" }],
    },
    { kind: "literal", text: " " },
    { kind: "tag", name: "0", children: [] },
  ]);
  expect(parseIcu("<2>x")).toMatchObject({
    ok: false,
    errors: [{ message: "unclosed <2>" }],
  });
  expect(
    validateTranslation(
      "Shared by <2>{name}</2>",
      "Partilhado por {name}",
      "pt-PT",
    ),
  ).toMatchObject({ ok: false, errors: [{ code: "missing-tag", name: "2" }] });
  // i18next's own strings write the same tags.
  expect([...tagsOf("Shared by <2>{{ name }}</2>", "i18next")]).toEqual(["2"]);
});

test("a tag keeps its attribute text as its identity, and a void tag opens nothing (#590)", () => {
  const source =
    'See <a href="%s" target="_blank">the docs</a>, or <code id="branch_target">main</code>.<br>Then <b>go</b>.';
  const result = parseIcu(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes.filter((n) => n.kind === "tag")).toEqual([
    {
      kind: "tag",
      name: "a",
      attrs: 'href="%s" target="_blank"',
      children: [{ kind: "literal", text: "the docs" }],
    },
    {
      kind: "tag",
      name: "code",
      attrs: 'id="branch_target"',
      children: [{ kind: "literal", text: "main" }],
    },
    { kind: "tag", name: "br", children: [] },
    { kind: "tag", name: "b", children: [{ kind: "literal", text: "go" }] },
  ]);
  expect([...tagsOf(source)]).toEqual([
    'a href="%s" target="_blank"',
    'code id="branch_target"',
    "br",
    "b",
  ]);
  expect(isVoidTag("br")).toBe(true);
  expect(isVoidTag("b")).toBe(false);
  // Spaces inside the brackets are the attribute text's; a self-closing
  // attributed tag closes itself; a closing tag with attributes is text.
  expect(parseIcu('<img src="x" />').ok).toBe(true);
  expect(parseIcu("<a >x</a>")).toMatchObject({
    ok: true,
    nodes: [{ kind: "tag", name: "a" }],
  });
  expect(parseIcu("x </a href> y").ok).toBe(true);
  expect(parseIcu("one<br>two")).toMatchObject({ ok: true });
  expect(parseIcu("one<br/>two")).toMatchObject({ ok: true });
  expect(parseIcu("one</br>two")).toMatchObject({
    ok: false,
    errors: [{ message: "unexpected </br>" }],
  });
  expect(refusalAdvice("one</br>two", "icu", "unexpected </br>")).toContain(
    "<br> needs no closing tag: remove it",
  );
  // A name followed by a run of whitespace and no close is text, read
  // in linear time: the attribute group must not overlap the spaces.
  const started = Date.now();
  expect(parseIcu("<a" + " ".repeat(20000)).ok).toBe(true);
  expect(parseIcu("<a" + " ".repeat(20000) + "x").ok).toBe(true);
  expect(Date.now() - started).toBeLessThan(500);
});

test("chrome: $NAME$ is a placeholder named case-insensitively, $$ is a dollar, and braces, brackets and % are text (#595)", () => {
  const source =
    "Hi $USER$, $$5 for {one} <b>%s</b> at $Site$; a lone $ and $not a name";
  const result = parseIcu(source, "chrome");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes).toEqual([
    { kind: "literal", text: "Hi " },
    { kind: "placeholder", name: "user", written: "$USER$" },
    { kind: "literal", text: ", $5 for {one} <b>%s</b> at " },
    { kind: "placeholder", name: "site", written: "$Site$" },
    { kind: "literal", text: "; a lone $ and $not a name" },
  ]);
  expect([...placeholdersOf(source, "chrome")]).toEqual(["user", "site"]);
  expect([...placeholderWrittenOf(source, "chrome")]).toEqual([
    ["user", "$USER$"],
    ["site", "$Site$"],
  ]);
});

test("android: printf verbs and tags, a plural on quantity whose branches each count their verbs from 1, and # as text (#596)", () => {
  const source = "Logged in as %1$s on <b>%2$s</b>, 100%% sure";
  expect([...placeholderWrittenOf(source, "android")]).toEqual([
    ["1", "%1$s"],
    ["2", "%2$s"],
  ]);
  expect([...tagsOf(source, "android")]).toEqual(["b"]);
  const plural =
    "{quantity, plural, one {%d episode #1} other {%d episodes in %s}}";
  const parsed = parseIcu(plural, "android");
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error("parse failed");
  expect(parsed.nodes).toEqual([
    {
      kind: "plural",
      arg: "quantity",
      branches: {
        one: [
          { kind: "placeholder", name: "1", written: "%d" },
          { kind: "literal", text: " episode #1" },
        ],
        other: [
          { kind: "placeholder", name: "1", written: "%d" },
          { kind: "literal", text: " episodes in " },
          { kind: "placeholder", name: "2", written: "%s" },
        ],
      },
    },
  ]);
  expect(parseIcu("<i>unclosed %s", "android").ok).toBe(false);
});

test("printf: verbs are placeholders named by position, %% is a percent, and braces and brackets are text (#594)", () => {
  const source =
    'Pushed %d commits to <a href="%s">%s</a>: 100%% done, {not} an argument';
  const result = parseIcu(source, "printf");
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect(result.nodes).toEqual([
    { kind: "literal", text: "Pushed " },
    { kind: "placeholder", name: "1", written: "%d" },
    { kind: "literal", text: ' commits to <a href="' },
    { kind: "placeholder", name: "2", written: "%s" },
    { kind: "literal", text: '">' },
    { kind: "placeholder", name: "3", written: "%s" },
    { kind: "literal", text: "</a>: 100% done, {not} an argument" },
  ]);
  expect([...placeholdersOf(source, "printf")]).toEqual(["1", "2", "3"]);
  expect([...placeholderWrittenOf(source, "printf")]).toEqual([
    ["1", "%d"],
    ["2", "%s"],
    ["3", "%s"],
  ]);
  // Go's %[n] and C's %n$ name the position; an unindexed verb after
  // one continues from it, as Go reads it. Flags, width and precision
  // ride with the verb.
  expect([
    ...placeholderWrittenOf("%[2]s then %s and %1$d, %-8.2f", "printf"),
  ]).toEqual([
    ["2", "%[2]s"],
    ["3", "%s"],
    ["1", "%1$d"],
  ]);
  expect([
    ...placeholdersOf("%[2]s then %s and %1$d, %-8.2f", "printf"),
  ]).toEqual(["2", "3", "1"]);
  // A % that opens no verb is text, never a refusal.
  expect(parseIcu("50% off, 100 % and %", "printf")).toMatchObject({
    ok: true,
    nodes: [{ kind: "literal", text: "50% off, 100 % and %" }],
  });
  expect([...tagsOf('<a href="%s">x</a>', "printf")]).toEqual([]);
});

test("printf: a C length modifier rides with the verb, and %@ is Objective-C's object verb (#614)", () => {
  expect([
    ...placeholderWrittenOf(
      "%ld of %lu, %zu bytes, %lld ms, %hhd, %5.2Lf",
      "printf",
    ),
  ]).toEqual([
    ["1", "%ld"],
    ["2", "%lu"],
    ["3", "%zu"],
    ["4", "%lld"],
    ["5", "%hhd"],
    ["6", "%5.2Lf"],
  ]);
  expect([...placeholderWrittenOf("%2$@ by %@", "printf")]).toEqual([
    ["2", "%2$@"],
    ["3", "%@"],
  ]);
  // Go's %t and %q stay verbs of their own when no letter follows; a
  // letter after one reads as C's modifier and verb.
  expect([...placeholderWrittenOf("%t or %q, %td", "printf")]).toEqual([
    ["1", "%t"],
    ["2", "%q"],
    ["3", "%td"],
  ]);
});

test("an unclosed, mismatched or stray tag is a parse error naming it", () => {
  expect(parseIcu("<link>terms")).toMatchObject({
    ok: false,
    errors: [{ message: "unclosed <link>" }],
  });
  expect(parseIcu("<a>x</b>")).toMatchObject({
    ok: false,
    errors: [{ message: "unexpected </b>; <a> is open" }],
  });
  expect(parseIcu("x</b>")).toMatchObject({
    ok: false,
    errors: [{ message: "unexpected </b>" }],
  });
  expect(parseIcu("{g, select, m {<b>x} other {y}}")).toMatchObject({
    ok: false,
    errors: [{ message: "unclosed <b>" }],
  });
  // A stray brace inside a tag is the brace's error, as outside one.
  expect(parseIcu("<b>x}</b>")).toMatchObject({
    ok: false,
    errors: [{ message: "unmatched '}'" }],
  });
  const both = parseIcu(
    "<b>{n, plural, other {#}}</b> {g, select, m {x} other {y}}",
  );
  if (!both.ok) throw new Error("parse failed");
  expect(branchingNodes(both.nodes).map((n) => n.arg)).toEqual(["n", "g"]);
});

test("a placeholder or argument name may be a bare number, as ICU allows", () => {
  const result = parseIcu(
    "Added {0}; {1} and {2} other artists {0, select, 1 {one} other {many}}",
  );
  expect(result.ok).toBe(true);
  expect([...placeholdersOf("Added {0}; {1} and {2}")]).toEqual([
    "0",
    "1",
    "2",
  ]);
  expect([...selectArgsOf("{0, select, 1 {one} other {many}}")]).toEqual(["0"]);
});

test("i18next's unescaped form {{- name}} is its own placeholder, -name, since it escapes differently", () => {
  expect([
    ...placeholdersOf(
      "Hello {{- name}}, {{-user.name}} and {{-date, short}}",
      "i18next",
    ),
  ]).toEqual(["-name", "-user.name", "-date"]);
  expect(parseIcu("{{-}}", "i18next").ok).toBe(false);
  // i18next reads {{ - name }} as the key "- name", which is no name.
  expect(parseIcu("{{ - name }}", "i18next").ok).toBe(false);
  expect(
    validateTranslation("Hi {{- name}}", "Olá {{name}}", "pt-PT", "i18next"),
  ).toMatchObject({
    ok: false,
    errors: [
      { code: "missing-placeholder", name: "-name" },
      { code: "unexpected-placeholder", name: "name" },
    ],
  });
  expect(
    validateTranslation("Hi {{- name}}", "Olá {{-name}}", "pt-PT", "i18next")
      .ok,
  ).toBe(true);
});

test("i18next syntax: {{name}} is a placeholder, a single brace is text, there are no arguments", () => {
  const result = parseIcu(
    "{{ count }} documents starred by {{user.name}} on {{date, short}} {not a placeholder} and #1 <em>{{ templateName }}</em>",
    "i18next",
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("parse failed");
  expect([
    ...placeholdersOf(
      "{{ count }} documents starred by {{user.name}} on {{date, short}} {not a placeholder} and #1 <em>{{ templateName }}</em>",
      "i18next",
    ),
  ]).toEqual(["count", "user.name", "date", "templateName"]);
  expect(
    result.nodes.some(
      (n) => n.kind === "literal" && n.text.includes("{not a placeholder}"),
    ),
  ).toBe(true);
  expect(result.nodes.some((n) => n.kind === "tag" && n.name === "em")).toBe(
    true,
  );
  expect([...placeholdersOf("{{ count }} and {{count}}", "i18next")]).toEqual([
    "count",
  ]);
  expect(parseIcu("open {{name", "i18next")).toMatchObject({
    ok: false,
    errors: [{ message: "unclosed '{{'" }],
  });
  expect(parseIcu("{{ two words }}", "i18next")).toMatchObject({
    ok: false,
    errors: [{ message: expect.stringMatching(/invalid placeholder name/) }],
  });
  // The same text under ICU is an error, so the syntax is not optional.
  expect(parseIcu("{{ count }} items", "icu").ok).toBe(false);
});
