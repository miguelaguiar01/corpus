import { expect, test } from "vitest";
import type { Library } from "./strings";
import { moonlightManor } from "./fixtures/moonlight-manor";
import { pluralBranch, pluralCategoriesFor } from "./icu";
import {
  exampleValues,
  previewsFor,
  renderPreview,
  renderPreviewSegments,
} from "./preview";

const sighting = moonlightManor.strings[0]!;
const [first, second] = sighting.examples!;

test("renders the fixture's examples exactly as the client rendered them", () => {
  expect(renderPreview(sighting.source, first!.values)).toEqual({
    ok: true,
    text: first!.rendered,
  });
  expect(renderPreview(sighting.source, second!.values)).toEqual({
    ok: true,
    text: second!.rendered,
  });
});

test("segments tell the example's values apart from the draft's words", () => {
  const draft = "{person} was seen at the {room_de} window.";
  const result = renderPreviewSegments(draft, first!.values);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.segments).toEqual([
    { text: "A Condessa Rosa", value: true },
    { text: " was seen at the ", value: false },
    { text: "da estufa", value: true },
    { text: " window.", value: false },
  ]);
  expect(result.segments.map((s) => s.text).join("")).toBe(
    renderPreview(draft, first!.values).ok
      ? (renderPreview(draft, first!.values) as { text: string }).text
      : "",
  );
});

test("an empty leading value still capitalises the sentence", () => {
  expect(renderPreview("{a}bcd", { a: "" })).toEqual({ ok: true, text: "Bcd" });
  expect(renderPreviewSegments("{a}bcd", { a: "" })).toEqual({
    ok: true,
    segments: [
      { text: "", value: true },
      { text: "Bcd", value: false },
    ],
  });
});

test("previewsFor renders one preview per example, in order", () => {
  expect(previewsFor(sighting.source, sighting.examples!)).toEqual([
    { ok: true, text: first!.rendered },
    { ok: true, text: second!.rendered },
  ]);
});

test("a draft with a collapsed select renders with the example values", () => {
  const draft =
    "{person} was seen at the {room_de} window at {hour} — and was not alone.";
  expect(renderPreview(draft, first!.values)).toEqual({
    ok: true,
    text: "A Condessa Rosa was seen at the da estufa window at 21h — and was not alone.",
  });
});

test("a leading slot value is capitalised; a leading literal is left alone", () => {
  expect(renderPreview("{who} saw it", { who: "o mordomo" })).toEqual({
    ok: true,
    text: "O mordomo saw it",
  });
  expect(renderPreview("by {who}", { who: "o mordomo" })).toEqual({
    ok: true,
    text: "by o mordomo",
  });
});

test("a missing value leaves the slot literally in the text", () => {
  expect(renderPreview("Seen at {hour} by {who}", { hour: "21h" })).toEqual({
    ok: true,
    text: "Seen at 21h by {who}",
  });
});

test("a select value with no matching branch falls back to `other`, then the first branch", () => {
  expect(renderPreview("{g, select, m {he} other {they}}", { g: "x" })).toEqual(
    { ok: true, text: "they" },
  );
  expect(renderPreview("{g, select, m {he} f {she}}", { g: "x" })).toEqual({
    ok: true,
    text: "he",
  });
  expect(renderPreview("{g, select, m {he} f {she}}", {})).toEqual({
    ok: true,
    text: "he",
  });
});

test("a malformed message is a typed error, never a throw", () => {
  const result = renderPreview("{person} foi {g, select, m {visto}", {});
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]).toMatchObject({ position: expect.any(Number) });
  }
});

test("no examples means no previews", () => {
  expect(previewsFor("Continuar", [])).toEqual([]);
});

test("the preview API is reachable from the package entry point", async () => {
  const entry = await import("./index");
  expect(typeof entry.renderPreview).toBe("function");
  expect(typeof entry.previewsFor).toBe("function");
});

test("exampleValues picks the target language's values and says so, or falls back to the source", () => {
  expect(exampleValues(first!, "en", "pt-PT")).toEqual({
    values: first!.valuesByLanguage!.en,
    language: "en",
  });
  expect(exampleValues(first!, "fr", "pt-PT")).toEqual({
    values: first!.values,
    language: "pt-PT",
  });
  expect(exampleValues({ values: { a: "b" } }, "en", "pt-PT")).toEqual({
    values: { a: "b" },
    language: "pt-PT",
  });
});

