import { expect, test } from "vitest";
import {
  applyYamlOps,
  entriesToYaml,
  yamlToEntries,
  yamlTranslations,
} from "./yaml";

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
  // A hash of null forms alone is nothing to translate.
  expect(
    yamlToEntries("en:\n  p:\n    one: ~\n    other: ~\n  q: Q\n", {
      type: "ui",
      root: "en",
    }).map((e) => e.id),
  ).toEqual(["q"]);
  // A plural whose other is null is still one plural.
  expect(
    yamlToEntries('en:\n  p:\n    one: "a"\n    other: ~\n', {
      type: "ui",
      root: "en",
    }).map((e) => e.id),
  ).toEqual(["p"]);
});

const DE = `# WARNING: Never edit this file.
de:
  js:
    user_api_key:
      title: 'Autorisiere "%{application_name}"'
      deny: Abbrechen
    topic_count:
      one: "%{count} Thema"
      other: "%{count} Themen"
    traffic_info_footer_MF: |
      Du hast {total, plural, one {# Anfrage} other {# Anfragen}}.
  time:
    am: "vorm."
`;
const DE_LANG = { source: "en", code: "de" };
const own = (text: string, code = "de") =>
  Object.fromEntries(yamlTranslations(text, code).map((e) => [e.id, e.source]));

test("pulling a catalogue's own translations back writes the same bytes (#753)", () => {
  expect(entriesToYaml(EN, own(DE), DE, DE_LANG)).toBe(DE);
  const crlf = DE.replace(/\n/g, "\r\n");
  expect(entriesToYaml(EN, own(crlf), crlf, DE_LANG)).toBe(crlf);
});

test("a changed scalar keeps its style: plain, single-quoted, a | block; a plural form in its hash (#753)", () => {
  const out = entriesToYaml(
    EN,
    {
      "js.user_api_key.deny": "Nein danke",
      "js.user_api_key.title": 'Erlaube "%{application_name}"',
      "js.traffic_info_footer_MF":
        "Du hast {total, plural, one {# Anfrage} other {# Anfragen}} heute.\n",
      "js.topic_count":
        "{count, plural, one {%{count} Thema} other {%{count} Themen!}}",
    },
    DE,
    DE_LANG,
  );
  expect(out).toBe(
    DE.replace("deny: Abbrechen", "deny: Nein danke")
      .replace(
        "title: 'Autorisiere \"%{application_name}\"'",
        "title: 'Erlaube \"%{application_name}\"'",
      )
      .replace("Anfragen}}.\n", "Anfragen}} heute.\n")
      .replace('other: "%{count} Themen"', 'other: "%{count} Themen!"'),
  );
  // A plain scalar the text cannot be written as is double-quoted.
  expect(
    entriesToYaml(
      EN,
      { "js.user_api_key.deny": "Nein: danke #1" },
      DE,
      DE_LANG,
    ),
  ).toContain('deny: "Nein: danke #1"');
});

test("a key the file lacks goes in after its source neighbour, parents made; a missing file starts at its root (#753)", () => {
  const without = DE.replace("      deny: Abbrechen\n", "").replace(
    '  time:\n    am: "vorm."\n',
    "",
  );
  const back = entriesToYaml(
    EN,
    { "js.user_api_key.deny": "Abbrechen", "time.am": "vorm." },
    without,
    DE_LANG,
  );
  // Written plain where they read back (#1021).
  expect(back).toBe(DE.replace('am: "vorm."', "am: vorm."));
  const fresh = entriesToYaml(
    EN,
    {
      "js.topic_count":
        "{count, plural, one {%{count} tema} other {%{count} temas}}",
    },
    undefined,
    { source: "en", code: "pt_BR" },
  );
  expect(fresh).toBe(
    'pt_BR:\n  js:\n    topic_count:\n      one: "%{count} tema"\n      other: "%{count} temas"\n',
  );
  // A plural a hash cannot hold is refused.
  const refused: string[] = [];
  entriesToYaml(
    EN,
    { "js.topic_count": "{count, plural, =0 {nada} other {%{count}}}" },
    DE,
    DE_LANG,
    (id) => refused.push(id),
  );
  expect(refused).toEqual(["js.topic_count"]);
});

