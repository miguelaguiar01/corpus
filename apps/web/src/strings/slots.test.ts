import { moonlightManor } from "@corpus/contract";
import { expect, test } from "vitest";
import { slotsOf } from "./slots";

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
    { name: "thing", description: null, role: null, values: {} },
    { name: "who", description: null, role: null, values: {} },
    { name: "n", description: null, role: null, values: {} },
  ]);
});
