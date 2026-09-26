import { expect, test } from "vitest";
import { moonlightManor } from "./fixtures/moonlight-manor";
import { entitySchema, snapshotSchema, seedDigest } from "./snapshot";

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

test("a snapshot may declare its writable sources; the fixture does", () => {
  expect(snapshotSchema.safeParse(moonlightManor).success).toBe(true);
  const parsed = snapshotSchema.safeParse(moonlightManor);
  expect(parsed.success && parsed.data.sources?.length).toBe(2);
  const bad = snapshotSchema.safeParse({
    ...moonlightManor,
    sources: [{ path: "x/{lang}.json", adapter: "exec", type: "t" }],
  });
  expect(bad.success).toBe(false);
});

test("typeNotes is an optional map of non-empty sentences per string type (§5)", () => {
  expect(snapshotSchema.safeParse(MINIMAL).success).toBe(true);
  const noted = snapshotSchema.safeParse({
    ...MINIMAL,
    typeNotes: { chrome: "Short and plain." },
  });
  expect(noted.success && noted.data.typeNotes).toEqual({
    chrome: "Short and plain.",
  });
  expect(
    snapshotSchema.safeParse({ ...MINIMAL, typeNotes: { chrome: "" } }).success,
  ).toBe(false);
});

test("richText is an optional map of string type to html (#622)", () => {
  const html = snapshotSchema.safeParse({
    ...MINIMAL,
    richText: { ui: "html" },
  });
  expect(html.success && html.data.richText).toEqual({ ui: "html" });
  expect(
    snapshotSchema.safeParse({ ...MINIMAL, richText: { ui: "xml" } }).success,
  ).toBe(false);
});

test("a string id may be the sentence itself, as i18next's natural keys are; control characters are refused", () => {
  const sentence =
    "Are you sure about that? Deleting the <em>{{ templateName }}</em> template is permanent.";
  const ok = snapshotSchema.safeParse({
    ...moonlightManor,
    strings: [{ id: sentence, type: "ui", source: sentence }],
  });
  expect(ok.success).toBe(true);
  const bad = snapshotSchema.safeParse({
    ...moonlightManor,
    strings: [{ id: "bell\u0007here", type: "ui", source: "x" }],
  });
  expect(bad.success).toBe(false);
  expect(
    snapshotSchema.safeParse({
      ...moonlightManor,
      strings: [{ id: "x".repeat(1001), type: "ui", source: "x" }],
    }).success,
  ).toBe(false);
});

test("seedDigest is order-free over the pairs and moves with any text (#601)", () => {
  const a = seedDigest({ "ui.a": "x", "ui.b": "y" });
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(seedDigest({ "ui.b": "y", "ui.a": "x" })).toBe(a);
  expect(seedDigest({ "ui.a": "x", "ui.b": "z" })).not.toBe(a);
  expect(seedDigest({ "ui.a": "x" })).not.toBe(a);
  expect(seedDigest({})).toBe(seedDigest({}));
  // The id and the text are kept apart: moving a character across the
  // boundary is a different catalogue.
  expect(seedDigest({ "ui.a": "bx" })).not.toBe(seedDigest({ "ui.ab": "x" }));
});
