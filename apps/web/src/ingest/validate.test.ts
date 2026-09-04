import { moonlightManor } from "@corpus/contract";
import { expect, test } from "vitest";
import { validateSnapshot } from "./validate";

function clone(): typeof moonlightManor {
  return structuredClone(moonlightManor);
}

test("the golden fixture validates", () => {
  const result = validateSnapshot(moonlightManor);
  expect(result.ok).toBe(true);
});

test("a non-object body fails with a snapshot-level error", () => {
  const result = validateSnapshot(42);
  expect(result.ok).toBe(false);
});

test("a bad contract id fails", () => {
  const result = validateSnapshot({ ...clone(), contract: "corpus/2" });
  expect(result.ok).toBe(false);
});

test("an invalid ICU source is reported against its entry id", () => {
  const snap = clone();
  snap.strings[1]!.source = "{n, plural, one {x} other {y}}";
  const result = validateSnapshot(snap);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.id === "skin.heard-nothing")).toBe(true);
  }
});

test("a ref to a missing entity is reported", () => {
  const snap = clone();
  snap.strings[0]!.metadata.requires_trait = "trait:ghost";
  const result = validateSnapshot(snap);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.message.includes("trait:ghost"))).toBe(
      true,
    );
  }
});

test("a list<ref> to a missing entity is reported", () => {
  const snap = clone();
  snap.strings[0]!.metadata.mentions = [
    "character:condessa-rosa",
    "character:nobody",
  ];
  const result = validateSnapshot(snap);
  expect(result.ok).toBe(false);
});

test("duplicate string ids are rejected", () => {
  const snap = clone();
  snap.strings.push({ ...snap.strings[0]! });
  const result = validateSnapshot(snap);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(
      result.errors.some((e) => e.message.includes("duplicate string")),
    ).toBe(true);
  }
});

test("duplicate entity ids are rejected", () => {
  const snap = clone();
  snap.entities.push({ ...snap.entities[0]! });
  const result = validateSnapshot(snap);
  expect(result.ok).toBe(false);
});

test("a minimal valid snapshot with no declarations passes", () => {
  const result = validateSnapshot({
    contract: "corpus/1",
    project: "p",
    sourceLanguage: "en",
    strings: [{ id: "a", type: "t", source: "hello {name}" }],
  });
  expect(result.ok).toBe(true);
});
