import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";
import { apiOver, serve, tools } from "./mcp";

const REPO = fileURLToPath(
  new URL("../test/fixtures/push-repo", import.meta.url),
);

type Seen = { method: string; path: string; auth?: string; body: unknown };

// A stand-in for the API of §10: answers by path, records what it saw.
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

// The protocol's own client over a pair of streams, the way stdio
// carries it: one JSON message per line each way.
function streamTransport(
  fromServer: PassThrough,
  toServer: PassThrough,
): Transport {
  const transport: Transport = {
    async start() {
      const lines = createInterface({ input: fromServer });
      lines.on("line", (line) => {
        if (line.trim())
          transport.onmessage?.(JSON.parse(line) as JSONRPCMessage);
      });
      lines.on("close", () => transport.onclose?.());
    },
    async send(message) {
      toServer.write(`${JSON.stringify(message)}\n`);
    },
    async close() {
      toServer.end();
    },
  };
  return transport;
}

const STRING = {
  key: "ui.continue",
  source: "Continuar",
  translations: { en: { state: "untranslated", stale: false, text: null } },
};
const QUEUES = {
  project: "push-fixture",
  language: null,
  queues: {
    untranslated: { count: 1, items: [{ key: "ui.continue", language: "en" }] },
    stale: { count: 0, items: [] },
    unverifiedSource: { count: 0, items: [] },
    agentDrafts: { count: 0, items: [] },
  },
};

function answers(seen: Seen): { status: number; body: unknown } {
  if (seen.path.startsWith("/api/queues")) return { status: 200, body: QUEUES };
  if (seen.path === "/api/status")
    return { status: 200, body: { project: "push-fixture" } };
  if (seen.path === "/api/strings/ui.continue")
    return { status: 200, body: STRING };
  if (seen.path === "/api/strings/ui.continue/translations/en") {
    return {
      status: 200,
      body: {
        key: "ui.continue",
        language: "en",
        state: "translated",
        actor: "push-fixture agent",
      },
    };
  }
  if (seen.path === "/api/strings/skin.taken/translations/en") {
    return {
      status: 409,
      body: {
        error: "human-edited",
        message: "skin.taken in en holds a person's work",
      },
    };
  }
  if (
    seen.path === "/api/strings/ui.continue/proposals" ||
    seen.path === "/api/proposals"
  ) {
    return {
      status: 201,
      body: { id: 1, status: "pending", ...(seen.body as object) },
    };
  }
  return { status: 404, body: { error: "not-found", message: `no string` } };
}

let api: Awaited<ReturnType<typeof startApi>> | undefined;
afterEach(() => {
  api?.server.close();
  api = undefined;
});

async function connected() {
  api = await startApi(answers);
  const toServer = new PassThrough();
  const fromServer = new PassThrough();
  const served = serve(
    toServer,
    fromServer,
    apiOver(api.url, "tok-1"),
    "9.9.9",
  );
  const client = new Client({ name: "test", version: "0" });
  await client.connect(streamTransport(fromServer, toServer));
  return {
    client,
    seen: api.seen,
    done: async () => {
      await client.close();
      await served;
    },
  };
}

test("the client initialises, lists the seven tools and pings", async () => {
  const { client, done } = await connected();
  expect(client.getServerVersion()).toEqual({
    name: "corpus",
    version: "9.9.9",
  });
  const { tools: listed } = await client.listTools();
  expect(listed.map((t) => t.name)).toEqual([
    "list_queue",
    "get_string",
    "save_draft",
    "propose_change",
    "propose_removal",
    "add_string",
    "status",
  ]);
  for (const tool of listed) {
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema.type).toBe("object");
  }
  await expect(client.ping()).resolves.toEqual({});
  await done();
});

test("every tool is one API call with the token, and answers the server's body", async () => {
  const { client, seen, done } = await connected();
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });

  const queue = await call("list_queue", {
    queue: "untranslated",
    language: "en",
  });
  expect(queue.structuredContent).toEqual({
    queue: "untranslated",
    count: 1,
    items: [{ key: "ui.continue", language: "en" }],
  });
  const string = await call("get_string", { key: "ui.continue" });
  expect(string.structuredContent).toEqual(STRING);
  const draft = await call("save_draft", {
    key: "ui.continue",
    language: "en",
    text: "Continue",
  });
  expect(draft.isError).toBeFalsy();
  expect(draft.structuredContent).toMatchObject({
    actor: "push-fixture agent",
  });
  await call("propose_change", { key: "ui.continue", text: "Prosseguir" });
  await call("propose_removal", { key: "ui.continue" });
  await call("add_string", {
    key: "ui.back",
    file: "i18n/{lang}.json",
    text: "Back",
  });
  const status = await call("status");
  expect(status.structuredContent).toEqual({ project: "push-fixture" });

  expect(seen.map((s) => [s.method, s.path, s.body])).toEqual([
    ["GET", "/api/queues?language=en", undefined],
    ["GET", "/api/strings/ui.continue", undefined],
    ["PUT", "/api/strings/ui.continue/translations/en", { text: "Continue" }],
    [
      "POST",
      "/api/strings/ui.continue/proposals",
      { kind: "edit", text: "Prosseguir" },
    ],
    ["POST", "/api/strings/ui.continue/proposals", { kind: "delete" }],
    [
      "POST",
      "/api/proposals",
      { key: "ui.back", file: "i18n/{lang}.json", text: "Back" },
    ],
    ["GET", "/api/status", undefined],
  ]);
  expect(new Set(seen.map((s) => s.auth))).toEqual(new Set(["Bearer tok-1"]));
  await done();
});

test("a refusal is a tool error carrying the server's message; bad arguments and unknown tools are protocol errors", async () => {
  const { client, done } = await connected();
  const refused = await client.callTool({
    name: "save_draft",
    arguments: { key: "skin.taken", language: "en", text: "x" },
  });
  expect(refused.isError).toBe(true);
  expect(refused.content).toEqual([
    {
      type: "text",
      text: "human-edited: skin.taken in en holds a person's work",
    },
  ]);
  await expect(
    client.callTool({ name: "save_draft", arguments: { key: "ui.continue" } }),
  ).rejects.toThrow(/language is missing/);
  await expect(
    client.callTool({
      name: "get_string",
      arguments: { key: "ui.continue", extra: "x" },
    }),
  ).rejects.toThrow(/extra/);
  await expect(
    client.callTool({ name: "verify", arguments: {} }),
  ).rejects.toThrow(/unknown tool verify/);
  await done();
});

test("the tool table names every tool once and requires what the API needs", () => {
  const table = tools(async () => ({ content: [] }));
  expect(table.map((t) => [t.name, t.inputSchema.required ?? []])).toEqual([
    ["list_queue", ["queue"]],
    ["get_string", ["key"]],
    ["save_draft", ["key", "language", "text"]],
    ["propose_change", ["key", "text"]],
    ["propose_removal", ["key"]],
    ["add_string", ["key", "file", "text"]],
    ["status", []],
  ]);
});

test("corpus mcp is in the usage and needs the token", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: RunContext = {
    cwd: REPO,
    env: { CORPUS_SERVER: "http://127.0.0.1:9" },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  expect(await run(["--help"], ctx)).toBe(0);
  expect(out.join("\n")).toContain("corpus mcp");
  expect(await run(["mcp"], ctx)).toBe(1);
  expect(err.join("\n")).toMatch(/CORPUS_TOKEN/);
});
