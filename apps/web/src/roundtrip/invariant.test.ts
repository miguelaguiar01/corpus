// The core invariant (§8, §15): push∘pull reproduces client repo files
// byte-identical. The real CLI drives the real push and pull handlers
// over HTTP against an in-memory database; nothing is mocked but the DB.
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, type RunContext } from "@corpus/cli";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { applyTransition } from "@/translations/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));
const push = await import("@/app/api/push/route");
const pull = await import("@/app/api/pull/route");

const FIXTURE = fileURLToPath(
  new URL(
    "../../../../packages/cli/test/fixtures/roundtrip-repo",
    import.meta.url,
  ),
);
const TMP = fileURLToPath(
  new URL("../../../../packages/cli/test/.tmp", import.meta.url),
);

function tree(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) Object.assign(out, tree(abs, base));
    else out[path.relative(base, abs)] = readFileSync(abs, "utf8");
  }
  return out;
}

// A tiny HTTP front for the route handlers, so the CLI's fetch is real.
function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const url = `http://corpus.test${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method === "POST" ? raw : undefined,
      });
      const response =
        req.method === "POST"
          ? await push.POST(request)
          : await pull.GET(request);
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

let server: Server | undefined;
let repo: string;
let token: string;
let projectId: number;
let output: string[];

beforeEach(async () => {
  mkdirSync(TMP, { recursive: true });
  repo = mkdtempSync(path.join(TMP, "roundtrip-"));
  cpSync(FIXTURE, repo, { recursive: true });
  const [ana] = db
    .insert(users)
    .values({ name: `ana-${Date.now()}`, maintainer: true })
    .returning()
    .all();
  const created = createProject(
    db,
    {
      slug: `roundtrip-${Date.now()}`,
      name: "Roundtrip",
      sourceLanguage: "pt-PT",
      languages: ["pt-PT", "en"],
    },
    ana!,
  );
  if (!created.ok) throw new Error(created.reason);
  token = created.token;
  projectId = created.project.id;
  // The CLI's config names the project by slug; point it at this one.
  const config = readFileSync(path.join(repo, "corpus.config.ts"), "utf8");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    path.join(repo, "corpus.config.ts"),
    config.replace(
      'project: "roundtrip"',
      `project: "${created.project.slug}"`,
    ),
  );
  const started = await serve();
  server = started.server;
  process.env.CORPUS_SERVER = started.url;
  output = [];
});
afterEach(() => {
  server?.close();
  delete process.env.CORPUS_SERVER;
  rmSync(repo, { recursive: true, force: true });
});

const ctx = (): RunContext => ({
  cwd: repo,
  env: { ...process.env, CORPUS_TOKEN: token },
  out: (s) => {
    output.push(s);
  },
  err: (s) => {
    output.push(s);
  },
});

test("push then pull at untranslated reproduces the repo byte for byte", async () => {
  const before = tree(repo);
  expect(await run(["push"], ctx())).toBe(0);
  expect(await run(["pull", "--min-state", "untranslated"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(before);
  expect(output.join("\n")).toContain("0 file(s) changed");
});

test("a translation saved in Corpus comes back in exactly the expected file and key", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  const greeting = stringDetail(db, projectId, "app.greeting")!;
  const [ana] = db.select().from(users).all();
  applyTransition(db, {
    stringId: greeting.string.id,
    language: "en",
    action: { type: "save", text: "Hello {name}" },
    actor: ana!,
  });
  expect(await run(["pull", "--min-state", "translated"], ctx())).toBe(0);
  const after = tree(repo);
  expect(Object.keys(after).sort()).toEqual(
    [...Object.keys(before), "i18n/en.json"].sort(),
  );
  expect(after["i18n/pt-PT.json"]).toBe(before["i18n/pt-PT.json"]);
  expect(after["data/steps.pt-PT.json"]).toBe(before["data/steps.pt-PT.json"]);
  expect(JSON.parse(after["i18n/en.json"]!)).toEqual({
    app: { greeting: "Hello {name}" },
  });
  expect(output.join("\n")).toContain("i18n/en.json");
});

test("a verified-only pull writes nothing when nothing is verified", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  expect(await run(["pull"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(before);
});
