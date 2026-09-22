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
  // The escape a catalogue writes for a pipe it means literally.
  const parsed = nodes("Pipe ({'|'})");
  expect(parsed.some((node) => node.kind === "forms")).toBe(false);
  expect(parsed).toContainEqual({ kind: "literal", text: "|" });
});

test("a form of nothing but punctuation is a pipe meant literally (#539)", () => {
  // Vikunja's migrate.csv.delimiters.pipe is "Pipe (|)": a label for the
  // CSV delimiter, without the escape above. vue-i18n reads it as two
  // forms and renders "Pipe (" — the catalogue is what is wrong, so
  // Corpus names it rather than split it in silence.
  const parsed = parseIcu("Pipe (|)", "vue");
  expect(parsed).toEqual({
    ok: false,
    errors: [
      {
        message:
          "a plural form has no words: \")\"; a pipe meant literally is written {'|'}",
        position: 7,
      },
    ],
  });
  expect(validateTranslation("Pipe (|)", "Труба", "ru", "vue")).toMatchObject({
    ok: false,
    errors: [{ code: "invalid-icu", position: 7 }],
  });
  // The refusal points at the form, wherever it sits.
  expect(parseIcu("(|) pipe", "vue")).toMatchObject({
    ok: false,
    errors: [{ position: 0 }],
  });
  expect(parseIcu("a | b | !", "vue")).toMatchObject({
    ok: false,
    errors: [{ message: expect.stringContaining('"!"'), position: 8 }],
  });
  for (const punctuation of ["—", "...", "%", "#"]) {
    expect(parseIcu(`x | ${punctuation}`, "vue").ok, punctuation).toBe(false);
  }
});

test("a form is a form when it holds a word, a number, a symbol or a brace", () => {
  // A digit, a placeholder, a literal or an emoji alone is content: a
  // form is refused only when it holds nothing but punctuation.
  for (const source of [
    "{count} | {count}",
    "1 | 2",
    "{'@'} | {'@'}",
    "x | y",
    "⭐ | ⭐⭐ | ⭐⭐⭐",
    "$ | $$",
    "一 | 二",
  ]) {
    expect(parseIcu(source, "vue").ok, source).toBe(true);
  }
});

test("a brace and a literal brace are both writable", () => {
  expect(nodes("{'{'}")).toEqual([{ kind: "literal", text: "{" }]);
  expect(nodes("{name}")).toEqual([{ kind: "placeholder", name: "name" }]);
});

test("the form count is not judged, because the project owns the rule", () => {
  // vue-i18n picks a form by how many there are, through whatever rule
  // the project registered: Vikunja's Russian rule fires only at three
  // forms, where CLDR gives Russian four. Corpus cannot know the rule,
  // so it refuses no count that a project may render correctly.
  const source = "{count} comment | {count} comments";
  for (const target of [
    "{count} комментарий",
    "{count} комментарий | {count} комментария",
    "{count} комментарий | {count} комментария | {count} комментариев",
  ]) {
    expect(validateTranslation(source, target, "ru", "vue")).toEqual({
      ok: true,
    });
  }
});

test("a placeholder must survive into every form", () => {
  const source = "{count} comment | {count} comments";
  expect(
    validateTranslation(source, "ein Kommentar | Kommentare", "de", "vue"),
  ).toMatchObject({
    ok: false,
    errors: [{ code: "missing-placeholder", name: "count" }],
  });
});

test("an empty form is refused, as vue-i18n's own compiler refuses it", () => {
  for (const bad of ["a |", "| b", "a || b", "|"]) {
    const parsed = parseIcu(bad, "vue");
    expect(parsed.ok, bad).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]!.message).toMatch(/form is empty/);
  }
  expect(parseIcu("a | b", "vue").ok).toBe(true);
});

test("a quoted brace closes where the quotes end", () => {
  expect(nodes("{'}'}")).toEqual([{ kind: "literal", text: "}" }]);
  expect(nodes("a {'|'} b")).toEqual([
    { kind: "literal", text: "a " },
    { kind: "literal", text: "|" },
    { kind: "literal", text: " b" },
  ]);
});

test("an escaped quote stays inside the literal", () => {
  expect(nodes("{'it\\'s'}")).toEqual([{ kind: "literal", text: "it's" }]);
});
