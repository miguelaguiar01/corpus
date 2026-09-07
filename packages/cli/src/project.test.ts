import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";
import { readToken } from "./config";
import { isLoopback, requireSecret } from "./project";

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
const dirs: string[] = [];
afterEach(() => {
  active?.close();
  active = undefined;
  delete process.env.CORPUS_SERVER;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-project-"));
  dirs.push(dir);
  return dir;
}

function ctx(overrides: Partial<RunContext> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    cwd: REPO,
    env: {} as NodeJS.ProcessEnv,
    out: (s: string) => stdout.push(s),
    err: (s: string) => stderr.push(s),
    stdout,
    stderr,
    ...overrides,
  };
}

test("project create posts the config's project with the secret and prints the token last", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 201,
    json: { slug: "push-fixture", token: "new-token" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx({ env: { CORPUS_INVITE_SECRET: "s3cret" } });
  expect(await run(["project", "create"], c)).toBe(0);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe("/api/projects");
  expect(calls[0]?.auth).toBe("Bearer s3cret");
  expect(calls[0]?.body).toEqual({
    slug: "push-fixture",
    name: "push-fixture",
    sourceLanguage: "en",
    languages: ["en"],
  });
  expect(c.stdout).toEqual(["new-token"]);
  expect(c.stderr.join("\n")).toMatch(/created project push-fixture/);
});

test("--name and --server override the config", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 201,
    json: { slug: "push-fixture", token: "t" },
  }));
  active = server;
  const c = ctx({ env: { CORPUS_INVITE_SECRET: "s3cret" } });
  await run(
    ["project", "create", "--name", "Push Fixture", "--server", `${url}/`],
    c,
  );
  expect((calls[0]?.body as { name: string }).name).toBe("Push Fixture");
});

test("an existing project is named, with the way to a token", async () => {
  const { server, url } = await startServer(() => ({
    status: 409,
    json: { error: "slug-taken" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx({ env: { CORPUS_INVITE_SECRET: "s3cret" } });
  expect(await run(["project", "create"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(/already exists/);
  expect(c.stderr.join("\n")).toMatch(/rotate/);
});

test("the secret comes from the env, or from .corpus/secret for a loopback server only", () => {
  const dir = tmp();
  mkdirSync(path.join(dir, ".corpus"));
  writeFileSync(path.join(dir, ".corpus/secret"), "local-secret\n");
  expect(
    requireSecret(
      { CORPUS_INVITE_SECRET: "env" },
      dir,
      "http://localhost:3000",
    ),
  ).toBe("env");
  expect(requireSecret({}, dir, "http://localhost:3000")).toBe("local-secret");
  expect(requireSecret({}, dir, "http://127.0.0.1:3000")).toBe("local-secret");
  expect(() => requireSecret({}, dir, "https://corpus.example")).toThrow(
    /CORPUS_INVITE_SECRET/,
  );
  expect(() => requireSecret({}, tmp(), "http://localhost:3000")).toThrow(
    /\.corpus\/secret/,
  );
  expect(isLoopback("not a url")).toBe(false);
});

test("the token comes from CORPUS_TOKEN, then .corpus/token, and the message names both", () => {
  const dir = tmp();
  expect(() => readToken({}, dir)).toThrow(/CORPUS_TOKEN.*\.corpus\/token/);
  mkdirSync(path.join(dir, ".corpus"));
  writeFileSync(path.join(dir, ".corpus/token"), "from-file\n");
  expect(readToken({}, dir)).toEqual({ token: "from-file", source: "file" });
  expect(readToken({ CORPUS_TOKEN: "from-env" }, dir)).toEqual({
    token: "from-env",
    source: "env",
  });
});

test("rotate-token posts the current token to the project's token route and prints the new one", async () => {
  const { server, url, calls } = await startServer(() => ({
    status: 200,
    json: { slug: "push-fixture", token: "rotated" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx({ env: { CORPUS_TOKEN: "current" } });
  expect(await run(["project", "rotate-token"], c)).toBe(0);
  expect(calls[0]?.url).toBe("/api/projects/push-fixture/token");
  expect(calls[0]?.auth).toBe("Bearer current");
  expect(c.stdout).toEqual(["rotated"]);
});

test("rotate-token rewrites .corpus/token when that file supplied the old one", async () => {
  const { server, url } = await startServer(() => ({
    status: 200,
    json: { slug: "push-fixture", token: "rotated" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const corpusDir = path.join(REPO, ".corpus");
  mkdirSync(corpusDir, { recursive: true });
  dirs.push(corpusDir);
  writeFileSync(path.join(corpusDir, "token"), "old\n");
  const c = ctx();
  expect(await run(["project", "rotate-token"], c)).toBe(0);
  expect(readFileSync(path.join(corpusDir, "token"), "utf8")).toBe("rotated\n");
  expect(statSync(path.join(corpusDir, "token")).mode & 0o777).toBe(0o600);
  expect(c.stderr.join("\n")).toMatch(/\.corpus\/token updated/);
});

test("a refused token on rotate-token is one line", async () => {
  const { server, url } = await startServer(() => ({
    status: 401,
    json: { error: "unauthorized" },
  }));
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx({ env: { CORPUS_TOKEN: "stale" } });
  expect(await run(["project", "rotate-token"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(/refused/);
});
