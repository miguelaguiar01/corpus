// vue-i18n's two departures from plain ICU (#495, #496): a top-level
// pipe separates positional plural forms, and `{'…'}` is a literal.
import { expect, test } from "vitest";
import { parseIcu } from "./icu";
import { validateTranslation } from "./validate";

const nodes = (source: string, library: "vue" | "icu" = "vue") => {
  const result = parseIcu(source, library);
  if (!result.ok) throw new Error(result.errors[0]!.message);
  return result.nodes;
};

test("a top-level pipe separates plural forms, each keeping its placeholders", () => {
  expect(nodes("{count} comment | {count} comments")).toEqual([
    {
      kind: "forms",
      branches: [
        [
          { kind: "placeholder", name: "count" },
          { kind: "literal", text: " comment" },
        ],
        [
          { kind: "placeholder", name: "count" },
          { kind: "literal", text: " comments" },
        ],
      ],
    },
  ]);
});

test("one form is not a plural", () => {
  expect(nodes("Just a sentence")).toEqual([
    { kind: "literal", text: "Just a sentence" },
  ]);
});

test("a quoted literal is text, not a placeholder", () => {
  // Vikunja's user.auth.emailPlaceholder, which plain ICU refuses.
  expect(nodes("e.g. frederic{'@'}vikunja.io")).toEqual([
    { kind: "literal", text: "e.g. frederic" },
    { kind: "literal", text: "@" },
    { kind: "literal", text: "vikunja.io" },
  ]);
  expect(parseIcu("e.g. frederic{'@'}vikunja.io", "icu").ok).toBe(false);
});

test("a pipe inside a literal is text, not a separator", () => {
  // Vikunja's migrate.csv.delimiters.pipe, "Pipe ({'|'})".
  const parsed = nodes("Pipe ({'|'})");
  expect(parsed.some((node) => node.kind === "forms")).toBe(false);
  expect(parsed).toContainEqual({ kind: "literal", text: "|" });
});

test("a brace and a literal brace are both writable", () => {
  expect(nodes("{'{'}")).toEqual([{ kind: "literal", text: "{" }]);
  expect(nodes("{name}")).toEqual([{ kind: "placeholder", name: "name" }]);
});

test("a translation has as many forms as its source", () => {
  // vue-i18n's rule is keyed on how many forms the message has, and a
  // project may register one that expects an exact count, so the source
  // is what a translation must match — not the language's categories.
  const source = "{count} comment | {count} comments";
  expect(
    validateTranslation(
      source,
      "{count} комментарий | {count} комментария",
      "ru",
      "vue",
    ),
  ).toEqual({ ok: true });
  // Dropping a form, or inventing one, is the defect.
  expect(
    validateTranslation(source, "{count} 件のコメント", "ja", "vue"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-form", have: 1, need: 2 }],
  });
  expect(
    validateTranslation(
      source,
      "{count} a | {count} b | {count} c",
      "ru",
      "vue",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "unexpected-form", have: 3, need: 2 }],
  });
  // A source with no plural and a translation that invents one.
  expect(
    validateTranslation(
      "{count} comments",
      "{count} a | {count} b",
      "de",
      "vue",
    ),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "unexpected-form", have: 2, need: 1 }],
  });
});

test("a quoted brace closes where the quotes end", () => {
  expect(nodes("{'}'}")).toEqual([{ kind: "literal", text: "}" }]);
  expect(nodes("a {'|'} b")).toEqual([
    { kind: "literal", text: "a " },
    { kind: "literal", text: "|" },
    { kind: "literal", text: " b" },
  ]);
});

test("a placeholder must survive into every form", () => {
  const source = "{count} comment | {count} comments";
  // German uses the two English does, so the count is the source's.
  expect(
    validateTranslation(
      source,
      "{count} Kommentar | {count} Kommentare",
      "de",
      "vue",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(source, "ein Kommentar | Kommentare", "de", "vue"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
});
