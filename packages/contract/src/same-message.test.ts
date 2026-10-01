import { expect, test } from "vitest";
import { sameMessage } from "./icu";

const EN =
  "You have {messageCount, plural, one {# unread message} other {# unread messages}}.";
const DE =
  "{messageCount, plural, one {You have {messageCount,number} unread message.} other {You have {messageCount,number} unread messages.}}";

test("an ICU text restructured as FormatJS renders it the same is the same message (#1009)", () => {
  expect(sameMessage(EN, DE, "icu")).toBe(true);
  expect(sameMessage(DE, EN, "icu")).toBe(true);
  expect(sameMessage(EN, EN, "icu")).toBe(true);
  // A select hoisted over a plural, and text distributed into both.
  expect(
    sameMessage(
      "{g, select, f {She} other {They}} sent {n, plural, one {# file} other {# files}}",
      "{n, plural, one {{g, select, f {She sent {n, number} file} other {They sent {n, number} file}}} other {{g, select, f {She sent {n, number} files} other {They sent {n, number} files}}}}",
      "icu",
    ),
  ).toBe(true);
  // Tags and formats are compared as read, not as spaced.
  expect(
    sameMessage(
      "<b>{d, date, short}</b> {n, plural, other {# x}}",
      "{n, plural, other {<b>{d,date,short}</b> {n, number} x}}",
      "icu",
    ),
  ).toBe(true);
});

test("a text that differs in words, a branch, or its keys is another message (#1009)", () => {
  expect(
    sameMessage(EN, DE.replace("unread messages.", "messages."), "icu"),
  ).toBe(false);
  expect(
    sameMessage(
      "{n, plural, one {# item} other {# items}}",
      "{n, plural, one {# item} other {# things}}",
      "icu",
    ),
  ).toBe(false);
  // A `#` in a select inside the plural is the character, as FormatJS
  // reads it (#923).
  expect(
    sameMessage(
      "{n, plural, other {{g, select, other {# x}}}}",
      "{n, plural, other {{g, select, other {{n, number} x}}}}",
      "icu",
    ),
  ).toBe(false);
  // `=1` is not `one` in every language.
  expect(
    sameMessage(
      "{n, plural, one {# item} other {# items}}",
      "{n, plural, =1 {# item} other {# items}}",
      "icu",
    ),
  ).toBe(false);
  // A plural is not an ordinal, nor a select.
  expect(
    sameMessage(
      "{n, plural, other {#}}",
      "{n, selectordinal, other {#}}",
      "icu",
    ),
  ).toBe(false);
  expect(
    sameMessage("{n, plural, other {x}}", "{n, select, other {x}}", "icu"),
  ).toBe(false);
  // A placeholder's format is part of it.
  expect(
    sameMessage("{n, plural, other {#}}", "{n, plural, other {{n}}}", "icu"),
  ).toBe(false);
  expect(sameMessage("Hi {name}", "Hi {name", "icu")).toBe(false);
});

test("outside ICU, the same message is the same bytes (#1009)", () => {
  expect(sameMessage("Hi %s", "Hi %s", "printf")).toBe(true);
  expect(sameMessage(EN, DE, "i18next")).toBe(false);
  expect(sameMessage(EN, DE, "fluent")).toBe(false);
});
