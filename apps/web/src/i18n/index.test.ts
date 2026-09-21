import { expect, test } from "vitest";
import { t } from "./index";

test("a message interpolates its values, keeps a missing one literal, and never capitalises a value", () => {
  expect(t("editor.targetLabel", { language: "pt-PT" })).toBe(
    "Translation (pt-PT)",
  );
  expect(t("editor.missingPlaceholder", {})).toBe("Missing {name}");
  expect(t("editor.unknownSelect", { arg: "gender" })).toBe(
    "The source has no select on gender",
  );
});

test("a plural message picks its branch by the count", () => {
  expect(t("string.otherLanguagesMore", { count: 1 })).toBe("1 more language");
  expect(t("string.otherLanguagesMore", { count: 3 })).toBe("3 more languages");
});