test("an English draft previews as the English sentence with English values", () => {
  const draft =
    "{person} was seen at the {room_de} window at {hour} — and was not alone.";
  expect(
    previewsFor(draft, sighting.examples!, { target: "en", source: "pt-PT" }),
  ).toEqual([
    {
      ok: true,
      text: "Countess Rosa was seen at the greenhouse window at 9 pm — and was not alone.",
    },
    {
      ok: true,
      text: "Doctor Vaz was seen at the drawing room window at 11 pm — and was not alone.",
    },
  ]);
  // Without a language, or for one the example lacks, the source values.
  expect(previewsFor(draft, sighting.examples!)[0]).toEqual({
    ok: true,
    text: "A Condessa Rosa was seen at the da estufa window at 21h — and was not alone.",
  });
});

test("a language's map is used whole: a slot it lacks stays literal, never the source's value", () => {
  expect(
    previewsFor(
      "{person} at {hour}",
      [
        {
          values: { person: "a", hour: "21h" },
          valuesByLanguage: { en: { person: "A" } },
        },
      ],
      { target: "en", source: "pt-PT" },
    ),
  ).toEqual([{ ok: true, text: "A at {hour}" }]);
});

test("a plural renders its count's branch: exact first, then the language's category, then other, with # as the count", () => {
  const message =
    "{n, plural, =0 {No marks left.} one {# mark left.} other {# marks left.}}";
  expect(renderPreview(message, { n: "0" }, "en")).toEqual({
    ok: true,
    text: "No marks left.",
  });
  expect(renderPreview(message, { n: "1" }, "en")).toEqual({
    ok: true,
    text: "1 mark left.",
  });
  expect(renderPreview(message, { n: "3" }, "en")).toEqual({
    ok: true,
    text: "3 marks left.",
  });
  // The count is the example's value, so the segments tell it apart.
  expect(renderPreviewSegments(message, { n: "3" }, "en")).toEqual({
    ok: true,
    segments: [
      { text: "3", value: true },
      { text: " marks left.", value: false },
    ],
  });
  // No value: other, with # left as written.
  expect(renderPreview(message, {})).toEqual({
    ok: true,
    text: "# marks left.",
  });
  // The language decides the category: 3 is few in Russian, other in English.
  const ru =
    "{n, plural, one {# метка} few {# метки} many {# меток} other {# метки}}";
  expect(renderPreview(ru, { n: "3" }, "ru")).toEqual({
    ok: true,
    text: "3 метки",
  });
  expect(renderPreview(ru, { n: "5" }, "ru")).toEqual({
    ok: true,
    text: "5 меток",
  });
  expect(
    previewsFor(message, [{ values: { n: "1" } }, { values: { n: "2" } }], {
      target: "en",
      source: "pt-PT",
    }),
  ).toEqual([
    { ok: true, text: "1 mark left." },
    { ok: true, text: "2 marks left." },
  ]);
});

test("capitalise: false keeps a leading value as given, for chrome rendered through the engine", () => {
  expect(renderPreview("{name} joined", { name: "ana" })).toEqual({
    ok: true,
    text: "Ana joined",
  });
  expect(
    renderPreview("{name} joined", { name: "ana" }, "en", {
      capitalise: false,
    }),
  ).toEqual({ ok: true, text: "ana joined" });
});

test("a preview shows what a tag wraps, without the tag", () => {
  expect(
    renderPreview("Accept the <link>terms</link> for {name}. <icon/>", {
      name: "Ana",
    }),
  ).toEqual({ ok: true, text: "Accept the terms for Ana. " });
});

test("an i18next message previews with its values substituted", () => {
  expect(
    renderPreview(
      "{{ count }} documents starred by {{user.name}}",
      { count: "3", "user.name": "Ana" },
      "en",
      {
        syntax: "i18next",
      },
    ),
  ).toEqual({ ok: true, text: "3 documents starred by Ana" });
});

test("a printf plural on argN takes the Nth argument's value (#735)", () => {
  expect(
    renderPreview(
      "{arg1, plural, one {%arg recent post} other {%arg recent posts}} from {arg2, plural, one {%arg participant} other {%arg participants}}",
      { "1": "1", "2": "3" },
      "en",
      { syntax: "printf" },
    ),
  ).toEqual({ ok: true, text: "1 recent post from 3 participants" });
});

test("a preview renders a plural nested in a select's branch (#764)", () => {
  const source =
    "{g, select, female {{n, plural, one {She has # file} other {She has # files}}} other {{n, plural, one {# file} other {# files}}}}";
  expect(renderPreview(source, { g: "female", n: "3" }, "en")).toMatchObject({
    ok: true,
    text: "She has 3 files",
  });
  expect(renderPreview(source, { g: "x", n: "1" }, "en")).toMatchObject({
    ok: true,
    text: "1 file",
  });
});

