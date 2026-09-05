import { expect, test } from "vitest";
import {
  hashPassword,
  passwordProblem,
  temporaryPassword,
  verifyPassword,
} from "./password";

test("a password verifies against its own hash and no other", () => {
  const stored = hashPassword("correct horse battery");
  expect(stored.startsWith("scrypt$")).toBe(true);
  expect(stored).not.toContain("correct horse battery");
  expect(verifyPassword("correct horse battery", stored)).toBe(true);
  expect(verifyPassword("correct horse batter", stored)).toBe(false);
  expect(verifyPassword("", stored)).toBe(false);
});

test("two hashes of one password differ, so equal passwords are not visible in the table", () => {
  expect(hashPassword("same")).not.toBe(hashPassword("same"));
});

test("a malformed stored value never verifies", () => {
  expect(verifyPassword("x", "")).toBe(false);
  expect(verifyPassword("x", "plain")).toBe(false);
  expect(verifyPassword("x", "scrypt$32768$zz$")).toBe(false);
});

test("length limits", () => {
  expect(passwordProblem("short")).toBe("short");
  expect(passwordProblem("a".repeat(201))).toBe("long");
  expect(passwordProblem("long enough")).toBeUndefined();
});

test("a temporary password is readable and unique enough", () => {
  const a = temporaryPassword();
  expect(a).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  expect(a).not.toBe(temporaryPassword());
});
