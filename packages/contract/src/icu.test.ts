import { expect, test } from "vitest";
import { validateTranslation } from "./validate";
import {
  branchingNodes,
  partsOf,
  parseIcu,
  pluralBranch,
  pluralCategoriesFor,
  pluralCategoriesOf,
  isVoidTag,
  refusalAdvice,
  refusalCause,
  printfPluralError,
  sameMessage,
} from "./icu";
import { LIBRARIES, libraryName, type Library } from "./strings";

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

test("a text's placeholders are collected, including inside branches", () => {
  expect(partsOf(SIGHTING).placeholders).toEqual(
    new Set(["person", "room_de", "hour"]),
  );
  expect(
    partsOf("{g, select, m {seu {item}} f {sua {coisa}}}").placeholders,
  ).toEqual(new Set(["item", "coisa"]));
});

test("a text's select arguments are collected", () => {
  expect(partsOf(SIGHTING).selects).toEqual(new Set(["person_gender"]));
  expect(partsOf("plain").selects).toEqual(new Set());
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
  expect([...partsOf("{n, plural, one {#} other {#}} {m}").plurals]).toEqual([
    "n",
  ]);
});

test("# outside a plural branch is text; a plural needs other and known keys", () => {
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
});

test("a plural may sit in a select's branch and a select in a plural's, one level deep (#764)", () => {
  const inSelect = parseIcu(
    "{g, select, f {{n, plural, one {# her} other {# hers}}} other {{n, plural, one {#} other {#}}}}",
  );
  expect(inSelect.ok).toBe(true);
  if (!inSelect.ok) throw new Error("parse failed");
  const outer = inSelect.nodes[0];
  expect(outer?.kind === "select" && outer.branches.f).toEqual([
    {
      kind: "plural",
      arg: "n",
      branches: {
        one: [
          { kind: "count", arg: "n" },
          { kind: "literal", text: " her" },
        ],
        other: [
          { kind: "count", arg: "n" },
          { kind: "literal", text: " hers" },
        ],
      },
    },
  ]);
  // `#` is the nearest plural's count, and text in a select within one,
  // as ICU and FormatJS read it.
  const inPlural = parseIcu(
    "{n, plural, one {<b>{g, select, f {#} other {x}}</b>} other {#}}",
  );
  expect(inPlural.ok).toBe(true);
  if (!inPlural.ok) throw new Error("parse failed");
  const plural = inPlural.nodes[0];
  expect(plural?.kind === "plural" && plural.branches.one).toEqual([
    {
      kind: "tag",
      name: "b",
      children: [
        {
          kind: "select",
          arg: "g",
          branches: {
            f: [{ kind: "literal", text: "#" }],
            other: [{ kind: "literal", text: "x" }],
          },
        },
      ],
    },
  ]);
  expect(
    parseIcu("{n, plural, one {{m, plural, other {y}}} other {z}}"),
  ).toMatchObject({
    ok: false,
    errors: [{ message: "a plural cannot nest in a plural's branch" }],
  });
  expect(
    parseIcu("{g, select, m {{h, select, a {x} other {y}}} other {z}}"),
  ).toMatchObject({
    ok: false,
    errors: [{ message: "a select cannot nest in a select's branch" }],
  });
  // An Android plural item is a string, with no select in it.
  expect(
    parseIcu(
      "{quantity, plural, one {{g, select, m {%d} other {%d}}} other {%d}}",
      "android",
    ),
  ).toMatchObject({ ok: false, errors: [{ message: "selects cannot nest" }] });
  expect(
    parseIcu(
      "{g, select, m {{n, plural, other {{h, select, a {x} other {y}}}}} other {z}}",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        message:
          "select and plural nest one level deep: this select is inside a plural inside a select",
      },
    ],
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
    { kind: "tag", name: "icon", children: [], self: true },
    { kind: "literal", text: " a < b" },
  ]);
  expect([
    ...partsOf("Received {n} from <url></url>. <checkoutDocs/>").tags,
  ]).toEqual(["url", "checkoutDocs"]);
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
    { kind: "tag", name: "0", children: [], self: true },
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
  expect([...partsOf("Shared by <2>{{ name }}</2>", "i18next").tags]).toEqual([
    "2",
  ]);
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
  expect([...partsOf(source).tags]).toEqual([
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
  // The advice never tells a pair to drop its close (#643).
  expect(refusalAdvice("one</br>two", "icu", "unexpected </br>")).toContain(
    "remove it, or open a matching <br>",
  );
  expect(parseIcu(source, "icu", { html: false })).toMatchObject({
    ok: false,
  });
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
  expect([...partsOf(source, "chrome").placeholders]).toEqual(["user", "site"]);
  expect([...partsOf(source, "chrome").written]).toEqual([
    ["user", "$USER$"],
    ["site", "$Site$"],
  ]);
});

test("android: printf verbs and tags, a plural on quantity whose branches each count their verbs from 1, and # as text (#596)", () => {
  const source = "Logged in as %1$s on <b>%2$s</b>, 100%% sure";
  expect([...partsOf(source, "android").written]).toEqual([
    ["1", "%1$s"],
    ["2", "%2$s"],
  ]);
  expect([...partsOf(source, "android").tags]).toEqual(["b"]);
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
  expect([...partsOf(source, "printf").placeholders]).toEqual(["1", "2", "3"]);
  expect([...partsOf(source, "printf").written]).toEqual([
    ["1", "%d"],
    ["2", "%s"],
    ["3", "%s"],
  ]);
  // Go's %[n] and C's %n$ name the position; an unindexed verb after
  // one continues from it, as Go reads it. Flags, width and precision
  // ride with the verb.
  expect([
    ...partsOf("%[2]s then %s and %1$d, %-8.2f", "printf").written,
  ]).toEqual([
    ["2", "%[2]s"],
    ["3", "%s"],
    ["1", "%1$d"],
  ]);
  expect([
    ...partsOf("%[2]s then %s and %1$d, %-8.2f", "printf").placeholders,
  ]).toEqual(["2", "3", "1"]);
  // A % that opens no verb is text, never a refusal.
  expect(parseIcu("50% off, 100 % and %", "printf")).toMatchObject({
    ok: true,
    nodes: [{ kind: "literal", text: "50% off, 100 % and %" }],
  });
  expect([...partsOf('<a href="%s">x</a>', "printf").tags]).toEqual([]);
});

