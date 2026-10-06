import { expect, test } from "vitest";
import { carriedFrom } from "./carried";

test("a draft and its opened version ride back only beside a refusal or warning (#529, #1058)", () => {
  expect(carriedFrom({ error: "x", draft: "d", opened: "5" }, 9)).toEqual({
    draft: "d",
    openedVersion: 5,
  });
  expect(carriedFrom({ warning: "source-changed", draft: "d" }, 9)).toEqual({
    draft: "d",
    openedVersion: 9,
  });
  // A bare link's draft or version is ignored.
  expect(carriedFrom({ draft: "d", opened: "5" }, 9)).toEqual({
    openedVersion: 9,
  });
  // A version that is not a number is the row's.
  for (const opened of ["", "5x", "-", "1e999", ["5", "6"]])
    expect(carriedFrom({ error: "x", draft: "d", opened }, 9)).toEqual({
      draft: "d",
      openedVersion: 9,
    });
  expect(carriedFrom({ error: "x", draft: ["a", "b"] }, 9)).toEqual({
    openedVersion: 9,
  });
});
