import { expect, test } from "vitest";
import { changedSinceOpened, versionOf } from "./version";

const opened = new Date("2026-09-04T10:00:00Z");
const later = new Date("2026-09-04T10:05:00Z");

test("versionOf is the row's updatedAt in milliseconds", () => {
  expect(versionOf({ updatedAt: opened })).toBe(opened.getTime());
});

test("a token matching the current version is not a concurrent edit", () => {
  expect(changedSinceOpened(versionOf({ updatedAt: opened }), opened)).toBe(
    false,
  );
});

test("a token older than the current version is a concurrent edit", () => {
  expect(changedSinceOpened(versionOf({ updatedAt: opened }), later)).toBe(
    true,
  );
});

test("no token means nothing to compare, so no warning", () => {
  expect(changedSinceOpened(undefined, later)).toBe(false);
});