test("printf: a C length modifier rides with the verb, and %@ is Objective-C's object verb (#614)", () => {
  expect([
    ...partsOf("%ld of %lu, %zu bytes, %lld ms, %hhd, %5.2Lf", "printf")
      .written,
  ]).toEqual([
    ["1", "%ld"],
    ["2", "%lu"],
    ["3", "%zu"],
    ["4", "%lld"],
    ["5", "%hhd"],
    ["6", "%5.2Lf"],
  ]);
  expect([...partsOf("%2$@ by %@", "printf").written]).toEqual([
    ["2", "%2$@"],
    ["3", "%@"],
  ]);
  // Go's %t and %q stay verbs of their own when no letter follows; a
  // letter after one reads as C's modifier and verb.
  expect([...partsOf("%t or %q, %td", "printf").written]).toEqual([
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
  expect([...partsOf("Added {0}; {1} and {2}").placeholders]).toEqual([
    "0",
    "1",
    "2",
  ]);
  expect([...partsOf("{0, select, 1 {one} other {many}}").selects]).toEqual([
    "0",
  ]);
});

test("i18next's unescaped form {{- name}} is its own placeholder, -name, since it escapes differently", () => {
  expect([
    ...partsOf(
      "Hello {{- name}}, {{-user.name}} and {{-date, short}}",
      "i18next",
    ).placeholders,
  ]).toEqual(["-name", "-user.name", "-date"]);
  expect(parseIcu("{{-}}", "i18next").ok).toBe(false);
  // i18next reads {{ - name }} and {{ -name }} as the key "- name" or
  // "-name", which it prints as written: a dash that is no unescape is a
  // slip, refused, never a name to meet {{-name}} (#1008).
  expect(parseIcu("{{ - name }}", "i18next").ok).toBe(false);
  expect(parseIcu("{{ -name }}", "i18next").ok).toBe(false);
  expect(parseIcu("{{ -user.name, short }}", "i18next").ok).toBe(false);
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
    ...partsOf(
      "{{ count }} documents starred by {{user.name}} on {{date, short}} {not a placeholder} and #1 <em>{{ templateName }}</em>",
      "i18next",
    ).placeholders,
  ]).toEqual(["count", "user.name", "date", "templateName"]);
  expect(
    result.nodes.some(
      (n) => n.kind === "literal" && n.text.includes("{not a placeholder}"),
    ),
  ).toBe(true);
  expect(result.nodes.some((n) => n.kind === "tag" && n.name === "em")).toBe(
    true,
  );
  expect([
    ...partsOf("{{ count }} and {{count}}", "i18next").placeholders,
  ]).toEqual(["count"]);
  expect(parseIcu("open {{name", "i18next")).toMatchObject({
    ok: false,
    errors: [{ message: "unclosed '{{'" }],
  });
  expect(parseIcu("{{}}", "i18next")).toMatchObject({
    ok: false,
    errors: [{ message: expect.stringMatching(/invalid placeholder name/) }],
  });
  expect(parseIcu("{{ }}", "i18next").ok).toBe(false);
  // An ICU branch that opens with a placeholder, read as i18next.
  expect(parseIcu("other {{name} updated}}", "i18next").ok).toBe(false);
  // The same text under ICU is an error, so the syntax is not optional.
  expect(parseIcu("{{ count }} items", "icu").ok).toBe(false);
});

test("an i18next {{…}} that is no name is a placeholder named by its content, as i18next prints it, so a translation keeps it (#1008)", () => {
  const text =
    'Use {{template "default.message" .}} or <b>{{ define "<NAME>" }}</b>, {{name}} and {{- raw}}.';
  const result = parseIcu(text, "i18next", { html: "markup" });
  expect(result.ok).toBe(true);
  const parts = partsOf(text, "i18next");
  expect([...parts.placeholders]).toEqual([
    'template "default.message" .',
    'define "<NAME>"',
    "name",
    "-raw",
  ]);
  // The chip and the message write it as the source does.
  expect(parts.written.get('define "<NAME>"')).toBe('{{ define "<NAME>" }}');
  expect(parts.written.has("name")).toBe(false);
  // `<NAME>` inside the braces is no tag.
  expect([...parts.tags]).toEqual(["b"]);
  expect(
    validateTranslation(
      text,
      'Utilisez {{template "default.message" .}} ou <b>{{define "<NAME>"}}</b>, {{name}} et {{- raw}}.',
      "fr-FR",
      "i18next",
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation(
      'using {{ define "<NAME>" }}.',
      "en utilisant {{ définir « <NAME> » }}.",
      "fr-FR",
      "i18next",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        code: "missing-placeholder",
        name: 'define "<NAME>"',
        written: '{{ define "<NAME>" }}',
      },
      { code: "unexpected-placeholder", name: "définir « <NAME> »" },
    ],
  });
});

