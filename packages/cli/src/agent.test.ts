import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { parseAgent } from "./agent";
import { run, type RunContext } from "./cli";

const REPO = fileURLToPath(
  new URL("../test/fixtures/push-repo", import.meta.url),
);

type Seen = { method: string; path: string; auth?: string; body: unknown };

function startApi(
  answer: (seen: Seen) => { status: number; body: unknown },
): Promise<{ server: Server; url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const entry: Seen = {
        method: req.method ?? "",
        path: req.url ?? "",
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      };
      seen.push(entry);
      const { status, body } = answer(entry);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, seen });
    });
  });
}

let api: Awaited<ReturnType<typeof startApi>> | undefined;
afterEach(() => {
  api?.server.close();
  api = undefined;
  delete process.env.CORPUS_SERVER;
});

// The fixture config reads the server from the process environment.
function ctx(url: string) {
  process.env.CORPUS_SERVER = url;
  const out: string[] = [];
  const err: string[] = [];
  const context: RunContext = {
    cwd: REPO,
    env: { CORPUS_TOKEN: "tok-1" },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { context, out, err };
}

test("each subcommand is one tool call with the arguments the API needs", () => {
  expect(
    parseAgent(["queue", "stale", "--lang", "pt-PT", "--type", "chrome"]),
  ).toEqual({
    tool: "list_queue",
    args: { queue: "stale", language: "pt-PT", type: "chrome" },
  });
  expect(parseAgent(["queue", "untranslated"])).toEqual({
    tool: "list_queue",
    args: { queue: "untranslated" },
  });
  expect(parseAgent(["string", "ui.continue"])).toEqual({
    tool: "get_string",
    args: { key: "ui.continue" },
  });
  expect(
    parseAgent(["draft", "ui.continue", "pt-PT", "Continuar", "agora"]),
  ).toEqual({
    tool: "save_draft",
    args: { key: "ui.continue", language: "pt-PT", text: "Continuar agora" },
  });
  expect(
    parseAgent(["propose", "ui.continue", "--text", "Prosseguir"]),
  ).toEqual({
    tool: "propose_change",
    args: { key: "ui.continue", text: "Prosseguir" },
  });
  expect(parseAgent(["propose", "ui.continue", "--remove"])).toEqual({
    tool: "propose_removal",
    args: { key: "ui.continue" },
  });
  expect(
    parseAgent([
      "add",
      "ui.back",
      "--file",
      "i18n/{lang}.json",
      "--text",
      "Back",
    ]),
  ).toEqual({
    tool: "add_string",
    args: { key: "ui.back", file: "i18n/{lang}.json", text: "Back" },
  });
  expect(parseAgent(["status"])).toEqual({ tool: "status", args: {} });
});

test("a missing word is named in the usage's terms; an unknown subcommand shows the usage", () => {
  expect(() => parseAgent(["draft", "ui.continue", "pt-PT"])).toThrow(
    /the text is missing/,
  );
  expect(() => parseAgent(["propose", "ui.continue"])).toThrow(
    /--text or --remove is missing/,
  );
  expect(() => parseAgent(["add", "ui.back", "--text", "x"])).toThrow(
    /--file is missing/,
  );
  expect(() => parseAgent(["queue"])).toThrow(/the queue is missing/);
  expect(() => parseAgent(["verify"])).toThrow(/usage: corpus agent/);
});

test("flags are read by what they take, wherever they stand; unknown ones and bare valued ones are refused", () => {
  expect(parseAgent(["propose", "--remove", "ui.continue"])).toEqual({
    tool: "propose_removal",
    args: { key: "ui.continue" },
  });
  expect(() =>
    parseAgent(["propose", "ui.continue", "--remove", "extra"]),
  ).toThrow(/unexpected word extra/);
  expect(() => parseAgent(["add", "k", "--file", "--text", "x"])).toThrow(
    /--file needs a value/,
  );
  expect(() => parseAgent(["queue", "stale", "--lnag", "pt-PT"])).toThrow(
    /unknown option --lnag/,
  );
  expect(parseAgent(["draft", "--json", "k", "pt-PT", "x"])).toEqual({
    tool: "save_draft",
    args: { key: "k", language: "pt-PT", text: "x" },
  });
  expect(() =>
    parseAgent(["draft", "k", "pt-PT", "Continuar", "--agora", "mesmo"]),
  ).toThrow(/unknown option --agora/);
  expect(parseAgent(["status", "--json"])).toEqual({
    tool: "status",
    args: {},
  });
});

test("the JSON goes to stdout with exit 0; a refusal goes to stderr with exit 1", async () => {
  api = await startApi((seen) =>
    seen.path === "/api/status"
      ? { status: 200, body: { project: "push-fixture", writableSources: [] } }
      : {
          status: 409,
          body: {
            error: "human-edited",
            message: "ui.continue in pt-PT holds a person's work",
          },
        },
  );
  const ok = ctx(api.url);
  expect(await run(["agent", "status"], ok.context)).toBe(0);
  expect(JSON.parse(ok.out.join("\n"))).toEqual({
    project: "push-fixture",
    writableSources: [],
  });
  expect(ok.err).toEqual([]);

  const refused = ctx(api.url);
  expect(
    await run(
      ["agent", "draft", "ui.continue", "pt-PT", "Continuar"],
      refused.context,
    ),
  ).toBe(1);
  expect(refused.out).toEqual([]);
  expect(refused.err).toEqual([
    "corpus: human-edited: ui.continue in pt-PT holds a person's work",
  ]);
  expect(api.seen.map((s) => [s.method, s.path, s.auth, s.body])).toEqual([
    ["GET", "/api/status", "Bearer tok-1", undefined],
    [
      "PUT",
      "/api/strings/ui.continue/translations/pt-PT",
      "Bearer tok-1",
      { text: "Continuar" },
    ],
  ]);
});

test("every subcommand reaches the API as its tool; a bad queue kind and an unreachable server exit 1", async () => {
  api = await startApi((seen) =>
    seen.path.startsWith("/api/queues")
      ? {
          status: 200,
          body: {
            project: "push-fixture",
            language: "pt-PT",
            type: null,
            queues: {
              untranslated: { count: 0, items: [] },
              stale: { count: 0, items: [] },
              unverifiedSource: { count: 0, items: [] },
              agentDrafts: { count: 0, items: [] },
            },
          },
        }
      : { status: 201, body: { ok: true, path: seen.path } },
  );
  const calls: string[][] = [
    ["queue", "stale", "--lang", "pt-PT"],
    ["string", "ui.continue"],
    ["propose", "ui.continue", "--text", "Prosseguir"],
    ["propose", "ui.continue", "--remove"],
    ["add", "ui.back", "--file", "i18n/{lang}.json", "--text", "Back"],
  ];
  for (const words of calls) {
    const { context, out, err } = ctx(api.url);
    expect(await run(["agent", ...words], context)).toBe(0);
    expect(err).toEqual([]);
    expect(out.length).toBeGreaterThan(0);
  }
  expect(api.seen.map((s) => [s.method, s.path])).toEqual([
    ["GET", "/api/queues?language=pt-PT"],
    ["GET", "/api/strings/ui.continue"],
    ["POST", "/api/strings/ui.continue/proposals"],
    ["POST", "/api/strings/ui.continue/proposals"],
    ["POST", "/api/proposals"],
  ]);

  const bad = ctx(api.url);
  expect(await run(["agent", "queue", "nonsense"], bad.context)).toBe(1);
  expect(bad.err.join("\n")).toMatch(/queue must be one of untranslated/);
  expect(api.seen).toHaveLength(5);

  api.server.close();
  const down = ctx("http://127.0.0.1:9");
  expect(await run(["agent", "status"], down.context)).toBe(1);
  expect(down.err.join("\n")).toMatch(/could not reach the server/);
});

test("corpus agent is in the usage and needs the token", async () => {
  const { context, out, err } = ctx("http://127.0.0.1:9");
  context.env = {};
  expect(await run(["--help"], context)).toBe(0);
  expect(out.join("\n")).toContain("corpus agent queue");
  expect(await run(["agent", "status"], context)).toBe(1);
  expect(err.join("\n")).toMatch(/CORPUS_TOKEN/);
});
