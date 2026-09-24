import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { seedDigest } from "@corpus/contract";
import { run, type RunContext } from "./cli";

const REPO = fileURLToPath(
  new URL("../test/fixtures/push-repo", import.meta.url),
);

type Captured = { url: string; auth: string | undefined; body: unknown };

function startServer(
  respond: (captured: Captured) => { status: number; json: unknown },
): Promise<{ server: Server; url: string; calls: Captured[] }> {
  const calls: Captured[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const captured: Captured = {
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      };
      calls.push(captured);
      const { status, json } = respond(captured);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, calls });
    });
  });
}

let active: Server | undefined;
afterEach(() => {
  active?.close();
  active = undefined;
  delete process.env.CORPUS_SERVER;
});

function ctx(
  overrides: Partial<RunContext> = {},
): RunContext & { output: string[] } {
  const output: string[] = [];
  return {
    cwd: REPO,
    env: { CORPUS_TOKEN: "good" },
    out: (s) => output.push(s),
    err: (s) => output.push(s),
    output,
    ...overrides,
  };
}

test("push builds, uploads with the bearer token, and prints the report", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 200,
    json: {
      report: {
        added: 2,
        changed: 0,
        stale: 0,
        archived: 0,
        seeded: 1,
        seedsIgnored: 1,
        seedsIdentical: 3,
      },
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(0);
  expect(calls[0]?.auth).toBe("Bearer good");
  expect(calls[0]?.url).toBe("/api/push");
  expect((calls[0]?.body as { project: string }).project).toBe("push-fixture");
  expect(c.output.join("\n")).toContain(
    "2 added, 0 changed, 0 stale, 0 archived, 1 translation(s) seeded from the repository (1 kept as Corpus has them; 3 identical to the source, kept untranslated)",
  );
});