test("<br> opens nothing only in HTML mode, where <br></br> is one <br> as browsers read it (#643)", () => {
  expect(parseIcu("a<br></br>b", "icu", { html: false }).ok).toBe(true);
  expect(parseIcu("a<br>b", "icu", { html: false })).toMatchObject({
    ok: false,
  });
  expect(parseIcu("a<br>b", "icu").ok).toBe(true);
  expect(parseIcu("a<br></br>b", "icu").ok).toBe(true);
  expect([...partsOf("a<br></br>b").tags]).toEqual(["br"]);
  expect(parseIcu("a</br>b", "icu")).toMatchObject({ ok: false });
});

test("the lenient reading falls back to the strict one, so every source the strict reading takes has its parts read (#643)", () => {
  for (const source of ["a<br> </br>b", "<br><b>x</b></br>"]) {
    expect(parseIcu(source, "icu", { html: false }).ok).toBe(true);
    expect(parseIcu(source).ok).toBe(true);
    expect(partsOf(source).tags.has("br")).toBe(true);
  }
  // An unclosed void tag is advised as self-closing, never as </br>,
  // which a browser renders as a second line break.
  expect(refusalAdvice("a<br>b", "icu", "unclosed <br>")).toContain("<br/>");
  expect(refusalAdvice("a<br>b", "icu", "unclosed <br>")).not.toContain(
    "</br>",
  );
  // Void names are HTML's, which ignores case.
  expect(parseIcu("a<BR>b", "icu").ok).toBe(true);
});

test("vue: angle brackets are text, since vue-i18n has no tag syntax (#644)", () => {
  const source = "Replace <access token> with your token, <b>now</b>";
  const parsed = parseIcu(source, "vue");
  expect(parsed.ok).toBe(true);
  expect([...partsOf(source, "vue").tags]).toEqual([]);
  expect(
    validateTranslation(
      source,
      "Ersetze <access token> durch dein Token",
      "de",
      "vue",
    ),
  ).toEqual({ ok: true });
});

test("each library has a name for messages (#644)", () => {
  expect(LIBRARIES.map(libraryName)).toEqual([
    "ICU",
    "i18next",
    "vue-i18n",
    "printf",
    "Chrome i18n",
    "Android",
    "counterpart",
    "easy_localization",
    "Rails I18n",
    "Qt",
    "FormatJS",
    "gen-l10n",
    "fmt",
    "Fluent",
  ]);
});

test("a {} refused under another library advises easy_localization, and counts toward the stop (#664)", () => {
  const message = 'invalid placeholder name ""';
  expect(refusalAdvice("{} files", "icu", message)).toMatch(
    /declare library: "easy_localization"/,
  );
  expect(refusalCause("{} files", "vue", message)).toBe("library");
});

test("a nested argument is listed once, and branchingNodes reaches it unless told to stay at the top (#765)", () => {
  const source =
    "{g, select, female {{n, plural, one {# {what}} other {# {what}s}}} other {{n, plural, other {# {what}s}}}}";
  expect([...partsOf(source).selects]).toEqual(["g"]);
  expect([...partsOf(source).plurals]).toEqual(["n"]);
  expect([...partsOf(source).placeholders]).toEqual(["what"]);
  const parsed = parseIcu(source);
  if (!parsed.ok) throw new Error("parse failed");
  expect(branchingNodes(parsed.nodes).map((n) => n.arg)).toEqual([
    "g",
    "n",
    "n",
  ]);
  expect(branchingNodes(parsed.nodes, false).map((n) => n.arg)).toEqual(["g"]);
});

// Linear time, not a speed (#1136): eight times the input takes about
// eight times as long, under 24 where a quadratic pass takes 64, a gap
// wider than a CI runner's noise, which crossed 8 at four times (#1156).
// Timed in the process's CPU time, which a loaded runner's other work
// does not add to, the best of five runs of each size taken in turn
// after a warm run of both, so neither is timed before the code is
// optimised.
function linear(
  make: (n: number) => string,
  n: number,
  f: (text: string) => unknown,
) {
  const cpu = (text: string) => {
    const start = process.cpuUsage();
    f(text);
    const { user, system } = process.cpuUsage(start);
    return (user + system) / 1000;
  };
  const small = make(n);
  const large = make(8 * n);
  f(large);
  f(small);
  const ratio = () => {
    let fastSmall = Infinity;
    let fastLarge = Infinity;
    for (let i = 0; i < 5; i++) {
      fastSmall = Math.min(fastSmall, cpu(small));
      fastLarge = Math.min(fastLarge, cpu(large));
    }
    return fastLarge / Math.max(fastSmall, 1);
  };
  // A collection mid-run can double one reading; a quadratic pass
  // crosses the line every time, so a second reading decides one that
  // crosses by little.
  const first = ratio();
  expect(
    first < 24 || first >= 40 ? first : Math.min(first, ratio()),
  ).toBeLessThan(24);
}

test("hostile input is read in bounded time and fails cleanly, never with a thrown error (#861)", () => {
  // The markup retry, once quadratic.
  const retried = (n: number) =>
    "<b>{g, select, a {</b>} other {x}} ".repeat(n);
  linear(retried, 750, (text) => parseIcu(text, "icu", { html: "markup" }));
  linear(retried, 750, (text) =>
    validateTranslation(text, text, "en", "icu", { richText: "html" }),
  );
  // Nesting past any catalogue: a parse failure, not a stack overflow.
  const deep = `${"<b>".repeat(5000)}x${"</b>".repeat(5000)}`;
  const read = parseIcu(deep);
  expect(read.ok).toBe(false);
  expect(validateTranslation(deep, deep).ok).toBe(false);
  // Retries the depth limit never meets: the chain inside plural
  // branches, which the step budget alone stops.
  const shallow = (n: number) =>
    `{n, plural, other {${"<b>{g, select, a {</b>} other {x}} ".repeat(150)}}} `.repeat(
      n,
    );
  linear(shallow, 3, (text) => {
    const result = parseIcu(text, "icu", { html: "markup" });
    expect(!result.ok && result.errors[0]?.message).toMatch(/too many tags/);
  });
  // A real text never nears it: one such block parses.
  expect(
    parseIcu(
      `{n, plural, other {${"<b>{g, select, a {</b>} other {x}} ".repeat(30)}}}`,
      "icu",
      {
        html: "markup",
      },
    ).ok,
  ).toBe(true);
  // The refusal's advice regex, once backtracking on long runs of spaces.
  linear(
    (n) => `{{a b}} {x${" ".repeat(n)}`,
    8000,
    (text) => parseIcu(text, "vue"),
  );
}, 20_000);

