import { expect, test } from "vitest";
import { entitySchema, snapshotSchema } from "./snapshot";

const MINIMAL = {
  contract: "corpus/1",
  project: "moonlight-manor",
  sourceLanguage: "pt-PT",
  strings: [],
};

test("parses a minimal envelope", () => {
  const parsed = snapshotSchema.parse(MINIMAL);
  expect(parsed.project).toBe("moonlight-manor");
  expect(parsed.entities).toEqual([]);
});

test("rejects a wrong contract identifier", () => {
  expect(
    snapshotSchema.safeParse({ ...MINIMAL, contract: "corpus/2" }).success,
  ).toBe(false);
});

test.each(["project", "sourceLanguage", "strings"])(
  "rejects an envelope missing %s",
  (field) => {
    const rest: Record<string, unknown> = { ...MINIMAL };
    delete rest[field];
    expect(snapshotSchema.safeParse(rest).success).toBe(false);
  },
);

test("unknown envelope fields pass through (§4 additive versioning)", () => {
  const parsed = snapshotSchema.parse({ ...MINIMAL, forms: { future: true } });
  expect((parsed as Record<string, unknown>).forms).toEqual({ future: true });
});

test("parses the §6 entity verbatim", () => {
  const parsed = entitySchema.parse({
    id: "trait:insomnia",
    type: "trait",
    name: "Insónia",
    attributes: { summary: "This character wanders the manor at night." },
  });
  expect(parsed.name).toBe("Insónia");
});

test("entities need id, type, and name; attributes are optional strings", () => {
  expect(entitySchema.safeParse({ id: "a", type: "t" }).success).toBe(false);
  expect(
    entitySchema.safeParse({ id: "a", type: "t", name: "n" }).success,
  ).toBe(true);
  expect(
    entitySchema.safeParse({
      id: "a",
      type: "t",
      name: "n",
      attributes: { rooms: 3 },
    }).success,
  ).toBe(false);
});

test("seedTranslations maps language -> string id -> text (§8)", () => {
  const parsed = snapshotSchema.parse({
    ...MINIMAL,
    seedTranslations: { en: { "app.title": "Corpus" } },
  });
  expect(parsed.seedTranslations?.en?.["app.title"]).toBe("Corpus");
  expect(
    snapshotSchema.safeParse({ ...MINIMAL, seedTranslations: { en: "x" } })
      .success,
  ).toBe(false);
});

test("stringTypes carry per-type field declarations for the server (§5)", () => {
  const parsed = snapshotSchema.parse({
    ...MINIMAL,
    stringTypes: {
      "clue-skin": {
        kind: { type: "enum", description: "d", values: ["sighting"] },
      },
    },
  });
  expect(parsed.stringTypes?.["clue-skin"]?.kind?.type).toBe("enum");
  expect(
    snapshotSchema.safeParse({
      ...MINIMAL,
      stringTypes: { t: { bad: { type: "nope", description: "d" } } },
    }).success,
  ).toBe(false);
});

test("entityTypes declare a label (§6)", () => {
  const parsed = snapshotSchema.parse({
    ...MINIMAL,
    entityTypes: { trait: { label: "Trait" } },
  });
  expect(parsed.entityTypes?.trait?.label).toBe("Trait");
});

test("a full snapshot with strings and entities parses", () => {
  const parsed = snapshotSchema.parse({
    ...MINIMAL,
    strings: [{ id: "a", type: "t", source: "s" }],
    entities: [{ id: "trait:x", type: "trait", name: "X" }],
  });
  expect(parsed.strings).toHaveLength(1);
  expect(parsed.entities).toHaveLength(1);
});
