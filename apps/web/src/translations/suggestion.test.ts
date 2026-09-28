import { expect, test } from "vitest";
import { suggestionOf } from "./suggestion";

test("a suggestion is offered only on a row with no translation (#774)", () => {
  expect(suggestionOf({ state: "untranslated", suggestion: "Guess" })).toBe(
    "Guess",
  );
  expect(suggestionOf({ state: "translated", suggestion: "Guess" })).toBeNull();
  expect(suggestionOf({ state: "verified", suggestion: "Guess" })).toBeNull();
  expect(suggestionOf({ state: "untranslated", suggestion: null })).toBeNull();
});
