import { expect, test } from "vitest";
import { insertAtCaret } from "./caret";

test("inserts the token at the caret and places the caret after it", () => {
  expect(insertAtCaret("Olá  mundo", 4, 4, "{name}")).toEqual({
    text: "Olá {name} mundo",
    caret: 10,
  });
});

test("replaces a selection", () => {
  expect(insertAtCaret("Olá XXX mundo", 4, 7, "{name}")).toEqual({
    text: "Olá {name} mundo",
    caret: 10,
  });
});

test("appends when there is no caret position", () => {
  expect(insertAtCaret("Olá", null, null, "{name}")).toEqual({
    text: "Olá{name}",
    caret: 9,
  });
});
