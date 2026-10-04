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

test("gen-l10n's overridden branch and an =N wider than its number are said in the editor (#1039)", () => {
  expect(
    validationMessage(
      { code: "overridden-branch", arg: "count", key: "=1", category: "one" },
      "gen_l10n",
    ),
  ).toBe(
    "Plural count writes =1 and one, which gen-l10n reads as one branch: it keeps the one written later and drops the other",
  );
  expect(
    validationMessage(
      {
        code: "wide-exact",
        arg: "count",
        key: "=1",
        category: "one",
        values: [21, 31, 41],
        more: true,
      },
      "gen_l10n",
    ),
  ).toBe(
    "gen-l10n reads =1 on count as one, which this language also picks for 21, 31, 41 and more: write one for what they share",
  );
  // Only =0, =1 and =2 exist, so only those are offered.
  expect(
    validationMessage(
      {
        code: "wide-exact",
        arg: "count",
        key: "=1",
        category: "one",
        values: [0],
      },
      "gen_l10n",
    ),
  ).toBe(
    "gen-l10n reads =1 on count as one, which this language also picks for 0: write one for what they share, or give 0 its own =0",
  );
});

test("a category branch that writes 1 for a count is said in the editor (#1042)", () => {
  expect(
    validationMessage(
      {
        code: "fixed-count",
        arg: "count",
        key: "one",
        values: [21, 31, 41],
        more: true,
      },
      "icu",
    ),
  ).toBe(
    "The one branch of count writes 1, which this language also picks for 21, 31, 41 and more: write the count in it",
  );
  expect(
    validationMessage(
      { code: "fixed-count", arg: "count", key: "one", values: [0] },
      "icu",
    ),
  ).toBe(
    "The one branch of count writes 1, which this language also picks for 0: write the count in it",
  );
});
