import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
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
    json: { report: { added: 2, changed: 0, stale: 0, archived: 0 } },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;

  const c = ctx();
  const code = await run(["push"], c);
  expect(code).toBe(0);
  expect(calls[0]?.auth).toBe("Bearer good");
  expect(calls[0]?.url).toBe("/api/push");
  expect((calls[0]?.body as { project: string }).project).toBe("push-fixture");
  expect(c.output.join("\n")).toContain("2 added");
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
