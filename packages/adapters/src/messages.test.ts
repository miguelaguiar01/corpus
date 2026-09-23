import { expect, test } from "vitest";
import { stringEntrySchema } from "@corpus/contract";
import { messagesToEntries, KEY_IS_TEXT, keyIsSentence } from "./messages";

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
    { "{amount} off": "", "Sign in": "", "ui.empty": "", "ui.title": "Title" },
    { type: "ui" },
  );
  expect(entries.map((e) => [e.id, e.source])).toEqual([
    ["{amount} off", "{amount} off"],
    ["Sign in", "Sign in"],
    ["ui.empty", ""],
    ["ui.title", "Title"],
  ]);
  expect(entries.filter((e) => KEY_IS_TEXT.has(e)).map((e) => e.id)).toEqual([
    "{amount} off",
    "Sign in",
  ]);
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
