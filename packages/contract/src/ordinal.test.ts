import { expect, test } from "vitest";
import { parseIcu, pluralBranch, pluralCategoriesFor } from "./icu";
import { renderPreview } from "./preview";
import { validateTranslation } from "./validate";

// ICU's selectordinal (#995): a plural by CLDR's ordinal rules.
const source =
  "{age, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} birthday";

test("selectordinal reads as an ordinal plural, # its count, other required", () => {
  const read = parseIcu(source);
  expect(read.ok && read.nodes[0]).toMatchObject({
    kind: "plural",
    ordinal: true,
    arg: "age",
  });
  expect(parseIcu("{n, selectordinal, one {#st}}").ok).toBe(false);
  expect(
    parseIcu(
      "{g, select, f {{n, selectordinal, one {#.} other {#.}}} other {x}}",
    ).ok,
  ).toBe(true);
});

test("its categories are the language's ordinal ones", () => {
  expect(pluralCategoriesFor("en", "icu", undefined, true).required).toEqual([
    "one",
    "two",
    "few",
    "other",
  ]);
  expect(pluralCategoriesFor("fr", "icu", undefined, true).required).toEqual([
    "one",
    "other",
  ]);
  expect(pluralCategoriesFor("de", "icu", undefined, true).required).toEqual([
    "other",
  ]);
  expect(
    pluralBranch({ one: 1, two: 1, few: 1, other: 1 }, "22", "en", {
      ordinal: true,
    }),
  ).toBe("two");
  expect(pluralBranch({ one: 1, other: 1 }, "22", "en")).toBe("other");
});

test("a translation keeps the ordinal, by its language's ordinal rules", () => {
  expect(
    validateTranslation(
      source,
      "{age, selectordinal, one {#er} other {#ème}} anniversaire",
      "fr",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{age, selectordinal, one {#er} two {#ème} few {#ème} other {#ème}} anniversaire",
      "fr",
    ),
  ).toEqual({
    ok: true,
    incomplete: [
      { code: "unexpected-category", arg: "age", key: "two" },
      { code: "unexpected-category", arg: "age", key: "few" },
    ],
  });
  expect(
    validateTranslation(
      source,
      "{age, selectordinal, one {#st} few {#rd} other {#th}} birthday",
      "en-GB",
    ),
  ).toEqual({
    ok: true,
    incomplete: [{ code: "missing-category", arg: "age", key: "two" }],
  });
  // German has one ordinal form: the text may be plain, its count kept.
  expect(validateTranslation(source, "{age}. Geburtstag", "de")).toEqual({
    ok: true,
  });
  // A cardinal for an ordinal, or the reverse, is the wrong plural.
  const cardinal = validateTranslation(
    source,
    "{age, plural, one {#er} other {#ème}} anniversaire",
    "fr",
  );
  expect(cardinal.ok ? [] : cardinal.errors).toEqual([
    { code: "changed-ordinal", arg: "age", ordinal: true },
  ]);
  const ordinal = validateTranslation(
    "{n, plural, one {# day} other {# days}}",
    "{n, selectordinal, one {#er jour} other {#e jour}}",
    "fr",
  );
  expect(ordinal.ok ? [] : ordinal.errors).toEqual([
    { code: "changed-ordinal", arg: "n", ordinal: false },
  ]);
});

test("a preview takes the ordinal branch", () => {
  expect(renderPreview(source, { age: "22" }, "en")).toEqual({
    ok: true,
    text: "22nd birthday",
  });
  expect(renderPreview(source, { age: "3" }, "en")).toEqual({
    ok: true,
    text: "3rd birthday",
  });
});

test("a cardinal and an ordinal on one argument are each judged by their own rule (#995 review)", () => {
  const both =
    "{n, plural, one {# day} other {# days}}, the {n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
  // de keeps the cardinal and writes the one-form ordinal plainly.
  expect(
    validateTranslation(
      both,
      "{n, plural, one {# Tag} other {# Tage}}, der {n}.",
      "de",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      both,
      "{n, plural, one {# Tag} other {# Tage}}, der {n, selectordinal, other {#.}}",
      "de",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      both,
      "{n, plural, one {# день} few {# дня} many {# дней} other {# дня}}, {n, selectordinal, other {#-й}}",
      "ru",
    ),
  ).toEqual({ ok: true });
  const lacking = validateTranslation(
    both,
    "{n, plural, one {# день} other {# дня}}, {n, selectordinal, other {#-й}}",
    "ru",
  );
  expect(lacking.ok && lacking.incomplete).toEqual([
    { code: "missing-category", arg: "n", key: "few" },
    { code: "missing-category", arg: "n", key: "many" },
  ]);
});

test("the fluent reading refuses a selectordinal, which Fluent writes with NUMBER (#995 review)", () => {
  const read = parseIcu(
    "{pos, selectordinal, one {#er} other {#e}} place",
    "fluent",
  );
  expect(read.ok).toBe(false);
  expect(read.ok ? "" : read.errors[0]?.message).toMatch(
    /NUMBER\(\$pos, type: "ordinal"\)/,
  );
});
