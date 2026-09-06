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
  // A complete repository: the snapshot builds, then the token is missing.
  const c = ctx({ cwd: PUSH_ONLY, env: {} });
  const code = await run(["push"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN/);
});

// The full push flow (build + upload + report rendering) is covered in
// push.test.ts against a real test server.

const PUSH_ONLY = fileURLToPath(
  new URL("../test/fixtures/push-only", import.meta.url),
);

test("corpus build summarises the snapshot without a server and names push-only sources", async () => {
  const c = ctx({ cwd: PUSH_ONLY, env: {} });
  const code = await run(["build"], c);
  expect(code).toBe(0);
  expect(c.output).toContain(
    "built push-only: 3 string(s) (chrome 1, step 1, clue 1), 1 entity(ies) (room 1)",
  );
  expect(c.output).toContain(
    'corpus: exec "node export.mjs" is push-only: add importCommand to write translations back',
  );
  expect(c.output).toContain(
    "corpus: steps.json has no {lang}: its translations cannot be written back",
  );
});

test("corpus build --out writes the snapshot JSON", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "corpus-build-"));
  try {
    const c = ctx({ cwd: PUSH_ONLY, env: {} });
    const code = await run(["build", "--out", join(dir, "snapshot.json")], c);
    expect(code).toBe(0);
    const snapshot = JSON.parse(
      readFileSync(join(dir, "snapshot.json"), "utf8"),
    );
    expect(snapshot.contract).toBe("corpus/1");
    expect(snapshot.entityTypes).toEqual({ room: { label: "Room" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
