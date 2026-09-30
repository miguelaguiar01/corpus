import { expect, test } from "vitest";
import { stringEntrySchema } from "@corpus/contract";
import {
  keyIsSentence,
  messagesToEntries,
  pluralBranches,
  pluralText,
} from "./messages";

test("flat catalog maps key -> id with the configured type", () => {
  const entries = messagesToEntries(
    { "app.title": "Corpus", "home.heading": "Corpus" },
    { type: "chrome" },
  );
  expect(entries).toEqual([
    { id: "app.title", type: "chrome", source: "Corpus" },
    { id: "home.heading", type: "chrome", source: "Corpus" },
  ]);
});

test("nested objects flatten to dot-path ids", () => {
  const entries = messagesToEntries(
    { invite: { heading: "Join", nameLabel: "Name" }, app: { title: "C" } },
    { type: "chrome" },
  );
  expect(entries.map((e) => e.id)).toEqual([
    "invite.heading",
    "invite.nameLabel",
    "app.title",
  ]);
  expect(entries[0]?.source).toBe("Join");
});

test("produces valid contract entries", () => {
  const entries = messagesToEntries({ "a.b": "x" }, { type: "chrome" });
  expect(stringEntrySchema.safeParse(entries[0]).success).toBe(true);
});

test("Corpus's own en catalog converts with id = key", () => {
  const catalog = {
    "app.title": "Corpus",
    "home.signedInAs": "Signed in as {name}",
  };
  const entries = messagesToEntries(catalog, { type: "chrome" });
  expect(entries).toHaveLength(2);
  expect(entries.find((e) => e.id === "home.signedInAs")?.source).toBe(
    "Signed in as {name}",
  );
});

test("a non-string leaf is rejected with its path", () => {
  expect(() => messagesToEntries({ a: { b: 42 } }, { type: "chrome" })).toThrow(
    /a\.b/,
  );
});

test("an array leaf is rejected with its path", () => {
  expect(() => messagesToEntries({ items: ["x"] }, { type: "chrome" })).toThrow(
    /items/,
  );
});

test("null leaves are rejected", () => {
  expect(() => messagesToEntries({ a: null }, { type: "chrome" })).toThrow(/a/);
});

test("empty catalog yields no entries", () => {
  expect(messagesToEntries({}, { type: "chrome" })).toEqual([]);
});

test("keys already containing dots are preserved as-is", () => {
  const entries = messagesToEntries({ "a.b.c": "x" }, { type: "chrome" });
  expect(entries[0]?.id).toBe("a.b.c");
});

test("an empty value under a sentence key reads the key as the text; a dotted key stays empty (#589)", () => {
  const entries = messagesToEntries(
    {
      "{amount} off": "",
      "Sign in": "",
      Email: "",
      free: "",
      "Redeeming...": "",
      "{count} gift_one": "",
      "{count} gift_other": "",
      "ui.empty": "",
      "ui.title": "Title",
    },
    { type: "ui", keyIsText: true },
  );
  expect(entries.map((e) => [e.id, e.source])).toEqual([
    ["{amount} off", "{amount} off"],
    ["Sign in", "Sign in"],
    ["Email", "Email"],
    ["free", "free"],
    ["Redeeming...", "Redeeming..."],
    // A plural key's suffix is i18next's, not the sentence's.
    ["{count} gift_one", "{count} gift"],
    ["{count} gift_other", "{count} gift"],
    ["ui.empty", ""],
    ["ui.title", "Title"],
  ]);
  expect(entries.filter((e) => e.keyIsText).map((e) => e.id)).toEqual([
    "{amount} off",
    "Sign in",
    "Email",
    "free",
    "Redeeming...",
    "{count} gift_one",
    "{count} gift_other",
  ]);
  // A file with no sentence key is a dotted catalogue: an empty value
  // is a row an extraction tool left, and stays empty.
  expect(
    messagesToEntries(
      { free: "", "ui.title": "Title" },
      { type: "ui", keyIsText: true },
    ).map((e) => e.source),
  ).toEqual(["", "Title"]);
  // A target file never takes its keys: "" is an untranslated row.
  expect(
    messagesToEntries({ "Sign in": "" }, { type: "ui" }).map((e) => e.source),
  ).toEqual([""]);
  expect(keyIsSentence("a.b_c-d:e")).toBe(false);
  expect(keyIsSentence("Hello!")).toBe(true);
});

