import { expect, test } from "vitest";
import { canVerifyRow } from "./permissions";

const row = (
  state: "untranslated" | "translated" | "verified",
  archived = false,
) => ({
  state,
  archived,
});

test("a maintainer can verify a translated row", () => {
  expect(canVerifyRow({ maintainer: true }, row("translated"))).toBe(true);
});

test.each(["untranslated", "verified"] as const)(
  "nothing to sign off on a %s row",
  (state) => {
    expect(canVerifyRow({ maintainer: true }, row(state))).toBe(false);
  },
);

test("non-maintainers never see verify", () => {
  expect(canVerifyRow({ maintainer: false }, row("translated"))).toBe(false);
  expect(canVerifyRow(undefined, row("translated"))).toBe(false);
});

test("archived strings are read-only", () => {
  expect(canVerifyRow({ maintainer: true }, row("translated", true))).toBe(
    false,
  );
});
