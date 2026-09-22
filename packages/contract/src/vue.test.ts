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

test("an unescaped pipe still splits, which is what #539 is about", () => {
  // Vikunja's migrate.csv.delimiters.pipe is "Pipe (|)", without the
  // escape above, and vue-i18n reads it as two forms exactly as this
  // does — so the catalogue is what is wrong. What #495 asked for and
  // #536 did not deliver is that Corpus name it rather than split it in
  // silence; this pins what it does until then.
  expect(nodes("Pipe (|)")).toEqual([
    {
      kind: "forms",
      branches: [
        [{ kind: "literal", text: "Pipe (" }],
        [{ kind: "literal", text: ")" }],
      ],
    },
  ]);
  expect(validateTranslation("Pipe (|)", "Труба", "ru", "vue")).toEqual({
    ok: true,
  });
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