test("markup tags are paired in linear time, stray closes and opens alike (#924)", () => {
  for (const [make, n] of [
    [(n: number) => "<a></b>".repeat(n), 2150],
    [(n: number) => "<a>".repeat(n) + "</b>".repeat((n * 3) / 4), 1250],
  ] as const) {
    linear(make, n, (text) =>
      validateTranslation("<a>x</a>", text, "ru", "icu", { richText: "html" }),
    );
    linear(make, n, (text) => parseIcu(text, "icu", { html: "markup" }));
  }
  // A close pairs with the nearest open of its name; what opened inside
  // it and never closed is text.
  expect(parseIcu("<a><b>x</a>", "icu", { html: "markup" })).toMatchObject({
    ok: true,
    nodes: [
      { kind: "tag", name: "a", children: [{ kind: "literal", text: "<b>x" }] },
    ],
  });
}, 20_000);

test("counterpart's tags and vue's unclosed braces are read in linear time (#896)", () => {
  const tags = (n: number) =>
    Array.from({ length: n }, (_, i) => `<t${i}>`).join("");
  for (const [make, n, library] of [
    [(n: number) => tags(n) + tags(n), 1500, "counterpart"],
    [(n: number) => "<b>".repeat(n), 7500, "counterpart"],
    [(n: number) => "<b>x".repeat(n), 5000, "counterpart"],
    [(n: number) => "{".repeat(n), 7500, "vue"],
    [(n: number) => "{{".repeat(n), 5000, "vue"],
    [(n: number) => "{'".repeat(n), 5000, "vue"],
    [(n: number) => "|{".repeat(n), 5000, "vue"],
  ] as const) {
    linear(make, n, (text) => parseIcu(text, library));
    linear(make, n, (text) => partsOf(text, library));
  }
  // What each reads is unchanged: a bare tag with no close, a pair, and
  // a pipe kept by a quoted brace or split by a bare one.
  expect(parseIcu("<pill> and <b>x</b>", "counterpart")).toMatchObject({
    ok: true,
    nodes: [
      { kind: "tag", name: "pill", children: [] },
      { kind: "literal", text: " and " },
      { kind: "tag", name: "b", children: [{ kind: "literal", text: "x" }] },
    ],
  });
  expect(partsOf("a {'|'} b | c", "vue").forms).toBe(2);
  expect(partsOf("a {'}'} | b {x} | c", "vue").forms).toBe(3);
}, 20_000);

test("the text after a whole plural is placed after the plural as the parser reads it (#861)", () => {
  expect(
    printfPluralError(
      "{n, plural, one {%d a} other {%d b}} and {x}",
      false,
      "printf",
    )?.position,
  ).toBe(37);
  // A form's braces are its text in pairs (#1052): a lone `{` pairs
  // with the next `}`, as the writers split a form, so this is no one
  // plural, and no writer could split it either.
  for (const text of [
    "{n, plural, one {a { b} other {c}} tail",
    "{n, plural, one {'{' a} other {b}} tail",
  ])
    expect(printfPluralError(text, false, "printf")).toBeDefined();
});

test("under android a printf verb in a tag's attribute takes its place in the argument order (#956)", () => {
  for (const html of [true, "markup"] as const) {
    expect(
      parseIcu('<a href="%1$s">x</a> %2$s', "android", { html }),
    ).toMatchObject({
      ok: true,
      nodes: [
        {
          kind: "tag",
          name: "a",
          attrs: 'href="%1$s"',
          attrPlaceholders: [{ kind: "placeholder", name: "1" }],
          children: [{ kind: "literal", text: "x" }],
        },
        { kind: "literal", text: " " },
        { kind: "placeholder", name: "2" },
      ],
    });
    expect(parseIcu('<a href="%s">%s</a>', "android", { html })).toMatchObject({
      ok: true,
      nodes: [
        {
          kind: "tag",
          attrPlaceholders: [{ kind: "placeholder", name: "1" }],
          children: [{ kind: "placeholder", name: "2" }],
        },
      ],
    });
  }
  // A prose tag is text through and through, its verb counted with the
  // rest (#987).
  expect(
    parseIcu("<Unknown %s> %s", "android", { html: "markup" }),
  ).toMatchObject({
    ok: true,
    nodes: [
      { kind: "literal", text: "<Unknown " },
      { kind: "placeholder", name: "1" },
      { kind: "literal", text: "> " },
      { kind: "placeholder", name: "2" },
    ],
  });
});

test("easy_localization reads no tags, so a {} in an attribute counts in the text's order (#956)", () => {
  expect(
    parseIcu('<a href="{}">{}</a> {}', "easy_localization", { html: true }),
  ).toMatchObject({
    ok: true,
    nodes: [
      { kind: "literal", text: '<a href="' },
      { kind: "placeholder", name: "0" },
      { kind: "literal", text: '">' },
      { kind: "placeholder", name: "1" },
      { kind: "literal", text: "</a> " },
      { kind: "placeholder", name: "2" },
    ],
  });
});

