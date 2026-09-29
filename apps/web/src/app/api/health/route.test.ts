import { afterEach, expect, test } from "vitest";
import { LIBRARIES, writableSourceSchema } from "@corpus/contract";
import { GET } from "./route";

const original = process.env.CORPUS_VERSION;
afterEach(() => {
  if (original === undefined) delete process.env.CORPUS_VERSION;
  else process.env.CORPUS_VERSION = original;
});

test("health reports ok and the stamped version", async () => {
  process.env.CORPUS_VERSION = "abc1234";
  expect(await GET().json()).toMatchObject({
    status: "ok",
    version: "abc1234",
  });
});

test("an unstamped build reports dev", async () => {
  delete process.env.CORPUS_VERSION;
  expect(await GET().json()).toMatchObject({ status: "ok", version: "dev" });
});

test("health reports the contract's closed values it accepts (#875)", async () => {
  const body = (await GET().json()) as {
    accepts: { adapters: string[]; libraries: string[] };
  };
  expect(body.accepts.libraries).toEqual([...LIBRARIES]);
  expect(body.accepts.adapters).toEqual(
    writableSourceSchema.shape.adapter.options,
  );
});
