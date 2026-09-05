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

test("lands the caret inside the token when an offset is given", () => {
  expect(insertAtCaret("a b", 1, 1, "{g, select, m {} f {}}", 15)).toEqual({
    text: "a{g, select, m {} f {}} b",
    caret: 16,
  });
});

test("appends when there is no caret position", () => {
  expect(insertAtCaret("Olá", null, null, "{name}")).toEqual({
    text: "Olá{name}",
    caret: 9,
  });
});
