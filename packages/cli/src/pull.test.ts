import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";

const FIXTURE = fileURLToPath(
  new URL("../test/fixtures/pull-repo", import.meta.url),
);
const TMP = fileURLToPath(new URL("../test/.tmp", import.meta.url));

const PAYLOAD = {
  contract: "corpus/1",
  project: "pull-fixture",
  sourceLanguage: "en",
  minState: "verified",
  types: { "app.title": "chrome", greeting: "chrome", "exec.bye": "computed" },
  translations: {
    en: {
      "app.title": "Corpus",
      greeting: "Hello {name}",
      "exec.bye": "Bye {who}",
    },
    pt: {
      "app.title": "Corpus",
      greeting: "Olá {name}",
      "exec.bye": "Adeus {who}",
    },
  },
};

type Captured = { url: string; auth: string | undefined };

function startServer(
  respond: (captured: Captured) => { status: number; json: unknown },
): Promise<{ server: Server; url: string; calls: Captured[] }> {
  const calls: Captured[] = [];
  const server = createServer((req, res) => {
    const captured = { url: req.url ?? "", auth: req.headers.authorization };
    calls.push(captured);
    const { status, json } = respond(captured);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
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
let repo: string;
beforeEach(() => {
  // Inside the repo tree so the config's `@corpus/contract` import resolves.
  mkdirSync(TMP, { recursive: true });
  repo = mkdtempSync(path.join(TMP, "pull-"));
  cpSync(FIXTURE, repo, { recursive: true });
});
afterEach(() => {
  active?.close();
  active = undefined;
  delete process.env.CORPUS_SERVER;
  rmSync(repo, { recursive: true, force: true });
});

function ctx(): RunContext & { output: string[] } {
  const output: string[] = [];
  return {
    cwd: repo,
    env: { CORPUS_TOKEN: "good" },
    out: (s) => output.push(s),
    err: (s) => output.push(s),
    output,
  };
}

async function serve(status = 200, json: unknown = PAYLOAD) {
  const started = await startServer(() => ({ status, json }));
  active = started.server;
  process.env.CORPUS_SERVER = started.url;
  return started;
}

const read = (rel: string) => readFileSync(path.join(repo, rel), "utf8");

test("pull fetches at verified by default with the bearer token and writes the target catalog", async () => {
  const { calls } = await serve();
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(calls[0]?.url).toBe("/api/pull?minState=verified");
  expect(calls[0]?.auth).toBe("Bearer good");
  expect(read("i18n/pt.json")).toBe(
    `{\n  "app.title": "Corpus",\n  "greeting": "Olá {name}"\n}\n`,
  );
});

test("the source-language file is untouched and not reported when nothing changed", async () => {
  await serve();
  const before = read("i18n/en.json");
  const c = ctx();
  await run(["pull"], c);
  expect(read("i18n/en.json")).toBe(before);
  const out = c.output.join("\n");
  expect(out).toContain("i18n/pt.json");
  expect(out).not.toContain("i18n/en.json");
});

test("--min-state is passed through", async () => {
  const { calls } = await serve(200, { ...PAYLOAD, minState: "translated" });
  await run(["pull", "--min-state", "translated"], ctx());
  expect(calls[0]?.url).toBe("/api/pull?minState=translated");
});

test("an existing target file keeps keys the payload does not mention", async () => {
  await serve(200, {
    ...PAYLOAD,
    translations: {
      en: PAYLOAD.translations.en,
      pt: { greeting: "Olá {name}" },
    },
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "i18n/pt.json"),
    `{\n  "app.title": "Corpo"\n}\n`,
  );
  await run(["pull"], ctx());
  expect(JSON.parse(read("i18n/pt.json"))).toEqual({
    "app.title": "Corpo",
    greeting: "Olá {name}",
  });
});

test("exec sources receive the entries the file adapters did not claim, on stdin", async () => {
  await serve();
  await run(["pull"], ctx());
  const imported = JSON.parse(read("imported.json")) as {
    sourceLanguage: string;
    translations: Record<string, Record<string, string>>;
  };
  expect(imported.sourceLanguage).toBe("en");
  expect(imported.translations.pt).toEqual({ "exec.bye": "Adeus {who}" });
  expect(imported.translations.en).toEqual({ "exec.bye": "Bye {who}" });
});

test("a 401 prints an actionable message", async () => {
  await serve(401, { error: "unauthorized" });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/CORPUS_TOKEN/);
  expect(existsSync(path.join(repo, "i18n/pt.json"))).toBe(false);
});

test("a payload that does not match the contract is refused before any write", async () => {
  await serve(200, { contract: "corpus/2" });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/contract/i);
  expect(existsSync(path.join(repo, "i18n/pt.json"))).toBe(false);
});

test("the server being unreachable is a clean error", async () => {
  process.env.CORPUS_SERVER = "http://127.0.0.1:1";
  const c = ctx();
  expect(await run(["pull"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/could not reach the server/);
});

test("a table source with {lang} is written per language, one record per line", async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(path.join(repo, "data"), { recursive: true });
  writeFileSync(
    path.join(repo, "data/steps.en.json"),
    `[\n  { "id": "step.1", "text": "Open the door.", "kind": "hint" }\n]\n`,
  );
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      "sources: [",
      'sources: [\n    { adapter: "table", type: "step", path: "data/steps.{lang}.json", map: { id: "id", text: "text" } },',
    ),
  );
  await serve(200, {
    ...PAYLOAD,
    types: { ...PAYLOAD.types, "step.1": "step" },
    translations: {
      en: { ...PAYLOAD.translations.en, "step.1": "Open the door." },
      pt: { ...PAYLOAD.translations.pt, "step.1": "Abre a porta." },
    },
  });
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(read("data/steps.pt.json")).toBe(
    `[\n  { "id": "step.1", "text": "Abre a porta.", "kind": "hint" }\n]\n`,
  );
  expect(c.output.join("\n")).toContain("data/steps.pt.json");
});

test("an invalid --min-state is refused before any request", async () => {
  const { calls } = await serve();
  const c = ctx();
  expect(await run(["pull", "--min-state", "done"], c)).toBe(1);
  expect(c.output.join("\n")).toMatch(/--min-state must be one of/);
  expect(calls).toHaveLength(0);
});

test("translations no writable source can take are reported, not dropped silently", async () => {
  await serve(200, {
    ...PAYLOAD,
    types: { ...PAYLOAD.types, "orphan.x": "nowhere" },
    translations: {
      ...PAYLOAD.translations,
      pt: { ...PAYLOAD.translations.pt, "orphan.x": "?" },
    },
  });
  const { writeFileSync } = await import("node:fs");
  // Drop the exec importer so nothing can claim the orphan.
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    read("corpus.config.ts").replace(
      /,\s*importCommand: "node scripts\/import.mjs"/,
      "",
    ),
  );
  const c = ctx();
  expect(await run(["pull"], c)).toBe(0);
  expect(c.output.join("\n")).toMatch(
    /2 translation\(s\) belong to no writable source/,
  );
});
