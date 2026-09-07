import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { provision, wantsProvision } from "./provision";

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/push-repo", import.meta.url),
);
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

type Captured = { url: string; auth: string | undefined; body: unknown };

function startServer(
  status: number,
  json: unknown,
): Promise<{ server: Server; url: string; calls: Captured[] }> {
  const calls: Captured[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      calls.push({
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
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
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-provision-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, ".corpus"));
  return dir;
}

// The push fixture's config (project push-fixture, en only), resolving
// the workspace's packages through a linked node_modules.
function repo(): string {
  const dir = tmp();
  cpSync(FIXTURE, dir, { recursive: true });
  symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

test("provisioning wants a config and no token, unless told not to", () => {
  const dir = tmp();
  expect(wantsProvision(dir, [])).toBe(false);
  writeFileSync(path.join(dir, "corpus.config.ts"), "");
  expect(wantsProvision(dir, [])).toBe(true);
  expect(wantsProvision(dir, ["--no-provision"])).toBe(false);
  writeFileSync(path.join(dir, ".corpus/token"), "t\n");
  expect(wantsProvision(dir, [])).toBe(false);
});

test("a created project's token lands in .corpus/token, owner-only", async () => {
  const { server, url, calls } = await startServer(201, {
    slug: "push-fixture",
    token: "fresh",
  });
  active = server;
  const dir = repo();
  const line = await provision(dir, url, "s3cret");
  expect(calls[0]?.url).toBe("/api/projects");
  expect(calls[0]?.auth).toBe("Bearer s3cret");
  expect(calls[0]?.body).toEqual({
    slug: "push-fixture",
    name: "push-fixture",
    sourceLanguage: "en",
    languages: ["en"],
  });
  const token = path.join(dir, ".corpus/token");
  expect(readFileSync(token, "utf8")).toBe("fresh\n");
  expect(statSync(token).mode & 0o777).toBe(0o600);
  expect(line).toMatch(/written to \.corpus\/token/);
  expect(line).not.toContain("fresh");
});

test("an existing project names the settings page and the file, writes nothing", async () => {
  const { server, url } = await startServer(409, { error: "slug-taken" });
  active = server;
  const dir = repo();
  const line = await provision(dir, url, "s3cret");
  expect(line).toContain(`${url}/p/push-fixture/settings`);
  expect(line).toMatch(/\.corpus\/token/);
  expect(() => statSync(path.join(dir, ".corpus/token"))).toThrow();
});

test("any other failure is one line with the status", async () => {
  const { server, url } = await startServer(422, {
    error: "invalid",
    message: "languages",
  });
  active = server;
  const line = await provision(repo(), url, "s3cret");
  expect(line).toMatch(/HTTP 422: languages/);
});

test("a config that does not load, an unreachable server and an unwritable file are one line each", async () => {
  const broken = tmp();
  writeFileSync(path.join(broken, "corpus.config.ts"), "export default 42;\n");
  expect(await provision(broken, "http://127.0.0.1:1", "s")).toMatch(
    /^token {5}not written: .*corpus\.config\.ts/,
  );
  expect(await provision(repo(), "http://127.0.0.1:1", "s")).toMatch(
    /^token {5}not written: could not reach the server/,
  );
  const { server, url } = await startServer(201, {
    slug: "push-fixture",
    token: "t",
  });
  active = server;
  const dir = repo();
  mkdirSync(path.join(dir, ".corpus/token"));
  expect(await provision(dir, url, "s")).toMatch(/^token {5}not written: /);
});
