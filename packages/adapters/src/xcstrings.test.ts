import { expect, test } from "vitest";
import {
  entriesToXcstrings,
  serializeXcstrings,
  xcstringsLanguages,
  xcstringsToEntries,
  xcstringsTranslations,
  xcstringsWritable,
} from "./xcstrings";

const u = (value: string, state = "translated") => ({
  stringUnit: { state, value },
});

// Ice Cubes' shapes, cut down.
const CATALOG = JSON.stringify({
  sourceLanguage: "en",
  strings: {
    "": {},
    Bookmarks: {
      localizations: { de: u("Lesezeichen"), fr: u("Signets", "needs_review") },
    },
    "timeline.new-posts %lld": {
      comment: "The banner over new posts",
      localizations: {
        en: {
          variations: {
            plural: { one: u("%lld new post"), other: u("%lld new posts") },
          },
        },
        de: {
          variations: {
            plural: {
              one: u("%lld neuer Beitrag"),
              other: u("%lld neue Beiträge", "needs_review"),
            },
          },
        },
      },
    },
    "timeline.n-recent-from-n-participants %lld %lld": {
      localizations: {
        en: {
          ...u("%#@arg1@ from %#@arg2@"),
          substitutions: {
            arg1: {
              argNum: 1,
              formatSpecifier: "lld",
              variations: {
                plural: {
                  one: u("%arg recent post"),
                  other: u("%arg recent posts"),
                },
              },
            },
            arg2: {
              argNum: 2,
              formatSpecifier: "lld",
              variations: {
                plural: {
                  one: u("%arg participant"),
                  other: u("%arg participants"),
                },
              },
            },
          },
        },
        // Polish names them its own way and gives no argNum.
        pl: {
          ...u("%#@count_posts@ %#@count_participants@"),
          substitutions: {
            count_participants: {
              formatSpecifier: "lld",
              variations: {
                plural: {
                  one: u("od %arg uczestnika"),
                  other: u("od %arg uczestników"),
                },
              },
            },
            count_posts: {
              formatSpecifier: "lld",
              variations: {
                plural: { one: u("%arg post"), other: u("%arg postów") },
              },
            },
          },
        },
      },
    },
    "settings.platform": {
      localizations: {
        en: {
          variations: {
            device: { ipad: u("iPad"), iphone: u("iPhone") },
          },
        },
        de: { variations: { device: { iphone: u("iPhone") } } },
      },
    },
    "old.key": { extractionState: "stale", localizations: { en: u("Old") } },
    "app.name": { shouldTranslate: false, localizations: { en: u("Ice") } },
  },
  version: "1.0",
});

test("a catalogue's source strings: units, plurals, substitutions by argument, device variants, key-is-text (#727)", () => {
  expect(xcstringsToEntries(CATALOG, { type: "ui" })).toEqual([
    { id: "Bookmarks", type: "ui", source: "Bookmarks", keyIsText: true },
    {
      id: "timeline.new-posts %lld",
      type: "ui",
      source: "{count, plural, one {%lld new post} other {%lld new posts}}",
      note: "The banner over new posts",
    },
    {
      id: "timeline.n-recent-from-n-participants %lld %lld",
      type: "ui",
      source:
        "{arg1, plural, one {%arg recent post} other {%arg recent posts}} from {arg2, plural, one {%arg participant} other {%arg participants}}",
    },
    { id: "settings.platform [device:ipad]", type: "ui", source: "iPad" },
    { id: "settings.platform [device:iphone]", type: "ui", source: "iPhone" },
  ]);
});

test("a language's translations are its units translated throughout; names become arguments by position (#727)", () => {
  expect(xcstringsTranslations(CATALOG, "de")).toEqual([
    { id: "Bookmarks", type: "", source: "Lesezeichen" },
    { id: "settings.platform [device:iphone]", type: "", source: "iPhone" },
  ]);
  expect(xcstringsTranslations(CATALOG, "fr")).toEqual([]);
  expect(xcstringsTranslations(CATALOG, "pl")).toEqual([
    {
      id: "timeline.n-recent-from-n-participants %lld %lld",
      type: "",
      source:
        "{arg1, plural, one {%arg post} other {%arg postów}} {arg2, plural, one {od %arg uczestnika} other {od %arg uczestników}}",
    },
  ]);
  expect(xcstringsLanguages(CATALOG)).toEqual(["en", "de", "fr", "pl"]);
});

test("a file that is not a String Catalog is refused by name (#727)", () => {
  expect(() => xcstringsToEntries("{}", { type: "ui" })).toThrow(
    "not a String Catalog",
  );
});

