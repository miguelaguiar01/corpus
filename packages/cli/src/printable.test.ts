import { expect, test } from "vitest";
import { printable } from "./printable";

test("control characters in an id print escaped, so a finding stays one line (#648)", () => {
  expect(printable("The recipient\ncould not be removed")).toBe(
    "The recipient\\ncould not be removed",
  );
  expect(printable("a\tb\rc")).toBe("a\\tb\\rc");
  expect(printable("x\u0000y\u001b\u007f\u2028")).toBe(
    "x\\u0000y\\u001b\\u007f\\u2028",
  );
  expect(printable('plain "quoted" \\ café')).toBe('plain "quoted" \\ café');
});
