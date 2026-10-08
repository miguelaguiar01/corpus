import { expect, test } from "vitest";
import { problemOf, validationMessage } from "./validation-message";

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

test("problemOf reads a plural by the file's own forms, an =N they name being none (#1051, #982)", () => {
  const source = "{count, plural, one {%d file} other {%d files}}";
  const text = "{count, plural, =1 {%d A} other {%d B}}";
  expect(
    problemOf(
      source,
      text,
      "ceb",
      "printf",
      null,
      undefined,
      "k",
      "en",
      undefined,
      ["=1", "other"],
    ),
  ).toBeNull();
  expect(
    problemOf(source, text, "ceb", "printf", null, undefined, "k", "en"),
  ).toMatch(/=1 branch/);
});

test("an =N branch a plural read whole cannot hold is said in the editor (#1051)", () => {
  expect(
    validationMessage(
      { code: "exact-branch", arg: "count", key: "=0", category: "other" },
      "printf",
    ),
  ).toBe(
    "count has an =0 branch, which this file cannot hold, as it holds a plural's categories only: write it in the other branch, which this language picks for 0",
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
    "The one branch of count writes 1, but this language also picks it for 21, 31, 41 and more: write the count in it",
  );
  expect(
    validationMessage(
      { code: "fixed-count", arg: "count", key: "one", values: [0] },
      "icu",
    ),
  ).toBe(
    "The one branch of count writes 1, but this language also picks it for 0: write the count in it",
  );
});

test("a plural without other says so plainly in the editor and the queue (#975)", () => {
  expect(
    validationMessage({ code: "missing-other", arg: "count" }, "counterpart"),
  ).toBe(
    "Plural count is missing the other branch, which the runtime picks for every count no other branch covers",
  );
  expect(
    problemOf(
      "{n, plural, one {# file} other {# files}}",
      "{n, plural, one {x}}",
      "de",
      "icu",
      null,
      undefined,
      "k",
      "en",
    ),
  ).toBe(
    "Plural n is missing the other branch, which the runtime picks for every count no other branch covers",
  );
});

test("a format a Fluent translation adds is said in the editor (#1089)", () => {
  expect(
    validationMessage(
      { code: "unexpected-format", name: "n", expected: null, actual: "date" },
      "fluent",
    ),
  ).toBe("n has no format in the source; write it without one");
});

test("an apostrophe that quoted past a branch's end says so (#1155)", () => {
  expect(
    validationMessage(
      {
        code: "invalid-icu",
        where: "target",
        message: "unclosed branch '{'",
        position: 17,
        quoted: true,
      },
      "formatjs",
    ),
  ).toBe(
    "Malformed message: unclosed branch '{'. An apostrophe before a brace, a tag or a # quotes it, so write ’ in its place",
  );
  expect(
    validationMessage(
      { code: "missing-other", arg: "n", quoted: true },
      "formatjs",
    ),
  ).toBe(
    "Plural n is missing the other branch: an apostrophe before a brace, a tag or a # quotes it, so write ’ in its place",
  );
});

test("Chrome's dollars before a placeholder are said by the run's length, with no advice to move the $ into the content (#1170)", () => {
  const say = (written: string) =>
    validationMessage(
      { code: "chrome-dollar", at: 3, kind: "doubled-name", written },
      "chrome",
    );
  expect(say("$$NAME$")).toBe(
    "Chrome reads $$NAME$ as a $ before the placeholder, then reads that $ with the start of its value, so a text value loses its first character (Bob shows as ob) and a $1 value shows as a literal $1: put a space between",
  );
  expect(say("$$$NAME$")).toBe(
    "Chrome reads $$$NAME$ as 2 dollars before the placeholder, then reads them with the start of its value, so it shows 1 dollar before a text value ($Bob), and a $1 value joins the run and shows literally: put a space between",
  );
  expect(say("$$$$NAME$")).toContain(
    "shows 2 dollars before a text value ($$Bob)",
  );
});