test("a language that varies by device where the source does not, or not where it does, lands on the source's strings (#727)", () => {
  const catalog = JSON.stringify({
    sourceLanguage: "en",
    strings: {
      platform: {
        localizations: {
          en: {
            variations: { device: { ipad: u("iPad"), iphone: u("iPhone") } },
          },
          de: u("Gerät"),
        },
      },
      done: {
        localizations: {
          en: u("Done"),
          de: {
            variations: {
              device: { mac: u("Fertig."), other: u("Fertig") },
            },
          },
          fr: { variations: { device: { mac: u("Terminé") } } },
        },
      },
      empty: { localizations: { en: u(""), de: u("Leer") } },
      bare: { localizations: { en: {}, de: u("Nackt") } },
    },
  });
  expect(xcstringsTranslations(catalog, "de")).toEqual([
    { id: "platform [device:ipad]", type: "", source: "Gerät" },
    { id: "platform [device:iphone]", type: "", source: "Gerät" },
    { id: "done", type: "", source: "Fertig" },
    { id: "empty", type: "", source: "Leer" },
    { id: "bare", type: "", source: "Nackt" },
  ]);
  expect(xcstringsTranslations(catalog, "fr")).toEqual([]);
  // An empty source unit, or an empty value, is its key's text.
  expect(
    xcstringsToEntries(catalog, { type: "ui" })
      .filter((e) => e.keyIsText)
      .map((e) => e.id),
  ).toEqual(["empty", "bare"]);
});

test("the catalogue's sourceLanguage must be the config's; strings must be an object (#727)", () => {
  expect(() =>
    xcstringsToEntries(CATALOG, { type: "ui", sourceLanguage: "de" }),
  ).toThrow("the catalogue's sourceLanguage is en, the config's de");
  expect(() =>
    xcstringsToEntries('{"sourceLanguage":"en","strings":[]}', { type: "ui" }),
  ).toThrow("not a String Catalog");
});

// A catalogue as Xcode saves it.
const xcode = (catalog: unknown) => `${serializeXcstrings(catalog)}\n`;

test("a catalogue's own translations write the same bytes; Xcode's layout is its serializer's (#728)", () => {
  const file = xcode(JSON.parse(CATALOG));
  for (const language of ["de", "fr", "pl"]) {
    const own = Object.fromEntries(
      xcstringsTranslations(file, language).map((e) => [e.id, e.source]),
    );
    expect(entriesToXcstrings(file, own, language)).toBe(file);
  }
  expect(file).toContain(
    '"sourceLanguage" : "en",\n  "strings" : {\n    "" : {\n\n    },',
  );
});

test("a changed text rewrites its unit alone, translated; substitutions keep the language's own names (#728)", () => {
  const file = xcode(JSON.parse(CATALOG));
  const out = entriesToXcstrings(
    file,
    {
      "timeline.n-recent-from-n-participants %lld %lld":
        "{arg1, plural, one {%arg post} few {%arg posty} other {%arg postów}} {arg2, plural, one {od %arg uczestnika} other {od %arg uczestników}}",
    },
    "pl",
  );
  const pl =
    JSON.parse(out).strings["timeline.n-recent-from-n-participants %lld %lld"]
      .localizations.pl;
  expect(pl.stringUnit.value).toBe("%#@count_posts@ %#@count_participants@");
  expect(Object.keys(pl.substitutions)).toEqual([
    "count_participants",
    "count_posts",
  ]);
  expect(Object.keys(pl.substitutions.count_posts.variations.plural)).toEqual([
    "few",
    "one",
    "other",
  ]);
  expect(pl.substitutions.count_posts).not.toHaveProperty("argNum");
  // Only that unit moved: put back, the bytes are the file's.
  const back = JSON.parse(out);
  back.strings[
    "timeline.n-recent-from-n-participants %lld %lld"
  ].localizations.pl =
    JSON.parse(file).strings[
      "timeline.n-recent-from-n-participants %lld %lld"
    ].localizations.pl;
  expect(xcode(back)).toBe(file);
  // A needs_review unit given a text becomes translated; a new language
  // lands in order; a key the file lacks is not added.
  const fr = JSON.parse(
    entriesToXcstrings(
      file,
      {
        Bookmarks: "Signets",
        "timeline.new-posts %lld":
          "{count, plural, one {%lld nouveau} other {%lld nouveaux}}",
        "not.in.file": "x",
      },
      "fr",
    ),
  );
  expect(fr.strings.Bookmarks.localizations.fr).toEqual({
    stringUnit: { state: "translated", value: "Signets" },
  });
  expect(
    Object.keys(fr.strings["timeline.new-posts %lld"].localizations),
  ).toEqual(["en", "de", "fr"]);
  // Sorted localizations take a new one in order; unsorted ones, as
  // above, at the end.
  const es = JSON.parse(
    entriesToXcstrings(file, { Bookmarks: "Marcadores" }, "es"),
  );
  expect(Object.keys(es.strings.Bookmarks.localizations)).toEqual([
    "de",
    "es",
    "fr",
  ]);
  expect(fr.strings).not.toHaveProperty("not.in.file");
});

