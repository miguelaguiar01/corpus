import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";
import { render, type Status } from "./status";

const REPO = fileURLToPath(
  new URL("../test/fixtures/push-repo", import.meta.url),
);

const STATUS: Status = {
  project: "push-fixture",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  strings: 2,
  lastPushAt: "2026-09-07T01:00:00.000Z",
  version: "v0.5.0",
  progress: {
    perLanguage: {
      en: { untranslated: 0, translated: 1, verified: 1, stale: 0, total: 2 },
      "pt-PT": {
        untranslated: 1,
        translated: 1,
        verified: 0,
        stale: 0,
        total: 2,
      },
    },
    perType: {
      chrome: {
        en: { untranslated: 0, translated: 1, verified: 1, stale: 0, total: 2 },
        "pt-PT": {
          untranslated: 1,
          translated: 1,
          verified: 0,
          stale: 0,
          total: 2,
        },
      },
    },
  },
};

function startServer(
  status: number,
  json: unknown,
): Promise<{ server: Server; url: string; auths: (string | undefined)[] }> {
  const auths: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    auths.push(req.headers.authorization);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, auths });
    });
  });
}

let active: Server | undefined;
afterEach(() => {
  active?.close();
  active = undefined;
  delete process.env.CORPUS_SERVER;
});

function ctx() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const c: RunContext & { stdout: string[]; stderr: string[] } = {
    cwd: REPO,
    env: { CORPUS_TOKEN: "tok" },
    out: (s) => stdout.push(s),
    err: (s) => stderr.push(s),
    stdout,
    stderr,
  };
  return c;
}

test("status fetches with the token and prints the tables and the drift", async () => {
  const { server, url, auths } = await startServer(200, STATUS);
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx();
  expect(await run(["status"], c)).toBe(0);
  expect(auths[0]).toBe("Bearer tok");
  const out = c.stdout.join("\n");
  expect(out).toContain(
    `push-fixture on ${url}: 2 string(s), last push 2026-09-07T01:00:00.000Z, server v0.5.0`,
  );
  expect(out).toContain(
    "language  untranslated  translated  verified  stale  total",
  );
  expect(out).toContain(
    "pt-PT                1           1         0      0      2",
  );
  expect(out).toContain("chrome    untranslated");
  // The fixture's config declares en only; the project has pt-PT too.
  expect(c.stderr.join("\n")).toMatch(
    /the project has pt-PT, which the config does not declare/,
  );
});

test("--json prints the server's object unchanged", async () => {
  const { server, url } = await startServer(200, STATUS);
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx();
  expect(await run(["status", "--json"], c)).toBe(0);
  expect(JSON.parse(c.stdout.join("\n"))).toEqual(STATUS);
});

test("a refused token is one line", async () => {
  const { server, url } = await startServer(401, { error: "unauthorized" });
  active = server;
  process.env.CORPUS_SERVER = url;
  const c = ctx();
  expect(await run(["status"], c)).toBe(1);
  expect(c.stderr.join("\n")).toMatch(/refused/);
});

test("a long type name widens the first column of every table", () => {
  const lines = render(
    {
      ...STATUS,
      progress: {
        perLanguage: STATUS.progress.perLanguage,
        perType: { "dialogue-line": STATUS.progress.perType.chrome! },
      },
    },
    "http://x",
  );
  expect(lines).toContain(
    "language       untranslated  translated  verified  stale  total",
  );
  expect(lines).toContain(
    "dialogue-line  untranslated  translated  verified  stale  total",
  );
});

test("render says never pushed and shows a language with no rows as zeros", () => {
  const lines = render(
    {
      ...STATUS,
      strings: 0,
      lastPushAt: null,
      languages: ["en", "fr"],
      progress: { perLanguage: {}, perType: {} },
    },
    "https://corpus.example",
  );
  expect(lines[0]).toBe(
    "push-fixture on https://corpus.example: 0 string(s), never pushed, server v0.5.0",
  );
  expect(lines).toContain(
    "fr                   0           0         0      0      0",
  );
});

test("render names pending proposals when there are any", () => {
  const lines = render({ ...STATUS, pendingProposals: 2 }, "http://x");
  expect(lines[1]).toBe("2 proposal(s) pending: corpus pull writes them");
  expect(render(STATUS, "http://x")[1]).toBe("");
});