test("an ARB catalogue's @ entries are metadata, not strings (#558)", () => {
  const arb = {
    "@@locale": "en",
    wallpaper: "Wallpaper",
    "@wallpaper": { description: "Menu entry", placeholders: {} },
    setWallpaper: "Set {name}",
    "@setWallpaper": { placeholders: { name: { type: "String" } } },
  };
  // A description beside a string is its note (#567); a placeholders
  // block alone is not.
  expect(messagesToEntries(arb, { type: "ui", arb: true })).toEqual([
    { id: "wallpaper", type: "ui", source: "Wallpaper", note: "Menu entry" },
    { id: "setWallpaper", type: "ui", source: "Set {name}" },
  ]);
  // Without the flag an @ entry is an object like any other, and fails
  // as one, since a nested object under a string key is a catalogue
  // shape the adapter does read.
  expect(() => messagesToEntries(arb, { type: "ui" })).not.toThrow();
  expect(messagesToEntries(arb, { type: "ui" }).map((e) => e.id)).toContain(
    "@wallpaper.description",
  );
  // An array is refused as it is without the flag.
  expect(() => messagesToEntries(["x"], { type: "ui", arb: true })).toThrow(
    /got array/,
  );
});

test("a Chrome i18n catalogue reads message as the text, description as the note, a placeholder's example as its value (#595)", () => {
  const catalogue = {
    copied: {
      message: "Copied $CURRENT$ of $Total$",
      description: "Shown after a copy.",
      placeholders: {
        current: { content: "$1", example: "3" },
        TOTAL: { content: "$2" },
      },
    },
    appName: { message: "Bitwarden" },
    blank: { message: "Save", description: " " },
  };
  expect(messagesToEntries(catalogue, { type: "ui", chrome: true })).toEqual([
    {
      id: "copied",
      type: "ui",
      source: "Copied $CURRENT$ of $Total$",
      note: "Shown after a copy.",
      examples: [{ values: { current: "3" }, rendered: "Copied 3 of $Total$" }],
    },
    { id: "appName", type: "ui", source: "Bitwarden" },
    { id: "blank", type: "ui", source: "Save" },
  ]);
  expect(() =>
    messagesToEntries({ a: { message: 1 } }, { type: "ui", chrome: true }),
  ).toThrow(
    /under library chrome every value must be an object with a string message/,
  );
  expect(messagesToEntries({}, { type: "ui", chrome: true })).toEqual([]);
  // Without the library the same shape is nesting: a toast catalogue of
  // `{ title, message }` keeps its titles (#630 review).
  expect(
    messagesToEntries(
      { saved: { title: "Saved", message: "All good" } },
      { type: "ui" },
    ),
  ).toEqual([
    { id: "saved.title", type: "ui", source: "Saved" },
    { id: "saved.message", type: "ui", source: "All good" },
  ]);
});

test("two key paths that flatten to one id are refused, naming both (#642)", () => {
  expect(() =>
    messagesToEntries(
      { "a.b": { c: "one" }, a: { "b.c": "two" } },
      { type: "ui" },
    ),
  ).toThrow(/a\.b\.c is written twice: \["a\.b","c"\] and \["a","b\.c"\]/);
});

