import { expect, test } from "vitest";
import { validationMessage } from "./validation-message";

test("a plural's count missing under printf or android says the plural was dropped (#652)", () => {
  for (const syntax of ["printf", "android"] as const)
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
