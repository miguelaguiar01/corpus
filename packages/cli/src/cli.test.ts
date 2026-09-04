import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadConfig } from "./config";
import { run, type RunContext } from "./cli";

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/basic", import.meta.url),
);
const EMPTY = fileURLToPath(new URL("../test/fixtures", import.meta.url));

function ctx(
  overrides: Partial<RunContext> = {},
): RunContext & { output: string[] } {
  const output: string[] = [];
  return {
    cwd: FIXTURE,
    env: { CORPUS_TOKEN: "tok" },
    out: (s) => output.push(s),
    err: (s) => output.push(s),
    output,
    ...overrides,
  };
}

test("loadConfig returns the defineCorpus-typed object", async () => {
  const config = await loadConfig(FIXTURE);
  expect(config.project).toBe("fixture-project");
  expect(config.sources).toHaveLength(1);
});

test("loadConfig throws a specific error when no config exists", async () => {
  await expect(loadConfig(EMPTY)).rejects.toThrow(/corpus\.config\.ts/);
});

test("no command prints usage and exits non-zero", async () => {
  const c = ctx();
  const code = await run([], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/usage/i);
});

test("unknown command prints usage and exits non-zero", async () => {
  const c = ctx();
  const code = await run(["frobnicate"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/usage/i);
});

test("push without a config errors, naming corpus.config.ts", async () => {
  const c = ctx({ cwd: EMPTY });
  const code = await run(["push"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/corpus\.config\.ts/);
});

test("push without CORPUS_TOKEN errors, naming the env var", async () => {
  const c = ctx({ env: {} });
  const code = await run(["push"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN/);
});

// The full push flow (build + upload + report rendering) is covered in
// push.test.ts against a real test server.
