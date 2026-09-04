import { expect, test } from "vitest";
import { CONTRACT_VERSION } from "./index.js";

test("contract version identifier is corpus/1", () => {
  expect(CONTRACT_VERSION).toBe("corpus/1");
});