test("an object of plural categories with other is one plural string on count (#662)", () => {
  const data = {
    room: {
      n_rooms: { one: "%(count)s room", other: "%(count)s rooms" },
      title: "Rooms",
    },
    // Not every key a category, or no other: nesting, as before.
    size: { one: "Small", big: "Big" },
    pair: { one: "One", two: "Two" },
  };
  expect(messagesToEntries(data, { type: "ui", plurals: true })).toEqual([
    {
      id: "room.n_rooms",
      type: "ui",
      source: "{count, plural, one {%(count)s room} other {%(count)s rooms}}",
    },
    { id: "room.title", type: "ui", source: "Rooms" },
    { id: "size.one", type: "ui", source: "Small" },
    { id: "size.big", type: "ui", source: "Big" },
    { id: "pair.one", type: "ui", source: "One" },
    { id: "pair.two", type: "ui", source: "Two" },
  ]);
  // Without the option (vue, chrome), the forms stay keys of their own.
  expect(
    messagesToEntries(data, { type: "ui" })
      .map((e) => e.id)
      .slice(0, 2),
  ).toEqual(["room.n_rooms.one", "room.n_rooms.other"]);
});

test("a plural string reads back into its forms; any other text is not one (#662)", () => {
  const forms = { one: "{{count}} room", other: "{{count}} rooms" };
  expect(pluralBranches(pluralText("count", forms, "written"))).toEqual(forms);
  expect(
    pluralBranches("{count, plural, one {a} few {b {x} c} other {d}}"),
  ).toEqual({
    one: "a",
    few: "b {x} c",
    other: "d",
  });
  expect(pluralBranches("{count, plural, one {a}}")).toBeUndefined();
  expect(
    pluralBranches("{count, plural, one {a} other {b}} tail"),
  ).toBeUndefined();
  expect(pluralBranches("{n, plural, one {a} other {b}}")).toBeUndefined();
  expect(pluralBranches("Rooms")).toBeUndefined();
});

test("a Chrome placeholder named like an Object.prototype member is a name like any (#878)", () => {
  const catalogue = JSON.parse(`{
    "greet": {
      "message": "$__PROTO__$ met $CONSTRUCTOR$",
      "placeholders": { "__proto__": { "content": "$1", "example": "Ana" }, "constructor": { "content": "$2" } }
    }
  }`);
  const [entry] = messagesToEntries(catalogue, { type: "ui", chrome: true });
  const example = entry!.examples![0]!;
  expect(Object.hasOwn(example.values, "__proto__")).toBe(true);
  expect(example.values["__proto__"]).toBe("Ana");
  // A placeholder with no example stays as written, never a prototype's
  // member rendered.
  expect(example.rendered).toBe("Ana met $CONSTRUCTOR$");
});

test("in a target, an object of categories at an id the source reads as a plural is that plural, other or not (#950)", () => {
  const data = {
    n_rooms: {
      one: "%(count)s pokój",
      few: "%(count)s pokoje",
      many: "%(count)s pokoi",
    },
    pair: { one: "Jeden", two: "Dwa" },
  };
  expect(
    messagesToEntries(data, {
      type: "ui",
      plurals: true,
      pluralIds: new Set(["n_rooms"]),
    }),
  ).toEqual([
    {
      id: "n_rooms",
      type: "ui",
      source:
        "{count, plural, one {%(count)s pokój} few {%(count)s pokoje} many {%(count)s pokoi}}",
    },
    { id: "pair.one", type: "ui", source: "Jeden" },
    { id: "pair.two", type: "ui", source: "Dwa" },
  ]);
  // Where the source has no plural there, the keys stay keys.
  expect(
    messagesToEntries(data, { type: "ui", plurals: true }).map((e) => e.id),
  ).toEqual([
    "n_rooms.one",
    "n_rooms.few",
    "n_rooms.many",
    "pair.one",
    "pair.two",
  ]);
});