test("the writer's hard cases: YAML 1.1 keys and values, the source's shape, blocks, nulls, CRLF, order, flow stubs (#753)", () => {
  const en = `en:
  choices:
    "no": "No"
    "yes": "Yes"
  mf_MF: "{count, plural, one {# like} other {# likes}}"
  list:
    a: "A"
    b: "B"
    c: "C"
    d: "D"
  blk: |
    one
  after: "After"
  g:
    h: "H"
`;
  const L = { source: "en", code: "de" };
  // 1: a missing key Rails would read as false stays the string "no".
  let out = entriesToYaml(
    en,
    { "choices.no": "Nein" },
    'de:\n  choices:\n    "yes": "Ja"\n',
    L,
  );
  expect(yamlTranslations(out, "de").map((e) => e.id)).toContain("choices.no");
  // The file quotes its scalars, so a new one is quoted too (#1021).
  expect(out).toContain('"no": "Nein"');
  // 2: an _MF key the source writes as a scalar stays one, whatever its shape.
  out = entriesToYaml(
    en,
    { mf_MF: "{count, plural, one {# Like} other {# Likes}}" },
    'de:\n  mf_MF: "x"\n',
    L,
  );
  expect(out).toBe(
    'de:\n  mf_MF: "{count, plural, one {# Like} other {# Likes}}"\n',
  );
  // 3 and 4: a block changed beside an inserted key, and a block that
  // falls back to quotes, keep their line breaks.
  out = entriesToYaml(
    en,
    { blk: "x\n\n", after: "Nach" },
    "de:\n  blk: |\n    eins\n",
    L,
  );
  expect(yamlTranslations(out, "de")).toEqual([
    { id: "blk", type: "", source: "x\n\n" },
    { id: "after", type: "", source: "Nach" },
  ]);
  out = entriesToYaml(
    en,
    { blk: " lead\nx" },
    'de:\n  blk: |\n    eins\n  after: "A"\n',
    L,
  );
  expect(yamlTranslations(out, "de").map((e) => e.source)).toEqual([
    " lead\nx",
    "A",
  ]);
  // 5: a null value takes its text with a space, its comment kept.
  out = entriesToYaml(en, { after: "Hi" }, "de:\n  after: # c\n", L);
  expect(out).toBe("de:\n  after: Hi # c\n");
  // 6: a CRLF file's rewritten block keeps CRLF.
  out = entriesToYaml(
    en,
    { blk: "a\nb\n" },
    "de:\r\n  blk: |\r\n    eins\r\n",
    L,
  );
  expect(out.replace(/\r\n/g, "")).not.toContain("\n");
  // 7: `yes` written plain would be true to Rails: it is quoted.
  out = entriesToYaml(en, { after: "yes" }, "de:\n  after: nach\n", L);
  expect(out).toBe('de:\n  after: "yes"\n');
  // 8: missing keys each go after their own source neighbour.
  out = entriesToYaml(
    en,
    { "list.a": "A", "list.c": "C" },
    'de:\n  list:\n    b: "B"\n    d: "D"\n',
    L,
  );
  expect(out).toBe(
    'de:\n  list:\n    a: "A"\n    b: "B"\n    c: "C"\n    d: "D"\n',
  );
  // 9: a `{}` stub and a null parent take their keys as a block.
  expect(entriesToYaml(en, { "g.h": "H" }, "de: {}\n", L)).toBe(
    "de:\n  g:\n    h: H\n",
  );
  expect(entriesToYaml(en, { "g.h": "H" }, "de:\n  g:\n", L)).toBe(
    "de:\n  g:\n    h: H\n",
  );
});

