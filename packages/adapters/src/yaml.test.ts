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
  // Another root is not this language's.
  expect(yamlTranslations(ptBR, "pt")).toEqual([]);
  expect(() => yamlTranslations("en: [unclosed", "en")).toThrow();
});