test("a language keeps its own device shape when written (#728)", () => {
  const file = xcode({
    sourceLanguage: "en",
    strings: {
      platform: {
        localizations: {
          en: {
            variations: { device: { ipad: u("iPad"), iphone: u("iPhone") } },
          },
          de: u("Gerät"),
        },
      },
      done: {
        localizations: {
          en: u("Done"),
          de: {
            variations: { device: { mac: u("Fertig."), other: u("Fertig") } },
          },
        },
      },
    },
  });
  // Every variant the same: German stays plain.
  let de = JSON.parse(
    entriesToXcstrings(
      file,
      {
        "platform [device:ipad]": "Geräte",
        "platform [device:iphone]": "Geräte",
      },
      "de",
    ),
  ).strings;
  expect(de.platform.localizations.de).toEqual(u("Geräte"));
  // One variant apart: German varies, the other keeping its text.
  de = JSON.parse(
    entriesToXcstrings(file, { "platform [device:ipad]": "Tablet" }, "de"),
  ).strings;
  expect(de.platform.localizations.de).toEqual({
    variations: { device: { ipad: u("Tablet"), iphone: u("Gerät") } },
  });
  // A plain source's text goes to German's `other`, `mac` kept.
  de = JSON.parse(entriesToXcstrings(file, { done: "Erledigt" }, "de")).strings;
  expect(de.done.localizations.de).toEqual({
    variations: { device: { mac: u("Fertig."), other: u("Erledigt") } },
  });
});

test("a catalogue not in Xcode's layout is refused rather than moved; one with nothing to write is left alone (#728)", () => {
  const minified = JSON.stringify(JSON.parse(CATALOG));
  expect(() =>
    entriesToXcstrings(minified, { Bookmarks: "Merkliste" }, "de"),
  ).toThrow("not in Xcode's layout");
  expect(entriesToXcstrings(minified, {}, "de")).toBe(minified);
});

test("a plural moved off its argument's position is written with argNum, so it reads back as written (#728)", () => {
  const file = xcode(JSON.parse(CATALOG));
  const key = "timeline.n-recent-from-n-participants %lld %lld";
  // Polish wrote no argNum; Basque's order swaps the two.
  const swapped =
    "{arg2, plural, one {od %arg uczestnika} other {od %arg uczestników}} {arg1, plural, one {%arg post} other {%arg postów}}";
  const out = entriesToXcstrings(file, { [key]: swapped }, "pl");
  const pl = JSON.parse(out).strings[key].localizations.pl;
  expect(pl.stringUnit.value).toBe("%#@count_participants@ %#@count_posts@");
  expect(pl.substitutions.count_participants.argNum).toBe(2);
  expect(pl.substitutions.count_posts.argNum).toBe(1);
  const back = (text: string, language: string) =>
    xcstringsTranslations(text, language).find((e) => e.id === key)?.source;
  expect(back(out, "pl")).toBe(swapped);
  // A language new to a key, pluralising the second of two verbs.
  const plain = xcode({
    sourceLanguage: "en",
    strings: {
      "%lld from %lld": { localizations: { en: u("%lld from %lld") } },
    },
  });
  const de = "{arg2, plural, one {%arg Person} other {%arg Leute}} von %lld";
  const written = entriesToXcstrings(plain, { "%lld from %lld": de }, "de");
  expect(
    JSON.parse(written).strings["%lld from %lld"].localizations.de.substitutions
      .arg2.argNum,
  ).toBe(2);
  expect(xcstringsTranslations(written, "de")[0]?.source).toBe(de);
});

test("a plural a String Catalog cannot hold is refused by name, and an empty text is not written (#728)", () => {
  const file = xcode(JSON.parse(CATALOG));
  const refused: string[] = [];
  const out = entriesToXcstrings(
    file,
    {
      "timeline.new-posts %lld":
        "{count, plural, =0 {keine} one {%lld Beitrag} other {%lld Beiträge}}",
      Bookmarks: "",
    },
    "de",
    (id) => refused.push(id),
  );
  expect(out).toBe(file);
  expect(refused).toEqual(["timeline.new-posts %lld"]);
  expect(
    entriesToXcstrings(
      file,
      { "timeline.new-posts %lld": "{count, plural, one {%lld {x} Beitrag}" },
      "de",
      (id) => refused.push(id),
    ),
  ).toBe(file);
  expect(refused).toHaveLength(2);
});

test("a plural on count with text beside it, or one argument pluralised twice, is refused (#728)", () => {
  expect(
    xcstringsWritable("Total: {count, plural, one {%lld P} other {%lld Ps}}"),
  ).toBe(false);
  expect(
    xcstringsWritable(
      "{arg1, plural, one {a} other {b}} {arg1, plural, one {c} other {d}}",
    ),
  ).toBe(false);
  expect(
    xcstringsWritable("{count, plural, one {%lld P} other {%lld Ps}}"),
  ).toBe(true);
  expect(xcstringsWritable("Use {name} here")).toBe(true);
});
