import { expect, test } from "vitest";
import {
  exampleSchema,
  fieldDeclarationSchema,
  stringEntrySchema,
} from "./strings";

// §5 example entry, verbatim.
const SIGHTING_ENTRY = {
  id: "skin.seen-at-greenhouse-window",
  type: "clue-skin",
  source:
    "{person} foi {person_gender, select, m {visto} f {vista}} à janela {room_de} às {hour} — e não estava {person_gender, select, m {sozinho} f {sozinha}}.",
  metadata: {
    kind: "sighting",
    requires_trait: "trait:insomnia",
    requires_windows: true,
    note: "Said by the butler; keep it dry.",
  },
  examples: [
    {
      values: {
        person: "a Condessa Rosa",
        person_gender: "f",
        room_de: "da estufa",
        hour: "21h",
      },
      rendered:
        "A Condessa Rosa foi vista à janela da estufa às 21h — e não estava sozinha.",
    },
  ],
};

test("parses the §5 example entry verbatim", () => {
  const parsed = stringEntrySchema.parse(SIGHTING_ENTRY);
  expect(parsed.id).toBe("skin.seen-at-greenhouse-window");
  expect(parsed.metadata?.requires_windows).toBe(true);
  expect(parsed.examples?.[0]?.values.person).toBe("a Condessa Rosa");
});

test("a bare entry needs only id, type, source", () => {
  const parsed = stringEntrySchema.parse({
    id: "app.title",
    type: "chrome",
    source: "Corpus",
  });
  expect(parsed.metadata).toBeUndefined();
});

test.each([
  ["missing id", { type: "t", source: "s" }],
  ["empty id", { id: "", type: "t", source: "s" }],
  ["missing type", { id: "a", source: "s" }],
  ["missing source", { id: "a", type: "t" }],
])("rejects an entry with %s", (_label, entry) => {
  expect(stringEntrySchema.safeParse(entry).success).toBe(false);
});

test("metadata values are string, boolean, or string[] — nothing else", () => {
  const good = stringEntrySchema.safeParse({
    id: "a",
    type: "t",
    source: "s",
    metadata: { refs: ["trait:a", "trait:b"], flag: false, note: "x" },
  });
  expect(good.success).toBe(true);
  const bad = stringEntrySchema.safeParse({
    id: "a",
    type: "t",
    source: "s",
    metadata: { count: 3 },
  });
  expect(bad.success).toBe(false);
});

test("malformed metadata reports the offending field in the error path", () => {
  const result = stringEntrySchema.safeParse({
    id: "a",
    type: "t",
    source: "s",
    metadata: { good: "x", bad: 42 },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths.some((p) => p.includes("bad"))).toBe(true);
  }
});

test("entries tolerate unknown extra fields (additive versioning, §4)", () => {
  const parsed = stringEntrySchema.parse({
    id: "a",
    type: "t",
    source: "s",
    futureField: { anything: true },
  });
  expect(parsed.id).toBe("a");
});

test("examples require values and rendered", () => {
  expect(
    exampleSchema.safeParse({ values: { a: "1" }, rendered: "r" }).success,
  ).toBe(true);
  expect(exampleSchema.safeParse({ rendered: "r" }).success).toBe(false);
  expect(
    exampleSchema.safeParse({ values: { a: 1 }, rendered: "r" }).success,
  ).toBe(false);
});

test.each([
  ["enum", { type: "enum", description: "d", values: ["sighting", "gossip"] }],
  ["flag", { type: "flag", description: "d" }],
  ["text", { type: "text", description: "d" }],
  [
    "placeholders",
    {
      type: "placeholders",
      description: "d",
      slots: {
        person: { description: "who was seen" },
        room_de: { description: "room, contracted", role: "de-contraction" },
      },
    },
  ],
  ["ref", { type: "ref", description: "d", entityType: "trait" }],
  ["list<ref>", { type: "list<ref>", description: "d" }],
])("declares a %s field", (_label, decl) => {
  expect(fieldDeclarationSchema.safeParse(decl).success).toBe(true);
});

test("declarations demand a description — it is the tooltip (§5)", () => {
  expect(fieldDeclarationSchema.safeParse({ type: "flag" }).success).toBe(
    false,
  );
});

test("enum declarations need at least one value", () => {
  expect(
    fieldDeclarationSchema.safeParse({
      type: "enum",
      description: "d",
      values: [],
    }).success,
  ).toBe(false);
});

test("unknown primitive kinds are rejected", () => {
  expect(
    fieldDeclarationSchema.safeParse({ type: "number", description: "d" })
      .success,
  ).toBe(false);
});

test("declarations round-trip through parse", () => {
  const decl = {
    type: "placeholders",
    description: "slots",
    slots: { hour: { description: "time of sighting" } },
  };
  expect(fieldDeclarationSchema.parse(decl)).toEqual(decl);
});