test("a printf plural on count with no count value previews from slot 1, as ngettext passes one n to both (#775)", () => {
  const cards = "{count, plural, one {%d card} other {%d cards}}";
  expect(renderPreview(cards, { 1: "1" }, "en", { syntax: "printf" })).toEqual({
    ok: true,
    text: "1 card",
  });
  expect(renderPreview(cards, { 1: "3" }, "en", { syntax: "printf" })).toEqual({
    ok: true,
    text: "3 cards",
  });
  expect(
    renderPreview(cards, { count: "1", 1: "1" }, "en", { syntax: "printf" }),
  ).toEqual({ ok: true, text: "1 card" });
  // An example's own count wins.
  expect(
    renderPreview(cards, { count: "1", 1: "5" }, "en", { syntax: "printf" }),
  ).toEqual({ ok: true, text: "5 card" });
  // ICU has no positions: a plural with no value reads other, as before.
  expect(
    renderPreview(
      "{n, plural, one {# card} other {# cards}}",
      { 1: "1" },
      "en",
    ),
  ).toMatchObject({ ok: true, text: "# cards" });
});

test("a value, branch or placeholder named like an Object.prototype member is one like any other (#846)", () => {
  const select = "{role, select, admin {Admin} other {User}}";
  for (const role of ["constructor", "toString", "__proto__"])
    expect(renderPreview(select, { role })).toEqual({ ok: true, text: "User" });
  expect(
    renderPreview("{g, select, __proto__ {P} other {O}}", { g: "__proto__" }),
  ).toEqual({ ok: true, text: "P" });
  expect(renderPreview("Hi {constructor}", {})).toEqual({
    ok: true,
    text: "Hi {constructor}",
  });
  for (const count of ["constructor", "toString", "__proto__"])
    expect(
      renderPreview(
        `{${count}, plural, one {%d file} other {%d files}}`,
        { "1": "1" },
        "en",
        { syntax: "printf" },
      ),
    ).toEqual({ ok: true, text: "1 file" });
  expect(renderPreview("Hi {toString}", { toString: "you" })).toEqual({
    ok: true,
    text: "Hi you",
  });
});

test("preview: a number is a date's epoch milliseconds, a value i18next's example lacks shows in i18next's form, and an empty count is no count (#859)", () => {
  const at = Date.UTC(2023, 10, 14, 12);
  const long = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(at);
  expect(renderPreview("{d, date, long}", { d: String(at) }, "en")).toEqual({
    ok: true,
    text: long,
  });
  expect(renderPreview("{d, date, long}", { d: "5" }, "en")).toEqual({
    ok: true,
    text: new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(5),
  });
  expect(
    renderPreview("Hello {{name}} and {{- raw}}", {}, "en", {
      syntax: "i18next",
    }),
  ).toEqual({ ok: true, text: "Hello {{name}} and {{- raw}}" });
  // In i18next's form, not as the source spaced or formatted it.
  expect(
    renderPreview("{{ count }} of {{val, number}}", {}, "en", {
      syntax: "i18next",
    }),
  ).toEqual({ ok: true, text: "{{count}} of {{val}}" });
  expect(
    renderPreview(
      "{n, plural, one {# x} many {# m} other {# o}}",
      { n: "" },
      "ru",
    ),
  ).toEqual({ ok: true, text: " o" });
});

test("a plural previews the branch its library's runtime picks, as validation expects it (#963)", () => {
  const show = (text: string, n: string, syntax: Library) => {
    const read = renderPreview(text, { count: n }, "pl", { syntax });
    return read.ok ? read.text : read;
  };
  const polish =
    "{count, plural, one {jeden} few {kilka} many {wiele} other {inne}}";
  // counterpart: English's rule in every language, zero where written.
  expect(show(polish, "3", "counterpart")).toBe("inne");
  expect(show(polish, "0", "counterpart")).toBe("inne");
  expect(show(polish, "1", "counterpart")).toBe("jeden");
  expect(
    show(
      "{count, plural, zero {zero} one {jeden} other {inne}}",
      "0",
      "counterpart",
    ),
  ).toBe("zero");
  // An =N branch is none of its runtime's (#964).
  expect(
    show(
      "{count, plural, =1 {dokładnie} one {jeden} other {inne}}",
      "1",
      "counterpart",
    ),
  ).toBe("jeden");
  // easy_localization: the value, 0, 1 and 2, where written.
  const byValue =
    "{count, plural, zero {zero} one {jeden} two {dwa} other {inne}}";
  expect(show(byValue, "0", "easy_localization")).toBe("zero");
  expect(show(byValue, "2", "easy_localization")).toBe("dwa");
  expect(show(polish, "3", "easy_localization")).toBe("inne");
  // ICU picks by CLDR, as before.
  expect(show(polish, "3", "icu")).toBe("kilka");
});

