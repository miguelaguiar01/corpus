import { expect, test } from "vitest";
import { CLI_NAME } from "./index.js";

test("cli binary name is corpus", () => {
  expect(CLI_NAME).toBe("corpus");
});

test("the config helper a client project imports is exported", async () => {
  const { defineCorpus } = await import("./index");
  expect(typeof defineCorpus).toBe("function");
});
