import { expect, test } from "vitest";
import { validationMessage } from "./validation-message";

test("a plural's count missing under printf or android says the plural was dropped (#652)", () => {
  for (const syntax of [
    "printf",
    "android",
    "counterpart",
    "easy_localization",
    "rails",
  ] as const)
    expect(
      validationMessage({ code: "missing-placeholder", name: "count" }, syntax),
    ).toBe("The source is a plural on count: write the translation as one");
  expect(
    validationMessage(
      { code: "missing-placeholder", name: "1", written: "%d" },
      "printf",
    ),
  ).toBe("Missing %d");
});

test("a placeholder an apostrophe quotes says the apostrophe did it (#1010)", () => {
  expect(
    validationMessage({
      code: "missing-placeholder",
      name: "name",
      quoted: true,
    }),
  ).toBe(
    "Missing {name}: an apostrophe before a brace quotes it, so write ’ in its place",
  );
  expect(
    validationMessage({ code: "missing-tag", name: "a", quoted: true }),
  ).toBe(
    "Missing the <a> tag: an apostrophe before a tag quotes it, so write ’ in its place",
  );
});
