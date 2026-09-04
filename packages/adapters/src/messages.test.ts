import { expect, test } from "vitest";
import { stringEntrySchema } from "@corpus/contract";
import { messagesToEntries } from "./messages";

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