test("a push whose sources went from empty to their text says so, and that nothing was marked stale (#620)", async () => {
  const { server, url } = await startServer(() => ({
    status: 200,
    json: {
      report: {
        added: 0,
        changed: 578,
        stale: 0,
        archived: 0,
        fromEmpty: 578,
      },
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  expect(await run(["push"], c)).toBe(0);
  expect(c.output.join("\n")).toContain(
    "0 added, 578 changed, 0 stale, 0 archived, 578 source(s) took their text where it was empty, nothing marked stale",
  );
});

test("a push digests its seeds per language, leaves out the languages the server already holds, and says so (#601)", async () => {
  const { mkdtempSync, cpSync, writeFileSync, mkdirSync, readFileSync } =
    await import("node:fs");
  // Inside the repo tree so the config's `@corpus/contract` import resolves.
  const tmp = fileURLToPath(new URL("../test/.tmp", import.meta.url));
  mkdirSync(tmp, { recursive: true });
  const repo = mkdtempSync(path.join(tmp, "push-seeds-"));
  cpSync(REPO, repo, { recursive: true });
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    readFileSync(path.join(repo, "corpus.config.ts"), "utf8").replace(
      'languages: ["en"]',
      'languages: ["en", "pt"]',
    ),
  );
  writeFileSync(
    path.join(repo, "i18n/pt.json"),
    JSON.stringify({ greeting: "Olá {name}" }),
  );
  const digest = seedDigest({ greeting: "Olá {name}" });
  const report = {
    added: 0,
    changed: 0,
    stale: 0,
    archived: 0,
    seeded: 0,
    seedsIgnored: 0,
    seedsIdentical: 0,
  };
  // The server holds pt's digest from the last push: pt's seeds stay home.
  const held = await startServer((captured) =>
    captured.url === "/api/push/digests"
      ? { status: 200, json: { seedDigests: { pt: digest } } }
      : { status: 200, json: { report } },
  );
  active = held.server;
  process.env.CORPUS_SERVER = held.url;
  const c = ctx({ cwd: repo });
  expect(await run(["push"], c)).toBe(0);
  expect(held.calls.map((call) => call.url)).toEqual([
    "/api/push/digests",
    "/api/push",
  ]);
  const body = held.calls[1]?.body as {
    seedTranslations?: unknown;
    seedDigests: Record<string, string>;
  };
  expect(body.seedTranslations).toBeUndefined();
  expect(body.seedDigests).toEqual({ pt: digest });
  expect(c.output.join("\n")).toContain(
    "0 archived, seeds unchanged for 1 language(s)",
  );
  held.server.close();
  // An older instance answers 404 on the route: everything is sent.
  const older = await startServer((captured) =>
    captured.url === "/api/push/digests"
      ? { status: 404, json: { error: "not-found" } }
      : { status: 200, json: { report } },
  );
  active = older.server;
  process.env.CORPUS_SERVER = older.url;
  const o = ctx({ cwd: repo });
  expect(await run(["push"], o)).toBe(0);
  expect(
    (older.calls[1]?.body as { seedTranslations?: unknown }).seedTranslations,
  ).toEqual({ pt: { greeting: "Olá {name}" } });
  expect(o.output.join("\n")).not.toContain("unchanged");
  older.server.close();
  // A server that reports another digest, or none, gets the seeds.
  for (const status of [
    { seedDigests: { pt: "0000000000000000" } },
    { seedDigests: null },
    {},
  ]) {
    const s = await startServer((captured) =>
      captured.url === "/api/push/digests"
        ? { status: 200, json: status }
        : { status: 200, json: { report } },
    );
    active = s.server;
    process.env.CORPUS_SERVER = s.url;
    const d = ctx({ cwd: repo });
    expect(await run(["push"], d)).toBe(0);
    const sent = s.calls[1]?.body as {
      seedTranslations?: Record<string, unknown>;
      seedDigests: Record<string, string>;
    };
    expect(sent.seedTranslations).toEqual({ pt: { greeting: "Olá {name}" } });
    expect(sent.seedDigests).toEqual({ pt: digest });
    expect(d.output.join("\n")).not.toContain("unchanged");
    s.server.close();
  }
  const { rmSync } = await import("node:fs");
  rmSync(repo, { recursive: true, force: true });
});

test("a push that seeds nothing says nothing about seeds, identical ones included", async () => {
  const { server, url } = await startServer(() => ({
    status: 200,
    json: {
      report: {
        added: 0,
        changed: 0,
        stale: 0,
        archived: 0,
        seeded: 0,
        seedsIgnored: 0,
        seedsIdentical: 4297,
      },
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  expect(await run(["push"], c)).toBe(0);
  const out = c.output.join("\n");
  expect(out).toContain("0 added, 0 changed, 0 stale, 0 archived");
  expect(out).not.toMatch(/seed/i);
});

test("a first push whose seeds are all the source text still says why those rows are untranslated", async () => {
  const { server, url } = await startServer(() => ({
    status: 200,
    json: {
      report: {
        added: 1920,
        changed: 0,
        stale: 0,
        archived: 0,
        seeded: 0,
        seedsIgnored: 13,
        seedsIdentical: 3840,
      },
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  expect(await run(["push"], c)).toBe(0);
  const out = c.output.join("\n");
  expect(out).toContain(
    "1920 added, 0 changed, 0 stale, 0 archived, 13 repository translation(s) kept as Corpus has them; 3840 repository translation(s) identical to the source, kept untranslated",
  );
  expect(out).not.toMatch(/0 translation\(s\) seeded/);
});

test("--dry-run sends the dryRun flag and labels the output", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 200,
    json: {
      report: { added: 2, changed: 0, stale: 0, archived: 0 },
      dryRun: true,
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  const code = await run(["push", "--dry-run"], c);
  expect(code).toBe(0);
  expect(calls[0]?.url).toBe("/api/push?dryRun");
  expect(c.output.join("\n")).toMatch(/dry-run/);
});

test("languages that differ between the config and the project are named, one line each", async () => {
  const { server, url } = await startServer(() => ({
    status: 200,
    json: {
      report: { added: 0, changed: 0, stale: 0, archived: 0 },
      languages: ["en", "de"],
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  expect(await run(["push"], c)).toBe(0);
  const text = c.output.join("\n");
  expect(text).toMatch(/the project has de, which the config does not declare/);
  expect(text).not.toMatch(/the config declares/);
});

test("a 401 prints an actionable message", async () => {
  const { server, url } = await startServer(() => ({
    status: 401,
    json: { error: "unauthorized" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(1);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN/);
});

test("a 422 renders each per-entry error", async () => {
  const { server, url } = await startServer(() => ({
    status: 422,
    json: {
      error: "invalid-snapshot",
      errors: [{ id: "greeting", message: "bad ICU" }],
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(1);
  expect(c.output.join("\n")).toContain("greeting: bad ICU");
});

test("a transport failure (server unreachable) is a clean error, not a stack trace", async () => {
  process.env.CORPUS_SERVER = "http://127.0.0.1:1"; // nothing listening
  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(1);
  expect(c.output.join("\n")).toMatch(/could not reach the server/);
});

test("an unexpected non-2xx renders the server's message", async () => {
  const { server, url } = await startServer(() => ({
    status: 403,
    json: {
      error: "project-mismatch",
      message: "token is for a different project",
    },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(1);
  expect(c.output.join("\n")).toContain("token is for a different project");
});

test("a source string that does not parse is refused, the rest is pushed, and the exit code is 1", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 200,
    json: { report: { added: 1, changed: 0, stale: 0, archived: 0 } },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const bad = fileURLToPath(
    new URL("../test/fixtures/push-bad", import.meta.url),
  );
  const c = ctx({ cwd: bad });
  const code = await run(["push"], c);
  expect(code).toBe(1);
  const body = calls[0]?.body as { strings: { id: string }[] };
  expect(body.strings.map((s) => s.id)).toEqual(["app.title"]);
  const out = c.output.join("\n");
  expect(out).toMatch(/i18n\/en\.json \[stray\]: invalid ICU: /);
  expect(out).toContain("pushed push-bad: 1 added");
  expect(out).toContain(
    "corpus: 1 string(s) refused and not pushed; a refused string the project holds is archived until it parses",
  );
});

test("push builds and validates before it asks for the token", async () => {
  const broken = fileURLToPath(
    new URL("../test/fixtures/broken", import.meta.url),
  );
  const c = ctx({ cwd: broken, env: {} });
  const code = await run(["push"], c);
  expect(code).not.toBe(0);
  expect(c.output.join("\n")).toMatch(/missing\/en\.json/);
  expect(c.output.join("\n")).not.toMatch(/CORPUS_TOKEN/);
  const c2 = ctx({ env: {} });
  expect(await run(["push"], c2)).not.toBe(0);
  expect(c2.output.join("\n")).toMatch(/CORPUS_TOKEN is not set/);
});