test("a target's object of categories is a plural exactly where the source's is; under i18next a lone other is a key (#984)", () => {
  // Mastodon's shape: the source's `edit_profile` is a section.
  const target = {
    edit_profile: { other: "أخرى" },
    rooms: { one: "a", other: "b" },
  };
  expect(
    messagesToEntries(target, {
      type: "ui",
      plurals: true,
      pluralIds: new Set(["rooms"]),
    }).map((e) => e.id),
  ).toEqual(["edit_profile.other", "rooms"]);
  // Grafana's `attribute-category: { other: "Other" }`, called as a key.
  const source = {
    "attribute-category": { other: "Other" },
    calls: { one: "{{count}} call", other: "{{count}} calls" },
  };
  expect(
    messagesToEntries(source, { type: "ui", plurals: "several" }).map((e) => [
      e.id,
      e.source,
    ]),
  ).toEqual([
    ["attribute-category.other", "Other"],
    ["calls", "{count, plural, one {{{count}} call} other {{{count}} calls}}"],
  ]);
  // A Japanese target's lone other, where the source has the plural.
  expect(
    messagesToEntries(
      { calls: { other: "{{count}} 件" } },
      { type: "ui", plurals: "several", pluralIds: new Set(["calls"]) },
    ).map((e) => e.id),
  ).toEqual(["calls"]);
});

test("under i18next a family of suffix keys is one plural; a lone _other, an _ordinal family and a base with its own key stay keys (#985)", () => {
  const source = {
    title_one: "{{count}} source",
    title_other: "{{count}} sources",
    gender_other: "Other",
    place_ordinal_one: "{{count}}st",
    place_ordinal_other: "{{count}}th",
    item: "Item",
    item_one: "one item",
    item_other: "items",
  };
  expect(
    messagesToEntries(source, { type: "ui", suffixPlurals: true }).map((e) => [
      e.id,
      e.source,
    ]),
  ).toEqual([
    [
      "title",
      "{count, plural, one {{{count}} source} other {{{count}} sources}}",
    ],
    ["gender_other", "Other"],
    ["place_ordinal_one", "{{count}}st"],
    ["place_ordinal_other", "{{count}}th"],
    ["item", "Item"],
    ["item_one", "one item"],
    ["item_other", "items"],
  ]);
  // A Polish target's forms are the source's family, a blank one none,
  // _zero among them.
  const pl = {
    title_one: "{{count}} źródło",
    title_few: "{{count}} źródła",
    title_many: "",
    title_other: "{{count}} źródeł",
    title_zero: "brak",
  };
  expect(
    messagesToEntries(pl, {
      type: "ui",
      suffixPlurals: true,
      pluralIds: new Set(["title"]),
    }),
  ).toEqual([
    {
      id: "title",
      type: "ui",
      source:
        "{count, plural, zero {brak} one {{{count}} źródło} few {{{count}} źródła} other {{{count}} źródeł}}",
    },
  ]);
});

test("a natural key's family of blanks is one string whose key is its text; a source family's forms are its language's; a bare key beside a target's family is none of its (#985 review)", () => {
  expect(
    messagesToEntries(
      {
        "You have {{count}} items_one": "",
        "You have {{count}} items_other": "",
      },
      {
        type: "ui",
        suffixPlurals: true,
        keyIsText: true,
        sourceLanguage: "en",
      },
    ),
  ).toEqual([
    {
      id: "You have {{count}} items",
      type: "ui",
      source: "You have {{count}} items",
      keyIsText: true,
    },
  ]);
  expect(
    messagesToEntries(
      { reason_one: "a", reason_two: "b", reason_other: "c" },
      { type: "ui", suffixPlurals: true, sourceLanguage: "en" },
    ).map((e) => e.id),
  ).toEqual(["reason_one", "reason_two", "reason_other"]);
  expect(
    messagesToEntries(
      {
        item: "{{count}} Element",
        item_one: "{{count}} Element",
        item_other: "{{count}} Elemente",
      },
      { type: "ui", suffixPlurals: true, pluralIds: new Set(["item"]) },
    ),
  ).toEqual([
    {
      id: "item",
      type: "ui",
      source:
        "{count, plural, one {{{count}} Element} other {{{count}} Elemente}}",
    },
  ]);
});