test("a key under a flow hash that holds keys is refused, the file left as it is (#753)", () => {
  const en = 'en:\n  g:\n    h: "H"\n    x: "X"\n';
  const flow = 'de:\n  g: {x: "X"}\n';
  const refused: string[] = [];
  expect(
    entriesToYaml(
      en,
      { "g.h": "H" },
      flow,
      { source: "en", code: "de" },
      (id) => refused.push(id),
    ),
  ).toBe(flow);
  expect(refused).toEqual(["g.h"]);
});

test("a root written as a flow hash is edited in place as any flow hash is, and takes no new key (#753, #865)", () => {
  const en = 'en:\n  a: "A"\n  b: "B"\n  c: "C"\n';
  const flow = "fr: {a: A, b: B}\n";
  const refused: string[] = [];
  const L = { source: "en", code: "fr" };
  expect(
    entriesToYaml(en, { c: "C", a: "AA" }, flow, L, (id) => refused.push(id)),
  ).toBe("fr: {a: AA, b: B}\n");
  expect(refused).toEqual(["c"]);
});

test("a removal under a root written inline is refused by name, never a lost root (#865)", () => {
  const src = "# head\nen: {a: A, b: B}\nzz: 1\n";
  expect(() => applyYamlOps(src, [{ kind: "delete", id: "a" }], "en")).toThrow(
    "a: its parent in the file is a hash written inline",
  );
  expect(() =>
    applyYamlOps(
      src,
      [
        { kind: "edit", id: "b", text: "BB" },
        { kind: "delete", id: "a" },
      ],
      "en",
    ),
  ).toThrow("a: its parent in the file is a hash written inline");
  // A key it no longer holds is nothing to remove; an edit goes in place.
  expect(applyYamlOps(src, [{ kind: "delete", id: "c" }], "en")).toBe(src);
  expect(applyYamlOps(src, [{ kind: "edit", id: "b", text: "BB" }], "en")).toBe(
    src.replace("b: B", "b: BB"),
  );
});

test("a key the file lacks is written as the source writes it under its last root key, as Rails reads it (#865)", () => {
  const en = "en:\n  a: A\nen:\n  01: One\n";
  expect(
    entriesToYaml(en, { "01": "Un" }, "fr:\n", { source: "en", code: "fr" }),
  ).toBe("fr:\n  01: Un\n");
});

test("a proposal edits a key in its own style, adds one after its parent's last, removes one with its comment (#757)", () => {
  const src = `en:
  js:
    # The deny button
    deny: Cancel
    title: 'Authorize "%{app}"'
    topic_count:
      one: "%{count} topic"
      other: "%{count} topics"
  time:
    am: "am"
`;
  expect(
    applyYamlOps(src, [{ kind: "edit", id: "js.deny", text: "Refuse" }], "en"),
  ).toBe(src.replace("deny: Cancel", "deny: Refuse"));
  expect(
    applyYamlOps(
      src,
      [
        { kind: "add", id: "js.accept", text: "Accept" },
        { kind: "add", id: "wizard.intro", text: "Hello" },
        {
          kind: "add",
          id: "js.post_count",
          text: "{count, plural, one {%{count} post} other {%{count} posts}}",
        },
      ],
      "en",
    ),
  ).toBe(
    src
      .replace(
        '      other: "%{count} topics"\n',
        '      other: "%{count} topics"\n    accept: Accept\n    post_count:\n      one: "%{count} post"\n      other: "%{count} posts"\n',
      )
      .concat("  wizard:\n    intro: Hello\n"),
  );
  expect(applyYamlOps(src, [{ kind: "delete", id: "js.deny" }], "en")).toBe(
    src.replace("    # The deny button\n    deny: Cancel\n", ""),
  );
  expect(
    applyYamlOps(src, [{ kind: "delete", id: "js.topic_count" }], "en"),
  ).toBe(
    src.replace(
      '    topic_count:\n      one: "%{count} topic"\n      other: "%{count} topics"\n',
      "",
    ),
  );
  // An edit of a key the file lacks, or a removal of one, does nothing.
  expect(
    applyYamlOps(
      src,
      [
        { kind: "edit", id: "js.gone", text: "x" },
        { kind: "delete", id: "js.gone" },
      ],
      "en",
    ),
  ).toBe(src);
});