test("under formatjs an apostrophe quotes a brace, a tag or a plural's #, and '' is one apostrophe, as FormatJS reads them (#1010)", () => {
  const literal = (text: string) => {
    const result = parseIcu(text, "formatjs");
    if (!result.ok) throw new Error(result.errors[0]!.message);
    return result.nodes;
  };
  expect(literal("envoyée à '{'0'}' utilisateur")).toEqual([
    { kind: "literal", text: "envoyée à {0} utilisateur" },
  ]);
  expect([
    ...partsOf("Failed to upload %'{file}'", "formatjs").placeholders,
  ]).toEqual([]);
  expect(literal("It''s {n}")).toEqual([
    { kind: "literal", text: "It's " },
    { kind: "placeholder", name: "n" },
  ]);
  expect(literal("{n, plural, one {'#' one} other {# x}}")).toEqual([
    {
      kind: "plural",
      arg: "n",
      branches: {
        one: [{ kind: "literal", text: "# one" }],
        other: [
          { kind: "count", arg: "n" },
          { kind: "literal", text: " x" },
        ],
      },
    },
  ]);
  // A # in a select within the plural is no count, so its apostrophe is
  // the character.
  expect(literal("{n, plural, other {{g, select, other {'# y}}}}")).toEqual([
    {
      kind: "plural",
      arg: "n",
      branches: {
        other: [
          {
            kind: "select",
            arg: "g",
            branches: { other: [{ kind: "literal", text: "'# y" }] },
          },
        ],
      },
    },
  ]);
  expect(literal("a '<b>x</b>' c")).toEqual([
    { kind: "literal", text: "a <b>x</b> c" },
  ]);
  // Any other apostrophe is the character; a quote never closed runs to
  // the end.
  expect(literal("don't '' it's")).toEqual([
    { kind: "literal", text: "don't ' it's" },
  ]);
  expect(literal("a'b'{n}")).toEqual([{ kind: "literal", text: "a'b{n}" }]);
  expect(literal("x '} y")).toEqual([{ kind: "literal", text: "x } y" }]);
  expect(literal("'{a''b}'")).toEqual([{ kind: "literal", text: "{a'b}" }]);
  expect(literal("{n, plural, other {it''s #}}")).toEqual([
    {
      kind: "plural",
      arg: "n",
      branches: {
        other: [
          { kind: "literal", text: "it's " },
          { kind: "count", arg: "n" },
        ],
      },
    },
  ]);
});

test("apostrophe quoting is FormatJS's alone: icu, printf, rails, i18next and fluent keep the apostrophe (#1010)", () => {
  expect([...partsOf("l'%{name}", "rails").placeholders]).toEqual(["name"]);
  expect([...partsOf("l'{{name}}", "i18next").placeholders]).toEqual(["name"]);
  expect([...partsOf("l'%s", "printf").placeholders]).toEqual(["1"]);
  expect([...partsOf("l'{name}", "fluent").placeholders]).toEqual(["name"]);
  expect([...partsOf("l'{name}", "icu").placeholders]).toEqual(["name"]);
  expect([...partsOf("l'{name}", "formatjs").placeholders]).toEqual([]);
  // A quoted pair is the same message as the source it quotes nothing of.
  expect(
    sameMessage(
      "{n, plural, one {'#' a} other {'#' b}}",
      "{n, plural, one {'{n,number}' a} other {'{n,number}' b}}",
      "formatjs",
    ),
  ).toBe(false);
  expect(
    sameMessage(
      "{n, plural, one {# a} other {# b}}",
      "{n, plural, one {{n, number} a} other {{n, number} b}}",
      "formatjs",
    ),
  ).toBe(true);
});

test("a plural requires the categories some integer reaches, and allows those older CLDR had (#997)", () => {
  // French, Spanish, Italian, Portuguese and Catalan `many` is for exact
  // millions alone, Czech and Slovak `many` for decimals alone.
  for (const language of ["fr", "es", "it", "pt", "ca"]) {
    const rules = pluralCategoriesFor(language, "icu");
    expect(rules.required).toEqual(["one", "other"]);
    expect(rules.allowed).toContain("many");
  }
  expect(pluralCategoriesFor("cs", "icu").required).toEqual([
    "one",
    "few",
    "other",
  ]);
  expect(pluralCategoriesFor("cs", "icu").allowed).toContain("many");
  // An integer reaches Polish and Russian `many`.
  expect(pluralCategoriesFor("pl", "icu").required).toEqual([
    "one",
    "few",
    "many",
    "other",
  ]);
  // Hebrew `many`, which CLDR 42 removed and Android 6–13 still picks.
  expect(pluralCategoriesFor("he", "icu").required).not.toContain("many");
  expect(pluralCategoriesFor("he", "icu").allowed).toContain("many");
  // A source's own forms still decide where it has them.
  expect(
    pluralCategoriesFor("he", "icu", ["one", "two", "many", "other"]).required,
  ).toEqual(["one", "two", "many", "other"]);
});

test("under gen_l10n, Flutter's ICU subset: # is text, date and time only with a ::skeleton, no number, selectordinal or offset, plural keys =0 =1 =2 and the categories, an apostrophe text (#1038)", () => {
  const read = (text: string) => parseIcu(text, "gen_l10n");
  const refusal = (text: string) => {
    const result = read(text);
    return result.ok ? undefined : result.errors[0]!.message;
  };
  expect(read("{count, plural, one{# tydzień} other{# tygodnia}}")).toEqual({
    ok: true,
    nodes: [
      {
        kind: "plural",
        arg: "count",
        branches: {
          one: [{ kind: "literal", text: "# tydzień" }],
          other: [{ kind: "literal", text: "# tygodnia" }],
        },
      },
    ],
  });
  expect(refusal("{count, number} lata")).toMatch(
    /gen-l10n formats only date and time, with a ::skeleton/,
  );
  expect(read("{d, date, ::yMd}").ok).toBe(true);
  expect(read("{t, time, ::jm}").ok).toBe(true);
  expect(refusal("{d, date}")).toMatch(/::skeleton/);
  expect(refusal("{d, date, short}")).toMatch(/::skeleton/);
  expect(refusal("{n, selectordinal, one {#st} other {#th}}")).toMatch(
    /gen-l10n has no selectordinal/,
  );
  expect(refusal("{n, plural, offset:1 one {x} other {y}}")).toMatch(
    /gen-l10n has no offset/,
  );
  expect(refusal("{n, plural, =3 {three} other {many}}")).toMatch(
    /gen-l10n's plural keys are =0, =1, =2, zero, one, two, few, many and other/,
  );
  expect(read("{n, plural, =0 {none} =1 {one} =2 {two} other {many}}").ok).toBe(
    true,
  );
  expect([...partsOf("It's {n}", "gen_l10n").placeholders]).toEqual(["n"]);
  expect(libraryName("gen_l10n")).toBe("gen-l10n");
});

