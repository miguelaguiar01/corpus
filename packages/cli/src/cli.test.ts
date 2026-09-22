import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { loadConfig } from "./config";
import { KNOWN_FLAGS, run, type RunContext } from "./cli";

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

test("push without a token errors, naming the env var and the file", async () => {
  // A complete repository: the snapshot builds, then the token is missing.
  const c = ctx({ cwd: PUSH_ONLY, env: {} });
  const code = await run(["push"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN.*\.corpus\/token/);
});

// The full push flow (build + upload + report rendering) is covered in
// push.test.ts against a real test server.

const PUSH_ONLY = fileURLToPath(
  new URL("../test/fixtures/push-only", import.meta.url),
);

test("corpus build lists a refused entry, builds the rest and exits 1", async () => {
  const bad = fileURLToPath(
    new URL("../test/fixtures/push-bad", import.meta.url),
  );
  const c = ctx({ cwd: bad });
  const code = await run(["build"], c);
  expect(code).toBe(1);
  const out = c.output.join("\n");
  expect(out).toMatch(/i18n\/en\.json \[stray\]: invalid ICU: /);
  expect(out).toContain("built push-bad: 1 string(s)");
  expect(out).toContain(
    "corpus: 1 string(s) refused and left out of the snapshot",
  );
});

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

test("corpus build names a .ts catalogue as one pull cannot write back", async () => {
  const c = ctx({
    cwd: fileURLToPath(
      new URL("../test/fixtures/ts-catalogue", import.meta.url),
    ),
    env: {},
  });
  expect(await run(["build"], c)).toBe(0);
  expect(c.output).toContain(
    "built ts-catalogue: 2 string(s) (chrome 2), 0 entity(ies) (none)",
  );
  expect(c.output).toContain(
    "corpus: i18n/{lang}.ts is not JSON: pull writes JSON only, so its translations cannot be written back",
  );
});

test("--version prints the CLI's version alone, on stdout", async () => {
  const c = ctx({
    err: (s) => {
      throw new Error(`stderr: ${s}`);
    },
  });
  expect(await run(["--version"], c)).toBe(0);
  expect(c.output).toEqual([expect.stringMatching(/^\d+\.\d+\.\d+/)]);
  const short = ctx();
  await run(["-v"], short);
  expect(short.output).toEqual(c.output);
});

test("every flag the usage advertises is a flag its command accepts", async () => {
  // The refusal table is the risk this introduces: a flag added to a
  // command and not added here becomes a hard error, which is worse
  // than the silent ignore it replaced.
  const printed: string[] = [];
  await run(["--help"], { ...ctx(), out: (line) => printed.push(line) });
  const usage = printed.join("\n");
  const segments = usage
    .split(/\n|\s\|\s/)
    .map((row) => row.replace(/^\s*(usage:\s*)?/, "").trim())
    .filter((row) => row.startsWith("corpus "));
  for (const segment of segments) {
    const [, command, ...rest] = segment.split(/\s+/);
    if (command === "agent") continue;
    const sub = rest[0];
    const key =
      command === "project" && sub && !sub.startsWith("[")
        ? `project ${sub}`
        : command!;
    const flags = new Set(segment.match(/--[a-z-]+/g) ?? []);
    for (const flag of flags) {
      expect(
        KNOWN_FLAGS[key],
        `corpus ${key} advertises ${flag} and the refusal table has no entry`,
      ).toContain(flag);
    }
  }
});