test("proposal edges: an added _MF plural stays a scalar, a removal keeps the block before it, refusals say why (#757)", () => {
  const added = applyYamlOps(
    "en:\n  js:\n    a: A\n",
    [
      {
        kind: "add",
        id: "js.count_MF",
        text: "{count, plural, one {# post} other {# posts}}",
      },
    ],
    "en",
  );
  expect(added).toBe(
    'en:\n  js:\n    a: A\n    count_MF: "{count, plural, one {# post} other {# posts}}"\n',
  );
  // A `# Heading` inside the block before is its text, not a comment.
  const block = "en:\n  a: |\n    Intro\n    # Heading\n  b: B\n";
  expect(applyYamlOps(block, [{ kind: "delete", id: "b" }], "en")).toBe(
    "en:\n  a: |\n    Intro\n    # Heading\n",
  );
  expect(() =>
    applyYamlOps(
      "en:\n  js:\n    deny: Cancel\n",
      [{ kind: "add", id: "js.deny.x", text: "X" }],
      "en",
    ),
  ).toThrow("js.deny.x: its parent in the file is a scalar");
  expect(() =>
    applyYamlOps(
      "en:\n  js:\n    n:\n      one: a\n      other: b\n",
      [
        {
          kind: "edit",
          id: "js.n",
          text: "{count, plural, =0 {none} other {b}}",
        },
      ],
      "en",
    ),
  ).toThrow("js.n: a plural a Rails hash cannot hold");
  expect(() =>
    applyYamlOps(
      "en:\n  js: {a: A, b: B}\n",
      [{ kind: "delete", id: "js.a" }],
      "en",
    ),
  ).toThrow("js.a: its parent in the file is a hash written inline");
});

test("a null parent keeps its comment, a new block takes the file's indentation, and a plural form the text lacks goes (#759)", () => {
  const lang = { source: "en", code: "de" };
  const en = `en:\n    g:\n        a: "A"\n        b: "B"\n    files:\n        one: "%{count} file"\n        few: "%{count} files"\n        other: "%{count} files"\n`;
  // A null parent with a comment, in a file indented by four.
  const de = `de:\n    g: # later\n    files:\n        one: "%{count} Datei"\n        # rare\n        few: "%{count} Dateien"\n        other: "%{count} Dateien"\n`;
  const out = entriesToYaml(
    en,
    {
      "g.a": "Ah",
      files: "{count, plural, one {%{count} Datei} other {%{count} Dateien}}",
    },
    de,
    lang,
  );
  expect(out).toBe(
    `de:\n    g: # later\n        a: Ah\n    files:\n        one: "%{count} Datei"\n        other: "%{count} Dateien"\n`,
  );
});

test("a form added before one the text drops goes in its place, the dropped form and its comment gone (#759)", () => {
  const en = `en:\n  files:\n    one: "a"\n    few: "b"\n    other: "c"\n`;
  const de = `de:\n  files:\n    one: "a"\n    # rare\n    few: "b"\n    other: "c"\n`;
  const out = entriesToYaml(
    en,
    { files: "{count, plural, one {a} two {t} other {c}}" },
    de,
    { source: "en", code: "de" },
  );
  expect(out).toBe(
    `de:\n  files:\n    one: "a"\n    two: "t"\n    other: "c"\n`,
  );
  expect(out.replace(/\n/g, "\r\n")).toBe(
    entriesToYaml(
      en,
      { files: "{count, plural, one {a} two {t} other {c}}" },
      de.replace(/\n/g, "\r\n"),
      { source: "en", code: "de" },
    ),
  );
});

