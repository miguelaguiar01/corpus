import { expect, test } from "vitest";
import { MIN_STATES, pullPayloadSchema } from "./pull";

const PAYLOAD = {
  contract: "corpus/1",
  project: "moonlight-manor",
  sourceLanguage: "pt-PT",
  minState: "verified",
  types: { "ui.continue": "chrome", "skin.heard-nothing": "clue-skin" },
  translations: {
    "pt-PT": {
      "ui.continue": "Continuar",
      "skin.heard-nothing": "Não ouvi nada.",
    },
    en: { "ui.continue": "Continue" },
  },
};

test("a pull payload round-trips through the schema", () => {
  expect(pullPayloadSchema.parse(PAYLOAD)).toEqual(PAYLOAD);
});

test("min states are ordered untranslated < translated < verified", () => {
  expect(MIN_STATES).toEqual(["untranslated", "translated", "verified"]);
});

test.each(["contract", "project", "sourceLanguage", "types", "translations"])(
  "rejects a payload missing %s",
  (field) => {
    const rest: Record<string, unknown> = { ...PAYLOAD };
    delete rest[field];
    expect(pullPayloadSchema.safeParse(rest).success).toBe(false);
  },
);

test("rejects an unknown min state and a wrong contract", () => {
  expect(
    pullPayloadSchema.safeParse({ ...PAYLOAD, minState: "done" }).success,
  ).toBe(false);
  expect(
    pullPayloadSchema.safeParse({ ...PAYLOAD, contract: "corpus/2" }).success,
  ).toBe(false);
});

test("a pull payload may carry pending source changes", () => {
  const base = {
    contract: "corpus/1",
    project: "p",
    sourceLanguage: "en",
    minState: "verified",
    types: {},
    translations: {},
  };
  const changes = [
    { kind: "edit", id: "a", type: "t", file: "i18n/en.json", text: "New" },
    { kind: "add", id: "b", type: "t", file: "i18n/en.json", text: "Added" },
    { kind: "delete", id: "c", type: "t", file: "i18n/en.json" },
  ];
  const parsed = pullPayloadSchema.safeParse({
    ...base,
    sourceChanges: changes,
  });
  expect(parsed.success && parsed.data.sourceChanges).toEqual(changes);
  expect(
    pullPayloadSchema.safeParse({
      ...base,
      sourceChanges: [{ kind: "rename", id: "a", type: "t", file: "f" }],
    }).success,
  ).toBe(false);
  // An id or a type must be an identifier, and an edit carries text.
  expect(
    pullPayloadSchema.safeParse({
      ...base,
      sourceChanges: [
        { kind: "add", id: "a b", type: "t", file: "f", text: "x" },
      ],
    }).success,
  ).toBe(false);
  expect(
    pullPayloadSchema.safeParse({
      ...base,
      sourceChanges: [{ kind: "edit", id: "a", type: "t", file: "f" }],
    }).success,
  ).toBe(false);
});
