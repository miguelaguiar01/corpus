// What to do about a refused source string (#486, #505): the advice the
// CLI and the server both append to a parse error, so every client
// reads the same clause.
import { expect, test } from "vitest";
import { parseIcu, refusalAdvice } from "./icu";

const adviceFor = (source: string, library: "icu" | "i18next" | "vue") => {
  const parsed = parseIcu(source, library);
  if (parsed.ok) throw new Error(`${source} parses`);
  return refusalAdvice(source, library, parsed.errors[0]!.message);
};

test("a tag left open, mismatched or stray says what a tag is and what to do", () => {
  expect(adviceFor("See https://example.com/<baseurl>", "icu")).toBe(
    "; a <name> is a rich-text tag: close it with </baseurl>, or write the brackets so they do not open a tag",
  );
  expect(adviceFor("<a>one</b>", "icu")).toBe(
    "; a <name> is a rich-text tag: <a> is open here, so write </a>, or remove both tags",
  );
  expect(adviceFor("stray </em> here", "icu")).toBe(
    "; a <name> is a rich-text tag: remove it, or open a matching <em>",
  );
});

test("a catalogue read under the wrong library is told which one", () => {
  expect(adviceFor("Hello {{ name }}", "icu")).toBe(
    '; {{ }} is i18next\'s interpolation: declare library: "i18next" on the source',
  );
  expect(adviceFor("{n, plural, one {# file} other {# files}}", "vue")).toBe(
    '; {name, plural, …} is an ICU argument: declare library: "icu" on the source, or leave the field out',
  );
});

test("a refusal with nothing to add gets no clause", () => {
  expect(adviceFor("{n, plural, one {x}}", "icu")).toBe("");
});

test("an ICU argument type of ICU's own draws no library advice (#557)", () => {
  // Immich: refused for `number`, and the `{{` is a branch opening with
  // a placeholder, which is plain ICU. i18next's `{{date, short}}` read
  // as ICU also fails on a type, but `short` is not one of ICU's.
  expect(
    adviceFor(
      "Every {hours, plural, one {hour} other {{hours, number} hours}}",
      "icu",
    ),
  ).toBe("");
  expect(
    adviceFor(
      "{count, plural, one {{count, number} Place} other {{count, number} Places}}",
      "icu",
    ),
  ).toBe("");
  expect(adviceFor("{{date, short}} left", "icu")).toBe(
    '; {{ }} is i18next\'s interpolation: declare library: "i18next" on the source',
  );
});