test("a map's missing last child goes in before a missing key after the map, so the file parses (#802)", () => {
  const en = `en:\n  m: "M"\n  t:\n    x: "X"\n    y: "Y"\n  s: "S"\n`;
  const out = entriesToYaml(
    en,
    { m: "1", "t.x": "2", "t.y": "3", s: "4" },
    `fr:\n  t:\n    x: "2"\n`,
    { source: "en", code: "fr" },
  );
  expect(out).toBe(`fr:\n  m: "1"\n  t:\n    x: "2"\n    y: "3"\n  s: "4"\n`);
});

test("a map ending in a commented empty parent ends on that line, so a missing key after it goes before the next key (#804)", () => {
  const en = `en:\n  a:\n    e: "E"\n    u:\n      l: "L"\n  d: "D"\n  r:\n    x: "X"\n`;
  const out = entriesToYaml(
    en,
    { "a.e": "2", "a.u.l": "4", d: "5", "r.x": "6" },
    `fr:\n  a:\n    e: "2"\n    u: # keep\n  r:\n    x: "6"\n`,
    { source: "en", code: "fr" },
  );
  expect(out).toBe(
    `fr:\n  a:\n    e: "2"\n    u: # keep\n      l: "4"\n  d: "5"\n  r:\n    x: "6"\n`,
  );
});

test("an added plural form after a commented empty one goes inside its hash, and a removal after such a map takes its comment (#804)", () => {
  const out = entriesToYaml(
    `en:\n  p:\n    one: "one"\n    other: "other"\n  j: "J"\n`,
    { p: "{count, plural, one {1} other {n}}", j: "6" },
    `fr:\n  p:\n    one: # keep\n  j: "x"\n`,
    { source: "en", code: "fr" },
  );
  expect(yamlTranslations(out, "fr").map((e) => [e.id, e.source])).toEqual([
    ["p", "{count, plural, one {1} other {n}}"],
    ["j", "6"],
  ]);
  const removed = applyYamlOps(
    `en:\n  a:\n    u: # keep\n  # about b\n  b: "B"\n`,
    [{ kind: "delete", id: "b" }],
    "en",
  );
  expect(removed).toBe(`en:\n  a:\n    u: # keep\n`);
});

test("removing a map leaves the comment of the key after it (#804)", () => {
  expect(
    applyYamlOps(
      `en:\n  a:\n    x: "X"\n  # about b\n  b: "B"\n`,
      [{ kind: "delete", id: "a.x" }],
      "en",
    ),
  ).toBe(`en:\n  a:\n  # about b\n  b: "B"\n`);
});

test("an edit inside a flow map is written in place, quoted where flow syntax needs it; a plural there is refused by name (#806)", () => {
  const lang = { source: "en", code: "de" };
  const en = `en:\n  g: {a: "A", b: B}\n  p:\n    one: "one"\n    other: "other"\n`;
  const de = `de:\n  g: {a: "A", b: B}\n  p: {one: "eins", other: "viele"}\n`;
  expect(entriesToYaml(en, { "g.a": "Ah", "g.b": "B" }, de, lang)).toBe(
    `de:\n  g: {a: "Ah", b: B}\n  p: {one: "eins", other: "viele"}\n`,
  );
  // A plain scalar keeps its style where flow reads it back; a comma or
  // a bracket takes double quotes.
  expect(entriesToYaml(en, { "g.b": "Be" }, de, lang)).toContain(
    'g: {a: "A", b: Be}',
  );
  const quoted = entriesToYaml(en, { "g.b": "x, [y]" }, de, lang);
  expect(quoted).toContain('g: {a: "A", b: "x, [y]"}');
  expect(
    yamlTranslations(quoted, "de").find((e) => e.id === "g.b")?.source,
  ).toBe("x, [y]");
  // A plural held as a flow hash is rewritten as its block, as before;
  // one inside a flow hash, and a null there, are refused by name.
  const block = entriesToYaml(
    en,
    { p: "{count, plural, one {ein} other {mehr}}" },
    de,
    lang,
  );
  expect(yamlTranslations(block, "de").find((e) => e.id === "p")?.source).toBe(
    "{count, plural, one {ein} other {mehr}}",
  );
  const refused: [string, string][] = [];
  const onRefused = (id: string, _text: string, why: string) =>
    refused.push([id, why]);
  const nested = `de:\n  g: {a: "A", p: {one: "eins", other: "viele"}}\n`;
  const enNested = `en:\n  g:\n    a: "A"\n    p:\n      one: "one"\n      other: "other"\n`;
  expect(
    entriesToYaml(
      enNested,
      { "g.p": "{count, plural, one {ein} other {mehr}}" },
      nested,
      lang,
      onRefused,
    ),
  ).toBe(nested);
  for (const target of [`de:\n  g: {a:}\n`, `de:\n  g: {b: B, a:}\n`])
    expect(entriesToYaml(en, { "g.a": "Ah" }, target, lang, onRefused)).toBe(
      target,
    );
  expect(refused).toEqual([
    ["g.p", "parent"],
    ["g.a", "parent"],
    ["g.a", "parent"],
  ]);
});