test("under gen_l10n a # the source does not write is text gen-l10n prints as written, refused as such (#1038)", () => {
  const source = "{count, plural, one{{count} week} other{{count} weeks}}";
  const check = validateTranslation(
    source,
    "{count, plural, one{# tydzień} few{# tygodnie} many{# tygodni} other{# tygodnia}}",
    "pl",
    "gen_l10n",
  );
  expect(check.ok).toBe(false);
  expect(check.ok ? [] : check.errors).toEqual([
    { code: "hash-text", arg: "count" },
  ]);
  expect(
    validateTranslation(
      source,
      "{count, plural, one{{count} tydzień} few{{count} tygodnie} many{{count} tygodni} other{{count} tygodnia}}",
      "pl",
      "gen_l10n",
    ).ok,
  ).toBe(true);
});

test("under gen_l10n a # the source writes in its text is the source's in every branch, and a skeleton is one of intl's named DateFormats (#1038)", () => {
  const source =
    "{count, plural, one{{count} post in #{channel}} other{{count} posts in #{channel}}}";
  expect(
    validateTranslation(
      source,
      "{count, plural, one{{count} wpis w #{channel}} few{{count} wpisy w #{channel}} many{{count} wpisów w #{channel}} other{{count} wpisu w #{channel}}}",
      "pl",
      "gen_l10n",
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation(
      "{n, plural, one{Rank #1} other{Rank #{n}}}",
      "{n, plural, one{Rang #1} few{Rang #{n}} many{Rang #{n}} other{Rang #{n}}}",
      "pl",
      "gen_l10n",
    ).ok,
  ).toBe(true);
  const read = (text: string) => parseIcu(text, "gen_l10n").ok;
  expect(read("{d, date, ::yMMMd}")).toBe(true);
  expect(read("{d, date, :: yMMMd }")).toBe(true);
  for (const text of [
    "{d, date, ::yMd+jm}",
    "{d, date, ::yMMMd + jm}",
    "{d, date, ::yMMM d}",
    "{d, date, ::y-MM}",
    "{d, date, ::yyyyMMdd}",
    "{d, date, ::dMMMy}",
  ])
    expect(read(text)).toBe(false);
  // A # in a select inside a plural is said once, as hash-text.
  const check = validateTranslation(
    "{n, plural, one{{g, select, f{{n} file} other{{n} file}}} other{{g, select, f{{n} files} other{{n} files}}}}",
    "{n, plural, one{{g, select, f{# plik} other{# plik}}} other{{g, select, f{# pliki} other{# pliki}}}}",
    "pl",
    "gen_l10n",
  );
  expect(check.ok ? [] : check.errors.map((e) => e.code)).toEqual([
    "hash-text",
  ]);
});

test("under fmt, libfmt's and Python's str.format fields are placeholders named by their field, {{ and }} are braces, and any other brace is refused (#1002)", () => {
  const nodes = (text: string) => {
    const result = parseIcu(text, "fmt");
    if (!result.ok) throw new Error(result.errors[0]!.message);
    return result.nodes;
  };
  const refusal = (text: string) => {
    const result = parseIcu(text, "fmt");
    return result.ok ? undefined : result.errors[0]!.message;
  };
  expect(nodes("_Show {count:L} of:")).toEqual([
    { kind: "literal", text: "_Show " },
    { kind: "placeholder", name: "count", written: "{count:L}" },
    { kind: "literal", text: " of:" },
  ]);
  expect([
    ...partsOf("{} of {} {mode:#o} {x!r:>10} {a.b} {a[0]}", "fmt").placeholders,
  ]).toEqual(["0", "1", "mode", "x", "a.b", "a[0]"]);
  expect(nodes("{{literal}} it's # <b>")).toEqual([
    { kind: "literal", text: "{literal} it's # <b>" },
  ]);
  expect(refusal("Couldn't read { path")).toMatch(/fmt/);
  expect(refusal("a } alone")).toMatch(/}}/);
  expect(refusal("{name")).toMatch(/fmt/);
  // A gettext plural read whole, its branches' fields placeholders.
  expect(
    nodes(
      "{count, plural, one {{total_size} in {file_count:L} file} other {{total_size} in {file_count:L} files}}",
    ),
  ).toEqual([
    {
      kind: "plural",
      arg: "count",
      branches: {
        one: [
          { kind: "placeholder", name: "total_size", written: "{total_size}" },
          { kind: "literal", text: " in " },
          {
            kind: "placeholder",
            name: "file_count",
            written: "{file_count:L}",
          },
          { kind: "literal", text: " file" },
        ],
        other: [
          { kind: "placeholder", name: "total_size", written: "{total_size}" },
          { kind: "literal", text: " in " },
          {
            kind: "placeholder",
            name: "file_count",
            written: "{file_count:L}",
          },
          { kind: "literal", text: " files" },
        ],
      },
    },
  ]);
  expect(libraryName("fmt")).toBe("fmt");
});

