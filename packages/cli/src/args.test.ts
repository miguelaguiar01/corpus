import { expect, test } from "vitest";
import { refuseUnknown } from "./args";
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

test("a flag the command does not know is refused, not ignored", () => {
  // #520: `--langs` silently pulled every language, so a CI gate went
  // green having checked something other than what it named.
  expect(() => refuseUnknown("pull", ["--check"], ["--check"])).not.toThrow();
  expect(() => refuseUnknown("pull", ["--langs", "pt-PT"], ["--lang"])).toThrow(
    /pull: unknown option --langs; did you mean --lang\?/,
  );
  expect(() => refuseUnknown("push", ["--dry-runz"], ["--dry-run"])).toThrow(
    /did you mean --dry-run\?/,
  );
  // One match is a typo; several mean the word is a stub of the table.
  expect(() => refuseUnknown("status", ["--j"], ["--json"])).toThrow(
    /did you mean --json\?/,
  );
  expect(() => refuseUnknown("pull", ["--"], ["--lang", "--check"])).toThrow(
    /unknown option --$/,
  );
  // `--flag=value` is read by nothing, so it is refused rather than
  // taken as known and then ignored.
  expect(() => refuseUnknown("build", ["--out=f.json"], ["--out"])).toThrow(
    /--out=… is not read; give --out and its value as two words/,
  );
  // A subcommand and a value are words, not flags.
  expect(() =>
    refuseUnknown("project", ["create", "--name", "Acme app"], ["--name"]),
  ).not.toThrow();
  // An unknown flag in the `=` form is refused for the form first: it
  // is read by nothing either way.
  expect(() => refuseUnknown("pull", ["--nope=1"], ["--check"])).toThrow(
    /--nope=… is not read/,
  );
});