test("keys going in at the end of a file with no final line break start one line each, no blank line between (#837)", () => {
  const en = `en:\n  k1:\n    k2:\n      k3:\n        k4: "S"\n    k5:\n      k6: "S"\n    k7:\n      k14: "S"\n  k15: "S"\n`;
  const fr = `fr:\n  k1:\n    k2:\n    k5:\n      k6: "T"`;
  const lang = { source: "en", code: "fr" };
  const tr = { "k1.k2.k3.k4": "A", "k1.k7.k14": "B", k15: "C" };
  for (const eol of ["\n", "\r\n"]) {
    const out = entriesToYaml(en, tr, fr.replace(/\n/g, eol), lang);
    expect(out).toBe(
      `fr:\n  k1:\n    k2:\n      k3:\n        k4: "A"\n    k5:\n      k6: "T"\n    k7:\n      k14: "B"\n  k15: "C"\n`.replace(
        /\n/g,
        eol,
      ),
    );
  }
  const plural = `fr:\n  n:\n    one: "un"`;
  expect(
    entriesToYaml(
      `en:\n  n:\n    one: "one"\n    other: "many"\n  m: "M"\n`,
      { n: "{count, plural, one {un} other {des}}", m: "MM" },
      plural,
      lang,
    ),
  ).toBe(`fr:\n  n:\n    one: "un"\n    other: "des"\n  m: MM\n`);
  // A form dropped at the file's end leaves the line before it last.
  const dropped = `fr:\n  n:\n    one: "un"\n    other: "des"\n    zero: "z"`;
  for (const tail of ["", "\n"])
    expect(
      entriesToYaml(
        `en:\n  n:\n    one: "one"\n    other: "many"\n  m: "M"\n`,
        { n: "{count, plural, one {un} other {des}}", m: "MM" },
        dropped + tail,
        lang,
      ),
    ).toBe(`fr:\n  n:\n    one: "un"\n    other: "des"\n  m: MM\n`);
});

