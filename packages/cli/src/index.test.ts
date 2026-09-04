import { expect, test } from "vitest";
import { CLI_NAME } from "./index.js";

test("cli binary name is corpus", () => {
  expect(CLI_NAME).toBe("corpus");
});
