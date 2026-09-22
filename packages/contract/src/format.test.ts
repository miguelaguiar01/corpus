// ICU's formatted placeholders (#555): {n, number}, {d, date, short},
// {t, time}, with an optional style. A placeholder with a format, which
// react-intl and svelte-i18n write every day.
import { expect, test } from "vitest";
import { parseIcu, placeholderFormatsOf, placeholdersOf } from "./icu";
import { renderPreview } from "./preview";
import { validateTranslation } from "./validate";

const nodes = (source: string) => {
  const result = parseIcu(source);
  if (!result.ok) throw new Error(result.errors[0]!.message);
  return result.nodes;
};

test("number, date and time are placeholders that keep their format", () => {
  expect(nodes("{count, number} places")).toEqual([
    { kind: "placeholder", name: "count", format: { type: "number" } },
    { kind: "literal", text: " places" },
  ]);
  expect(nodes("{d, date, short} at {t, time}")).toEqual([
    {
      kind: "placeholder",
      name: "d",
      format: { type: "date", style: "short" },
    },
    { kind: "literal", text: " at " },
    { kind: "placeholder", name: "t", format: { type: "time" } },
  ]);
  expect(nodes("{p, number, ::percent}")).toEqual([
    {
      kind: "placeholder",
      name: "p",
      format: { type: "number", style: "::percent" },
    },
  ]);
  // Immich's shape: a format inside a plural branch.
  expect(
    parseIcu("Every {hours, plural, one {hour} other {{hours, number} hours}}")
      .ok,
  ).toBe(true);
  expect(placeholdersOf("{count, number} of {total, number}")).toEqual(
    new Set(["count", "total"]),
  );
  expect(
    placeholderFormatsOf("{count, number, ::percent} {d, date} {x}"),
  ).toEqual(
    new Map([
      ["count", "number, ::percent"],
      ["d", "date"],
    ]),
  );
});

test("a format needs a name and a style with something in it", () => {
  expect(parseIcu("{n, number, }").ok).toBe(false);
  expect(parseIcu("{two words, number}").ok).toBe(false);
  expect(parseIcu("{n, choice, 0#x}").ok).toBe(false);
});

test("a translation keeps the placeholder's type and may change its style", () => {
  const source = "{count, number} places on {d, date, short}";
  expect(
    validateTranslation(
      source,
      "{count, number} lugares em {d, date, long}",
      "pt-PT",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(
      source,
      "{count, number} lugares em {d, date}",
      "pt-PT",
    ),
  ).toEqual({ ok: true });
  expect(
    validateTranslation(source, "{count} lugares em {d, date, short}", "pt-PT"),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        code: "unexpected-format",
        name: "count",
        expected: "number",
        actual: null,
      },
    ],
  });
  expect(
    validateTranslation(
      source,
      "{count, number} lugares em {d, time, short}",
      "pt-PT",
    ),
  ).toMatchObject({
    ok: false,
    errors: [
      {
        code: "unexpected-format",
        name: "d",
        expected: "date",
        actual: "time",
      },
    ],
  });
  // A plural on a number is the existing rule: the count is kept.
  expect(
    validateTranslation(
      "{n, number} items",
      "{n, plural, one {# item} other {# items}}",
      "en",
    ),
  ).toEqual({ ok: true });
});

test("a preview formats the example's value for the language when it can", () => {
  expect(renderPreview("{n, number} places", { n: "1234.5" }, "de")).toEqual({
    ok: true,
    text: "1.234,5 places",
  });
  expect(renderPreview("{p, number, percent}", { p: "0.25" }, "en")).toEqual({
    ok: true,
    text: "25%",
  });
  expect(
    renderPreview("{d, date, short}", { d: "2026-09-22" }, "en-GB"),
  ).toEqual({ ok: true, text: "22/09/2026" });
  // A value that is not a number or a date is shown as it is.
  expect(renderPreview("{n, number}", { n: "many" }, "en")).toEqual({
    ok: true,
    text: "Many",
  });
});