test("a text Rails' parser could not read back is written double-quoted, whatever the scalar's style (#851)", () => {
  const lang = { source: "en", code: "fr" };
  const en =
    "en:\n  a: A\n  b: 'B'\n  c: |\n    C\n  d: >\n    D\n  e: {x: X}\n";
  const fr =
    "fr:\n  a: y\n  b: 'y'\n  c: |\n    y\n  d: >\n    y\n  e: {x: y}\n";
  const [nel, ls, ps, nonchar] = [0x85, 0x2028, 0x2029, 0xfffe].map((c) =>
    String.fromCodePoint(c),
  );
  // Nothing libyaml refuses is written raw: C0 and C1 controls, DEL,
  // NEL, the Unicode line and paragraph separators, U+FFFE and U+FFFF.
  const refused = new RegExp(
    `[\x00-\x08\x0b-\x1f\x7f-\x9f${ls}${ps}${nonchar}]`,
  );
  const texts = [
    "k\x07",
    `p${ls}q`,
    `p${ps}q`,
    `p${nel}q`,
    "k\x7f",
    "\tlead",
    "k\x80",
    `k${nonchar}`,
    "x\n\tnext",
  ];
  for (const text of texts) {
    const tr = { a: text, b: text, c: text, d: text, "e.x": text };
    const out = entriesToYaml(en, tr, fr, lang);
    const back = Object.fromEntries(
      yamlTranslations(out, "fr").map((e) => [e.id, e.source]),
    );
    expect(back).toEqual(tr);
    expect(out).not.toMatch(refused);
    expect(out).not.toMatch(/\n +\t/);
  }
});

test("in a target, a hash of categories at an id the source reads as a plural is that plural, other or not, and writes back as it is (#950)", () => {
  const source =
    'en:\n  rooms:\n    one: "%{count} room"\n    other: "%{count} rooms"\n';
  const target =
    'pl:\n  rooms:\n    one: "%{count} pokój"\n    few: "%{count} pokoje"\n    many: "%{count} pokoi"\n';
  const read = yamlTranslations(target, "pl", new Set(["rooms"]));
  expect(read).toEqual([
    {
      id: "rooms",
      type: "",
      source:
        "{count, plural, one {%{count} pokój} few {%{count} pokoje} many {%{count} pokoi}}",
    },
  ]);
  expect(yamlTranslations(target, "pl").map((e) => e.id)).toEqual([
    "rooms.one",
    "rooms.few",
    "rooms.many",
  ]);
  const lang = { source: "en", code: "pl" };
  expect(entriesToYaml(source, { rooms: read[0]!.source }, target, lang)).toBe(
    target,
  );
  expect(
    entriesToYaml(
      source,
      {
        rooms:
          "{count, plural, one {%{count} pokój} few {%{count} pokoje} many {%{count} pokoi} other {%{count} pokoju}}",
      },
      target,
      lang,
    ),
  ).toBe(`${target}    other: "%{count} pokoju"\n`);
});

test("a target's hash of categories where the source has a section reads as its keys (#984)", () => {
  const target = "ar:\n  edit_profile:\n    other: أخرى\n";
  expect(yamlTranslations(target, "ar", new Set())).toEqual([
    { id: "edit_profile.other", type: "", source: "أخرى" },
  ]);
  const source =
    "en:\n  edit_profile:\n    other: Other\n    redesign_body: Body\n";
  expect(
    entriesToYaml(source, { "edit_profile.other": "أخرى!" }, target, {
      source: "en",
      code: "ar",
    }),
  ).toBe("ar:\n  edit_profile:\n    other: أخرى!\n");
});