test("under fmt a name the source lacks is invalid, a spec may change, and positions compare by position (#1002)", () => {
  const check = (source: string, target: string) =>
    validateTranslation(source, target, "fr", "fmt");
  expect(check("Error: {errmsg}", "Erreur : {errmsgs}").ok).toBe(false);
  expect(check("{count:L} files", "{count} fichiers").ok).toBe(true);
  expect(check("{} of {}", "{1} sur {0}").ok).toBe(true);
  expect(check("{} of {}", "{0} sur {0}").ok).toBe(false);
});

test("under fmt each gettext form numbers its own {}, the reader's count is no field, literal braces in a form are kept, and {} with {0} is refused (#1002)", () => {
  const check = (source: string, target: string, language = "ru") =>
    validateTranslation(source, target, language, "fmt");
  const plural = (one: string, other: string) =>
    `{count, plural, one {${one}} other {${other}}}`;
  // B1: each form's {} starts at 0.
  expect(
    check(
      plural("{} file", "{} files"),
      "{count, plural, one {{} файл} few {{} файла} many {{} файлов} other {{} файла}}",
    ).ok,
  ).toBe(true);
  expect(
    check(
      plural("{} file", "{} files"),
      plural("un fichier", "{} fichiers"),
      "fr",
    ).ok,
  ).toBe(true);
  // B2: the program passes {days}, never the reader's {count}.
  const days = check(
    plural("{days:L} day", "{days:L} days"),
    plural("{count} jour", "{days:L} jours"),
    "fr",
  );
  expect(days.ok ? [] : days.errors.map((e) => e.code)).toContain(
    "unexpected-placeholder",
  );
  // B3: a form's literal braces.
  for (const [one, other] of [
    ["{n} set }}", "{n} sets }}"],
    ["{{{n}}} item", "{{{n}}} items"],
    ["{n} dict {{a}}", "{n} dicts {{a}}"],
  ])
    expect(parseIcu(plural(one!, other!), "fmt").ok).toBe(true);
  expect(parseIcu(plural("{n} set }}", "{n} sets }}"), "fmt")).toMatchObject({
    nodes: [
      {
        branches: {
          one: [
            { kind: "placeholder", name: "n" },
            { kind: "literal", text: " set }" },
          ],
        },
      },
    ],
  });
  // A plural laid out over lines, its own } apart.
  expect(
    parseIcu(
      "{count, plural,\n  one {{n} set }}}\n  other {{n} sets }}}\n}",
      "fmt",
    ).ok,
  ).toBe(true);
  // B5: automatic and manual numbering do not mix.
  expect(check("{} of {}", "{} sur {1}", "fr").ok).toBe(false);
  expect(parseIcu("{} {1}", "fmt").ok).toBe(false);
});

test("a source's placeholders layer another library's tokens on its own: {{name}} on chrome, %s on i18next, {name} on printf; the base still reads structure (#1049)", () => {
  expect([
    ...partsOf("{{used}} used out of {{total}}, $COUNT$", "chrome", ["i18next"])
      .placeholders,
  ]).toEqual(["used", "total", "count"]);
  expect(
    validateTranslation(
      "{{used}} used out of {{total}}",
      "{{used}} усă курăнать",
      "cv",
      "chrome",
      { placeholders: ["i18next"] },
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "total" }],
  });
  expect(
    validateTranslation(
      "Your push was sent to %s devices",
      "Teie tõukesõnum saadeti seadmetesse",
      "et",
      "i18next",
      { placeholders: ["printf"] },
    ).ok,
  ).toBe(false);
  expect([
    ...partsOf("%d files in {num} of {{name}}", "printf", ["fmt"]).placeholders,
  ]).toEqual(["1", "num"]);
  // Japanese runs a value into its text, as sprintf fills it.
  expect(
    validateTranslation(
      "Restart in %s seconds",
      "%s秒後に再起動",
      "ja",
      "i18next",
      { placeholders: ["printf"] },
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation("Took %sms", "Dauerte ms", "de", "i18next", {
      placeholders: ["printf"],
    }).ok,
  ).toBe(false);
  // An example's %name% and a percent sign are text.
  expect([
    ...partsOf('Map {"email": "%email%"} at 50% of %s', "i18next", ["printf"])
      .placeholders,
  ]).toEqual(["1"]);
  // A layered {{name:suffix}} is the value name.
  expect(
    validateTranslation(
      "Show {{input:number}} items",
      "Zeige {{input}} Einträge",
      "de",
      "chrome",
      { placeholders: ["i18next"] },
    ).ok,
  ).toBe(true);
  // Without the layer the base reads its own tokens alone, as before.
  expect([...partsOf("{{used}} of {{total}}", "chrome").placeholders]).toEqual(
    [],
  );
  // A plural is the base's: the same branches with the layer as without.
  const plural = "{count, plural, one {%s file} other {%s files}}";
  const shape = (layers?: Library[]) => {
    const result = parseIcu(plural, "i18next", { placeholders: layers });
    if (!result.ok) throw new Error(result.errors[0]!.message);
    const node = result.nodes[0]!;
    return node.kind === "plural" ? Object.keys(node.branches) : node.kind;
  };
  expect(shape(["printf"])).toEqual(shape());
  expect(shape()).toEqual(["one", "other"]);
});

