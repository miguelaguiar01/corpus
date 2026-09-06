import { expect, test } from "vitest";
import { stringEntrySchema } from "@corpus/contract";
import { tableToEntries } from "./table";

const STEPS = [
  { id: "step-1", text: "Tap the door.", scene: "intro", optional: false },
  { id: "step-2", text: "Enter the manor.", scene: "intro", optional: true },
];

test("maps records to entries via the id/text map", () => {
  const entries = tableToEntries(STEPS, {
    type: "tutorial-step",
    map: { id: "id", text: "text" },
  });
  expect(entries[0]).toMatchObject({
    id: "step-1",
    type: "tutorial-step",
    source: "Tap the door.",
  });
  expect(entries).toHaveLength(2);
});

test("unmapped fields become metadata", () => {
  const entries = tableToEntries(STEPS, {
    type: "tutorial-step",
    map: { id: "id", text: "text" },
  });
  expect(entries[0]?.metadata).toEqual({ scene: "intro", optional: false });
});

test("entries validate against the contract", () => {
  const entries = tableToEntries(STEPS, {
    type: "t",
    map: { id: "id", text: "text" },
  });
  expect(stringEntrySchema.safeParse(entries[0]).success).toBe(true);
});

test("a record missing the id field throws naming the index and field", () => {
  expect(() =>
    tableToEntries([{ text: "x" }], {
      type: "t",
      map: { id: "id", text: "text" },
    }),
  ).toThrow(/index 0.*id/);
});

test("a record missing the text field throws naming the index and field", () => {
  expect(() =>
    tableToEntries([{ id: "a" }], {
      type: "t",
      map: { id: "id", text: "text" },
    }),
  ).toThrow(/index 0.*text/);
});

test("a non-string id value throws", () => {
  expect(() =>
    tableToEntries([{ id: 7, text: "x" }], {
      type: "t",
      map: { id: "id", text: "text" },
    }),
  ).toThrow(/id/);
});

test("duplicate ids within a source are rejected (§4)", () => {
  expect(() =>
    tableToEntries(
      [
        { id: "dup", text: "a" },
        { id: "dup", text: "b" },
      ],
      { type: "t", map: { id: "id", text: "text" } },
    ),
  ).toThrow(/duplicate.*dup/i);
});

test("custom field names are honored", () => {
  const entries = tableToEntries([{ key: "k1", label: "Hello", note: "n" }], {
    type: "t",
    map: { id: "key", text: "label" },
  });
  expect(entries[0]).toMatchObject({ id: "k1", source: "Hello" });
  expect(entries[0]?.metadata).toEqual({ note: "n" });
});

test("non-array input is rejected", () => {
  expect(() =>
    tableToEntries(
      { not: "an array" },
      {
        type: "t",
        map: { id: "id", text: "text" },
      },
    ),
  ).toThrow(/array/);
});

test("no metadata key when there are no extra fields", () => {
  const entries = tableToEntries([{ id: "a", text: "x" }], {
    type: "t",
    map: { id: "id", text: "text" },
  });
  expect(entries[0]?.metadata).toBeUndefined();
});

test("empty array yields no entries", () => {
  expect(
    tableToEntries([], { type: "t", map: { id: "id", text: "text" } }),
  ).toEqual([]);
});

test("map.metadata lists the fields to carry; the rest are left out", () => {
  const rows = [
    { id: "a", text: "A", scene: "intro", cells: { x: 1 }, clue: 3 },
  ];
  expect(
    tableToEntries(rows, {
      type: "step",
      map: { id: "id", text: "text", metadata: ["scene"] },
    }),
  ).toEqual([
    { id: "a", type: "step", source: "A", metadata: { scene: "intro" } },
  ]);
  expect(() =>
    tableToEntries(rows, { type: "step", map: { id: "id", text: "text" } }),
  ).toThrow(
    /"cells" must be a string, boolean, or string\[\]; list the fields to carry in map\.metadata/,
  );
});