test("a key the file lacks is written plain where it reads back, quoted where it must be; a plural's forms in the order the file's hashes use (#1021)", () => {
  const en = `en:
  title: Discoverable
  answer: Answer
  colon: Note
  star: Star
  hash: Hash
  followers:
    one: follower
    other: followers
  posts:
    one: post
    other: posts
  likes:
    one: like
    other: likes
`;
  const pl = `pl:
  followers:
    few: śledzących
    many: śledzących
    one: śledzący
    other: obserwujących
  likes:
    few: polubienia
    one: polubienie
    other: polubień
`;
  const back = entriesToYaml(
    en,
    {
      title: "Odkrywalne",
      answer: "yes",
      colon: ": x",
      star: "*gwiazda",
      hash: "# nie",
      posts:
        "{count, plural, one {post} few {posty} many {postów} other {postu}}",
      likes:
        "{count, plural, one {polubienie} few {polubienia} many {polubień} other {polubień}}",
    },
    pl,
    { source: "en", code: "pl" },
  );
  expect(back).toContain("  title: Odkrywalne\n");
  for (const quoted of [
    'answer: "yes"',
    'colon: ": x"',
    'star: "*gwiazda"',
    'hash: "# nie"',
  ])
    expect(back).toContain(quoted);
  // The file's hashes are alphabetical, so a new one is too.
  expect(back).toContain(
    "  posts:\n    few: posty\n    many: postów\n    one: post\n    other: postu\n",
  );
  // A form a held hash lacks goes in where the file's order puts it.
  expect(back).toContain(
    "  likes:\n    few: polubienia\n    many: polubień\n    one: polubienie\n    other: polubień\n",
  );
  // In a file whose hashes follow CLDR, a new one does too.
  const cldr = entriesToYaml(
    en,
    {
      posts:
        "{count, plural, one {post} few {posty} many {postów} other {postu}}",
    },
    "pl:\n  followers:\n    one: a\n    few: b\n    many: c\n    other: d\n",
    { source: "en", code: "pl" },
  );
  expect(cldr).toContain(
    "  posts:\n    one: post\n    few: posty\n    many: postów\n    other: postu\n",
  );
});

test("a text Rails' Psych would read as no string is quoted, new or changed; a file that quotes most of its scalars has new ones quoted (#1021)", () => {
  const en = "en:\n  t: Tea\n  u: You\n";
  for (const text of [
    ":D",
    ":-)",
    ":) :p :( gibi",
    "0,5",
    "1,000.5",
    "yEs",
    "oFf",
    "nUll",
    ".iNf",
    "-.inf",
    "1:30",
    "2024-01-02",
    "12",
    "0x1F",
  ]) {
    const added = entriesToYaml(en, { t: text }, "de:\n  u: Du\n", {
      source: "en",
      code: "de",
    });
    expect(added).toContain(`t: ${JSON.stringify(text)}`);
    // A plain scalar changed to it is quoted too.
    const changed = entriesToYaml(en, { t: text }, "de:\n  t: stare\n", {
      source: "en",
      code: "de",
    });
    expect(changed).toBe(`de:\n  t: ${JSON.stringify(text)}\n`);
  }
  // A sentence beginning with a word stays plain.
  expect(
    entriesToYaml(en, { t: "Yes, please" }, "de:\n  u: Du\n", {
      source: "en",
      code: "de",
    }),
  ).toContain("t: Yes, please\n");
  // A file of quoted scalars, as Crowdin exports, takes new ones quoted.
  expect(
    entriesToYaml(en, { t: "Tee" }, 'de:\n  u: "Du"\n  v: "Ihr"\n', {
      source: "en",
      code: "de",
    }),
  ).toContain('t: "Tee"');
  // A form beside a block sibling is one line, not a block.
  const block = entriesToYaml(
    "en:\n  n:\n    one: one\n    other: many\n",
    { n: "{count, plural, one {a} few {b} other {c}}" },
    "pl:\n  n:\n    one: |-\n      a\n    other: |-\n      c\n",
    { source: "en", code: "pl" },
  );
  expect(block).not.toMatch(/\n\n/);
  expect(block).toContain("    few: b\n");
});

test("a block plural form changed to a text no block holds keeps the next form on its own line (#1126)", () => {
  const en = "en:\n  f:\n    one: one\n    other: many\n";
  const pl = "pl:\n  f:\n    one: |-\n      a\n    other: y\n";
  for (const text of [" x", "\tx", "a\rb"]) {
    const out = entriesToYaml(
      en,
      { f: `{count, plural, one {${text}} other {y}}` },
      pl,
      { source: "en", code: "pl" },
    );
    expect(out).toMatch(/^pl:\n  f:\n    one: "[^\n]*"\n    other: y\n$/);
    expect(yamlTranslations(out, "pl")).toEqual([
      expect.objectContaining({
        id: "f",
        source: `{count, plural, one {${text}} other {y}}`,
      }),
    ]);
  }
});
