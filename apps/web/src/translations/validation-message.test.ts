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

test("a Python key's changed conversion names no position (#1012)", () => {
  expect(
    validationMessage(
      {
        code: "changed-verb",
        name: "n",
        expected: "%(n)d",
        actual: "%(n)s",
        indexed: "%n$s",
        moved: false,
      },
      "printf",
    ),
  ).toBe("%(n)s where the source has %(n)d");
});

test("a form count under vue-i18n's default rule names what each form is shown for (#1018)", () => {
  expect(
    validationMessage({ code: "form-count", expected: 2, actual: 4 }, "vue"),
  ).toBe(
    "4 forms read as =0 | =1 | other | unused under vue-i18n's default rule, where the source's 2 are =1 | other",
  );
  expect(
    validationMessage({ code: "form-count", expected: 2, actual: 1 }, "vue"),
  ).toBe(
    "1 form reads as other under vue-i18n's default rule, where the source's 2 are =1 | other",
  );
});
