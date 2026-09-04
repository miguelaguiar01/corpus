import { expect, test } from "vitest";
import { BUILT_IN_ADAPTERS } from "./index.js";

test("the three built-in adapters of spec §3 are declared", () => {
  expect(BUILT_IN_ADAPTERS).toEqual(["messages", "table", "exec"]);
});
