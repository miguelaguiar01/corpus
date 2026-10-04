// What to do about a refused source string (#486, #505): the advice the
// CLI and the server both append to a parse error, so every client
// reads the same clause.
import { expect, test } from "vitest";
import { parseIcu, refusalAdvice, refusalCause } from "./icu";

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

test("a quoted literal in braces is vue-i18n's literal interpolation, and builds under vue (#1046)", () => {
  // Chatwoot's login.json and integrations.json.
  expect(adviceFor("Email {'@'} domain", "icu")).toBe(
    `; {'@'} is vue-i18n's literal interpolation: declare library: "vue" on the source`,
  );
  expect(adviceFor("e.g. https://x.io/{'{{'}id{'}}'}", "icu")).toBe(
    `; {'{{'} is vue-i18n's literal interpolation: declare library: "vue" on the source`,
  );
  const parsed = parseIcu("Email {'@'} domain", "icu");
  expect(
    !parsed.ok &&
      refusalCause("Email {'@'} domain", "icu", parsed.errors[0]!.message),
  ).toBe("library");
  expect(parseIcu("Email {'@'} domain", "vue").ok).toBe(true);
  // Spaced or escaped, as vue-i18n reads a literal.
  expect(adviceFor("Email { '@' } domain", "icu")).toBe(
    `; { '@' } is vue-i18n's literal interpolation: declare library: "vue" on the source`,
  );
  expect(adviceFor("It{'\\''}s", "icu")).toBe(
    `; {'\\''} is vue-i18n's literal interpolation: declare library: "vue" on the source`,
  );
  // ICU's own apostrophe quoting of a brace is no vue literal, nor is a
  // literal vue refuses, nor a Fluent text's.
  for (const [source, library] of [
    ["Type '{'0'}' to insert it", "icu"],
    ["Type '{'0'}' to insert it", "gen_l10n"],
    ["It {'it''s'} here", "icu"],
    ["Email {'@'} domain", "fluent"],
    // vue refuses it too: the hint would send it back to icu.
    ["{n, plural, one {Email {'@'}} other {x}}", "icu"],
  ] as const) {
    const refused = parseIcu(source, library);
    const message = refused.ok ? "" : refused.errors[0]!.message;
    expect(refusalAdvice(source, library, message), source).not.toContain(
      "vue",
    );
    expect(refusalCause(source, library, message), source).toBeUndefined();
  }
});

test("a refusal with nothing to add gets no clause", () => {
  expect(adviceFor("{n, plural, one {x}}", "icu")).toBe("");
});

test("an ICU argument type of ICU's own draws no library advice (#557)", () => {
  // Immich's strings parse since #555; a type Corpus still lacks, in
  // the same shape (a branch opening with a placeholder puts `{{` in
  // the string), is refused with no library advice. i18next's
  // `{{date, short}}` read as ICU also fails on a type, but `short` is
  // not one of ICU's, so it still draws the advice.
  expect(
    parseIcu(
      "Every {hours, plural, one {hour} other {{hours, number} hours}}",
      "icu",
    ).ok,
  ).toBe(true);
  expect(adviceFor("{n, plural, one {{n, spellout} x} other {y}}", "icu")).toBe(
    "",
  );
  expect(adviceFor("{n, plural, one {{n, duration} x} other {y}}", "icu")).toBe(
    "",
  );
  expect(adviceFor("{{date, short}} left", "icu")).toBe(
    '; {{ }} is i18next\'s interpolation: declare library: "i18next" on the source',
  );
});

test("an ICU error that is not about the braces draws no library advice", () => {
  // Each holds `{{` from a branch opening with a placeholder, and each
  // is refused for a reason of its own.
  for (const source of [
    "{n, plural, one {{count} apple}",
    "{n, plural, one {{count} apple} other {{n, plural, one {x} other {y}}}}",
    "{n, plural, one {{count} x} two {y}}",
  ]) {
    expect(adviceFor(source, "icu"), source).toBe("");
  }
});
