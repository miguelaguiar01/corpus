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
