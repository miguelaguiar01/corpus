import { expect, test } from "vitest";
import { yamlToEntries, yamlTranslations } from "./yaml";

// Discourse's shapes, cut down.
const EN = `en:
  js:
    user_api_key:
      title: 'Authorize "%{application_name}"'
      # Shown under the title
      deny: "Cancel"
    topic_count:
      one: "%{count} topic"
      other: "%{count} topics"
    traffic_info_footer_MF: |
      You have {total, plural, one {# request} other {# requests}}.
    unused: ~
    max: 5
  datetime_formats: &datetime_formats
    formats:
      short: "%m-%d-%Y"
  date:
    month_names: [~, January, February]
    <<: *datetime_formats
  time:
    <<: *datetime_formats
    am: "am"
`;

test("a Rails catalogue's strings: dotted ids under the root, plural hashes, _MF keys as ICU, anchors read once (#752)", () => {
  expect(yamlToEntries(EN, { type: "ui", root: "en" })).toEqual([
    {
      id: "js.user_api_key.title",
      type: "ui",
      source: 'Authorize "%{application_name}"',
    },
    {
      id: "js.user_api_key.deny",
      type: "ui",
      source: "Cancel",
      note: "Shown under the title",
    },
    {
      id: "js.topic_count",
      type: "ui",
      source: "{count, plural, one {%{count} topic} other {%{count} topics}}",
    },
    {
      id: "js.traffic_info_footer_MF",
      type: "ui",
      source: "You have {total, plural, one {# request} other {# requests}}.\n",
      library: "icu",
    },
    {
      id: "datetime_formats.formats.short",
      type: "ui",
      source: "%m-%d-%Y",
    },
    { id: "time.am", type: "ui", source: "am" },
  ]);
});

test("a target's translations are its strings under its own root key; a lone space is one (#752)", () => {
  const ptBR = `# WARNING: Never edit this file.\npt_BR:\n  js:\n    user_api_key:\n      deny: "Cancelar"\n      title: ""\n    number:\n      delimiter: " "\n`;
  expect(yamlTranslations(ptBR, "pt_BR")).toEqual([
    { id: "js.user_api_key.deny", type: "", source: "Cancelar" },
    { id: "js.number.delimiter", type: "", source: " " },
  ]);
  // A file with no root for its language is refused, naming its roots.
  expect(() => yamlTranslations(ptBR, "pt")).toThrow(
    "no root key pt: the file's root keys are pt_BR",
  );
  expect(() => yamlTranslations("en: [unclosed", "en")).toThrow();
});

test("a map's first key keeps its comment; a null form leaves a plural one; an empty plural is no translation; a number key as written (#752)", () => {
  const text = `en:
  datetime_formats:
    formats:
      # Format directives: strftime
      short: "%m-%d-%Y"
  plur:
    one: ~
    other: "%{count} things"
  blank:
    one: ""
    other: ""
  sizes:
    01: "One"
`;
  const entries = yamlToEntries(text, { type: "ui", root: "en" });
  expect(
    entries.find((e) => e.id === "datetime_formats.formats.short")?.note,
  ).toBe("Format directives: strftime");
  expect(entries.find((e) => e.id === "plur")?.source).toBe(
    "{count, plural, other {%{count} things}}",
  );
  expect(entries.map((e) => e.id)).toContain("sizes.01");
  expect(yamlTranslations(text, "en").map((e) => e.id)).not.toContain("blank");
});

test("a target stub reads no translations; a source with nothing under its root is refused (#752)", () => {
  expect(yamlTranslations("fr:\n", "fr")).toEqual([]);
  expect(yamlTranslations("# nothing yet\n", "fr")).toEqual([]);
  expect(yamlTranslations("", "fr")).toEqual([]);
  expect(yamlTranslations("fr: {}\n", "fr")).toEqual([]);
  expect(() => yamlToEntries("en:\n", { type: "ui", root: "en" })).toThrow(
    "no strings under en: the source language's file must hold them",
  );
  expect(() =>
    yamlToEntries('en_US:\n  a: "A"\n', { type: "ui", root: "en" }),
  ).toThrow(
    "no root key en: the file's root keys are en_US; the source language's file must be rooted at its code",
  );
  // A plural whose other is null is still one plural.
  expect(
    yamlToEntries('en:\n  p:\n    one: "a"\n    other: ~\n', {
      type: "ui",
      root: "en",
    }).map((e) => e.id),
  ).toEqual(["p"]);
});
