import { expect, test } from "vitest";
import { parseIcu, placeholdersOf, selectArgsOf } from "./icu";

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
  ["plural", "{n, plural, one {# item} other {# items}}", /plural/],
  ["nested select", "{a, select, x {{b, select, y {t}}}}", /nest/i],
  ["unbalanced open brace", "olá {name", /unclosed|unbalanced/i],
  ["stray close brace", "olá } mundo", /unmatched/i],
  ["empty placeholder name", "olá {}", /name/i],
  ["invalid placeholder name", "olá {two words}", /name/i],
  ["select without branches", "{g, select,}", /branch/i],
  ["unknown argument type", "{n, number}", /select|supported/i],
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
  expect(parseIcu("{1, select, one {x} other {y}}").ok).toBe(false);
});
