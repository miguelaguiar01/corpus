import { moonlightManor } from "@corpus/contract";
import { expect, test } from "vitest";
import { chipText } from "@/components/source-view";
import { inPositionOrder, slotsOf } from "./slots";

const greenhouse = moonlightManor.strings[0]!;
const declarations = moonlightManor.stringTypes!["clue-skin"]!;

test("slots carry the declaration and the first example's value per language, in source order", () => {
  const slots = slotsOf(
    greenhouse.source,
    declarations,
    greenhouse.examples,
    "pt-PT",
  );
  expect(slots.map((s) => s.name)).toEqual(["person", "room_de", "hour"]);
  expect(slots[0]).toEqual({
    name: "person",
    description: "Full name with article",
    role: "np-def",
    format: null,
    written: null,
    values: { "pt-PT": "a Condessa Rosa", en: "Countess Rosa" },
  });
  expect(slots[2]?.role).toBeNull();
});

test("an undeclared slot, a count, and a string with no examples still list every value", () => {
  const slots = slotsOf(
    "{n, plural, one {# {thing}} other {# {thing}s}} for {who}",
    {},
    undefined,
    "en",
  );
  expect(slots).toEqual([
    {
      name: "thing",
      description: null,
      role: null,
      format: null,
      written: null,
      values: {},
    },
    {
      name: "who",
      description: null,
      role: null,
      format: null,
      written: null,
      values: {},
    },
    {
      name: "n",
      description: null,
      role: null,
      format: null,
      written: null,
      values: {},
    },
  ]);
});

test("a printf plural on argN is its argument's one slot (#735)", () => {
  expect(
    slotsOf(
      "{arg1, plural, one {%arg recent post} other {%arg recent posts}} from {arg2, plural, one {%arg participant} other {%arg participants}}",
      {},
      null,
      "en",
      "printf",
    ).map((s) => s.name),
  ).toEqual(["1", "2"]);
});

test("printf slots read in position order, a plural's argument among them; other libraries keep source order (#739)", () => {
  const names = (source: string, syntax: "printf" | "icu") =>
    slotsOf(source, {}, undefined, "en", syntax).map((s) => s.name);
  expect(
    names("{arg1, plural, one {one post} other {posts}} by %@", "printf"),
  ).toEqual(["1", "2"]);
  expect(names("%2$s wrote %1$d", "printf")).toEqual(["1", "2"]);
  expect(names("{b} and {a}", "icu")).toEqual(["b", "a"]);
});

test("inPositionOrder sorts printf positions, a named value after them, and leaves other libraries alone (#739)", () => {
  expect(inPositionOrder(["2", "count", "1"], "printf")).toEqual([
    "1",
    "2",
    "count",
  ]);
  expect(inPositionOrder(["2", "1"], "icu")).toEqual(["2", "1"]);
});

test("a slot named like an Object.prototype member has only its own values (#846)", () => {
  const [slot] = slotsOf(
    "Hi {constructor}",
    {},
    [{ values: {}, rendered: "Hi", valuesByLanguage: { de: {} } }],
    "en",
  );
  expect(slot).toEqual({
    name: "constructor",
    description: null,
    role: null,
    format: null,
    written: null,
    values: {},
  });
});

test("an i18next {{…}} that holds no name is a slot whose chip writes it as the source does (#1008)", () => {
  const slots = slotsOf(
    'Use {{ define "<NAME>" }} for {{name}}',
    {},
    null,
    "en",
    "i18next",
  );
  expect(
    slots.map((s) => chipText(s.name, "i18next", s.format, s.written)),
  ).toEqual(['{{ define "<NAME>" }}', "{{name}}"]);
});
