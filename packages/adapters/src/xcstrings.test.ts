import { expect, test } from "vitest";
import {
  xcstringsLanguages,
  xcstringsToEntries,
  xcstringsTranslations,
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