test("a layer reads a whole plural's translation too, and a %name% example is two letters or more of ASCII, so %d%%, %s%s and CJK runs stay verbs (#1049)", () => {
  // Godot's gettext plural with fmt's {num} in it: the source's own copy
  // and a translation that keeps it are correct.
  const godot = "{count, plural, one {1 color} other {{num} colors}}";
  for (const target of [
    godot,
    "{count, plural, one {1 цвят} other {{num} цвята}}",
  ])
    expect(
      validateTranslation(godot, target, "bg", "printf", {
        placeholders: ["fmt"],
      }),
    ).toEqual({ ok: true });
  expect(
    validateTranslation(
      godot,
      "{count, plural, one {1 цвят} other {цвята}}",
      "bg",
      "printf",
      { placeholders: ["fmt"] },
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "num" }],
  });
  expect(
    validateTranslation(
      "{count, plural, one {{{n}} file} other {{{n}} files}}",
      "{count, plural, one {{{n}} fichier} other {{{n}} fichiers}}",
      "fr",
      "printf",
      { placeholders: ["i18next"] },
    ),
  ).toEqual({ ok: true });
  const printf = (source: string, target: string, language: string) =>
    validateTranslation(source, target, language, "i18next", {
      placeholders: ["printf"],
    }).ok;
  expect(printf("%s of %d files", "%s件中%d件のファイル", "ja")).toBe(true);
  expect(printf("Page %s of %s", "第%s页共%s页", "zh")).toBe(true);
  expect(printf("%s of %s", "%s개중%s개", "ko")).toBe(true);
  expect(printf("%s min %s s", "%s분%s초", "ko")).toBe(true);
  expect(printf("%s: %d%%", "%s : %d %%", "fr")).toBe(true);
  expect(printf("%s%s", "%s%s", "fr")).toBe(true);
  expect(printf("%d%s", "%s", "fr")).toBe(false);
  expect([
    ...partsOf("%d%% done, %s%s", "i18next", ["printf"]).placeholders,
  ]).toEqual(["1", "2", "3"]);
  // An example's name is still text.
  expect([
    ...partsOf("Use %email% or %user_name% for %s", "i18next", ["printf"])
      .placeholders,
  ]).toEqual(["1"]);
});

test("a layered printf verb is read with sprintf-js's own grammar: a named %(name)s, 'x padding and %1$s count, a C length or Go's %[1]s does not (#1049)", () => {
  const parts = (source: string) => [
    ...partsOf(source, "i18next", ["printf"]).placeholders,
  ];
  expect(parts("Hi %(user)s, %'*10s and %+05.2f")).toEqual(["user", "1", "2"]);
  expect(parts("%2$s then %1$s")).toEqual(["2", "1"]);
  expect(parts("%ld or %[1]s or %*d")).toEqual([]);
  expect(
    validateTranslation("Hi %(user)s", "Salut", "fr", "i18next", {
      placeholders: ["printf"],
    }),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "user" }],
  });
});

test("a %name% is an example only where its closing % starts no sprintf verb, so %dx%d and %s_%s.png are two verbs (#1049)", () => {
  const parts = (source: string) => [
    ...partsOf(source, "i18next", ["printf"]).placeholders,
  ];
  expect(parts("Resolution: %dx%d")).toEqual(["1", "2"]);
  expect(parts("%s_%s.png and %dh%dm%ds")).toEqual(["1", "2", "3", "4", "5"]);
  expect(parts('{"mail": "%email%", "%team%,%department%"} %s')).toEqual(["1"]);
  expect(parts("%firstname%, %lastname%: %curr% of %total%.")).toEqual([]);
  expect(
    validateTranslation(
      "Resolution: %dx%d",
      "Auflösung: %d × %d",
      "de",
      "i18next",
      { placeholders: ["printf"] },
    ).ok,
  ).toBe(true);
  expect(
    validateTranslation("Resolution: %dx%d", "Auflösung: %d", "de", "i18next", {
      placeholders: ["printf"],
    }).ok,
  ).toBe(false);
});

test("partsOf lists the placeholders a tag's attributes hold apart from the text's, by name (#1030)", () => {
  const parts = partsOf(
    "<a href='%{userUrl}'>%{user}</a> posted <a href='%{topicUrl}'>a topic</a>",
    "rails",
  );
  expect([...parts.placeholders]).toEqual(["user"]);
  expect([...parts.attributePlaceholders]).toEqual(["userUrl", "topicUrl"]);
  expect([...partsOf("Hello {name}", "icu").attributePlaceholders]).toEqual([]);
});

test("in a plural read whole, balanced braces a library reads as text stay in their branch (#1052)", () => {
  // Godot's {num}, which String::format fills after the lookup.
  for (const [library, count] of [
    ["printf", "%d"],
    ["rails", "%{count}"],
    ["qt", "%n"],
    ["counterpart", "%(count)s"],
  ] as const) {
    const parsed = parseIcu(
      `{count, plural, one {1 color} other {{num} colors ${count}}}`,
      library,
    );
    expect(parsed.ok, library).toBe(true);
    if (!parsed.ok) continue;
    expect(
      parsed.nodes.map((n) => n.kind),
      library,
    ).toEqual(["plural"]);
    const plural = parsed.nodes[0]!;
    if (plural.kind !== "plural") continue;
    expect(
      plural.branches
        .other!.map((n) => (n.kind === "literal" ? n.text : n.kind))
        .join("|"),
      library,
    ).toMatch(/^\{num\} colors /);
  }
  // Greek's (%d change): a branch that is itself in braces.
  const greek = parseIcu(
    "{count, plural, one {{Αλλαγή %d}} other {{Αλλαγές %d}}}",
    "printf",
  );
  expect(greek.ok && greek.nodes.map((n) => n.kind)).toEqual(["plural"]);
  // i18next's {{name}} and easy_localization's {} are read as before.
  const i18next = parseIcu(
    "{count, plural, one {{{count}} file} other {{{count}} files}}",
    "i18next",
  );
  expect(i18next.ok && i18next.nodes.map((n) => n.kind)).toEqual(["plural"]);
});
