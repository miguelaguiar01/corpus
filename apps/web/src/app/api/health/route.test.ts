import { afterEach, expect, test } from "vitest";
import { GET } from "./route";

const original = process.env.CORPUS_VERSION;
afterEach(() => {
  if (original === undefined) delete process.env.CORPUS_VERSION;
  else process.env.CORPUS_VERSION = original;
});

test("health reports ok and the stamped version", async () => {
  process.env.CORPUS_VERSION = "abc1234";
  expect(await GET().json()).toEqual({ status: "ok", version: "abc1234" });
});

test("an unstamped build reports dev", async () => {
  delete process.env.CORPUS_VERSION;
  expect(await GET().json()).toEqual({ status: "ok", version: "dev" });
});