test("preview: a plural under a table of picked forms shows other where the table has no form, as validation reads it (#963)", () => {
  const show = (
    text: string,
    n: string,
    lang: string,
    pluralForms: string[],
  ) => {
    const read = renderPreview(text, { count: n }, lang, {
      syntax: "rails",
      pluralForms,
    });
    return read.ok ? read.text : read;
  };
  const three = "{count, plural, one {uno} many {muchos} other {otros}}";
  expect(show(three, "1000000", "es", ["one", "other"])).toBe("otros");
  expect(
    show("{count, plural, one {bir} other {çox}}", "1", "az", ["other"]),
  ).toBe("çox");
  expect(
    show("{count, plural, one {a} few {b} many {c} other {d}}", "1.5", "cs", [
      "one",
      "few",
      "other",
    ]),
  ).toBe("d");
  // zero is still Rails' at 0 where written.
  expect(
    show("{count, plural, zero {nic} one {a} other {d}}", "0", "cs", [
      "one",
      "few",
      "other",
    ]),
  ).toBe("nic");
});

test("preview: the branch a plural previews is one its validation allows, for every library (#963)", () => {
  const libraries = [
    "icu",
    "i18next",
    "rails",
    "counterpart",
    "easy_localization",
    "printf",
    "vue",
    "qt",
    "chrome",
    "android",
    "fluent",
  ] as const;
  const languages = [
    "en",
    "pl",
    "ru",
    "ar",
    "cy",
    "fr",
    "ja",
    "cs",
    "he",
    "lv",
  ];
  const all = Object.fromEntries(
    ["zero", "one", "two", "few", "many", "other"].map((c) => [c, []]),
  );
  for (const library of libraries)
    for (const language of languages) {
      const { allowed } = pluralCategoriesFor(language, library);
      for (let n = 0; n < 120; n++)
        for (const value of [String(n), `${n}.5`])
          expect(allowed).toContain(
            pluralBranch(all, value, language, { library }),
          );
    }
  // And easy_localization by intl's table (#961), a language it lacks
  // by value.
  for (const language of [...languages, "mt", "ckb", "pt-PT", "br"]) {
    const { allowed } = pluralCategoriesFor(
      language,
      "easy_localization",
      undefined,
      false,
      "cldr",
    );
    for (let n = 0; n < 120; n++)
      for (const value of [String(n), `${n}.5`])
        expect(allowed).toContain(
          pluralBranch(all, value, language, {
            library: "easy_localization",
            rules: "cldr",
          }),
        );
  }
});

test('preview: easy_localization with pluralRules: "cldr" shows CLDR\'s branch, a written zero no longer taking 0 (#961)', () => {
  const text =
    "{count, plural, zero {zero} one {jeden} few {kilka} many {wiele} other {inne}}";
  const show = (n: string) => {
    const read = renderPreview(text, { count: n }, "pl", {
      syntax: "easy_localization",
      pluralRules: "cldr",
    });
    return read.ok ? read.text : read;
  };
  expect(show("3")).toBe("kilka");
  expect(show("0")).toBe("wiele");
  expect(show("1")).toBe("jeden");
});

test("preview: easy_localization's \"cldr\" is intl's own table, by the language code, by value for a code it lacks (#961)", () => {
  const show = (text: string, n: string, language: string) => {
    const read = renderPreview(text, { count: n }, language, {
      syntax: "easy_localization",
      pluralRules: "cldr",
    });
    return read.ok ? read.text : read;
  };
  const all =
    "{count, plural, zero {Z} one {O} two {T} few {F} many {M} other {X}}";
  // Maltese: intl has no two, and picks few at 2.
  expect(show(all, "2", "mt")).toBe("F");
  // Portuguese is looked up as pt, whatever the region: one at 0.
  expect(show(all, "0", "pt-PT")).toBe("O");
  // French millions are other; Hebrew 20 is many.
  expect(show(all, "1000000", "fr")).toBe("X");
  expect(show(all, "20", "he")).toBe("M");
  // A code intl lacks picks by value, as the package falls back.
  expect(show(all, "0", "ckb-KU")).toBe("Z");
  expect(show(all, "2", "ckb-KU")).toBe("T");
});
