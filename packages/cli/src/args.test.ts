import { expect, test } from "vitest";
import { option, options } from "./args";

test("option returns the first value or nothing", () => {
  expect(option(["--port", "3000"], "--port")).toBe("3000");
  expect(option(["--open"], "--port")).toBeUndefined();
});

test("options returns every value in order", () => {
  expect(options([], "--lang")).toEqual([]);
  expect(options(["--lang", "pt"], "--lang")).toEqual(["pt"]);
  expect(
    options(["--lang", "pt", "--check", "--lang", "fr"], "--lang"),
  ).toEqual(["pt", "fr"]);
});

test("options refuses a missing value instead of ignoring it or eating a flag", () => {
  expect(() => options(["--lang"], "--lang")).toThrow(/--lang needs a value/);
  expect(() => options(["--lang", "--check"], "--lang")).toThrow(
    /--lang needs a value/,
  );
});
