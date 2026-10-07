import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
});

// An instance that answers health, and status for the one token it takes.
async function instance(token = "good"): Promise<string> {
  const server: Server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/health") {
      res.end(JSON.stringify({ status: "ok", version: "v9.9.9" }));
    } else if (req.url === "/api/status") {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: "unauthorized", message: "no" }));
      } else
        res.end(JSON.stringify({ project: "alibi", languages: ["pt-PT"] }));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => server.close());
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

function dir(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

// Álibi's setup: the repository with the token, a stale secret and the
// database; a runner directory that started the workbench with its own.
function alibi(url: string, pid = process.pid) {
  const repo = dir("corpus-whoami-repo-");
  const runner = dir("corpus-whoami-runner-");
  writeFileSync(
    path.join(repo, "corpus.config.mjs"),
    `export default { project: "alibi", server: "${url}", sourceLanguage: "pt-PT", languages: ["pt-PT"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }] };\n`,
  );
  mkdirSync(path.join(repo, ".corpus"));
  mkdirSync(path.join(runner, ".corpus"));
  writeFileSync(path.join(repo, ".corpus", "token"), "good\n");
  writeFileSync(path.join(repo, ".corpus", "secret"), "stale-secret\n");
  writeFileSync(path.join(runner, ".corpus", "secret"), "live-secret\n");
  writeFileSync(
    path.join(repo, ".corpus", "workbench.json"),
    JSON.stringify({
      url,
      pid,
      secretPath: path.join(runner, ".corpus", "secret"),
      version: "9.9.9",
      startedAt: "2026-10-07T10:00:00.000Z",
      db: path.join(repo, ".corpus", "corpus.db"),
    }),
  );
  return { repo, runner };
}

function ctx(cwd: string, env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const context: RunContext = {
    cwd,
    env,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { context, out, err };
}

test("whoami names the server, its version, the project, the token and the secret the running workbench reads, the repository's stale one said (#1078)", async () => {
  const url = await instance();
  const { repo, runner } = alibi(url);
  const c = ctx(repo);
  expect(await run(["whoami"], c.context)).toBe(0);
  const said = c.out.join("\n");
  expect(said).toContain(`server     ${url} (Corpus v9.9.9)`);
  expect(said).toContain("project    alibi");
  expect(said).toContain("token      .corpus/token, accepted");
  expect(said).toContain(
    `workbench  running (pid ${process.pid}), reads its secret from ${path.join(runner, ".corpus", "secret")}`,
  );
  expect(said).toContain(
    ".corpus/secret is stale: the running workbench reads another",
  );
  expect(said).not.toContain("live-secret");
  // The secret only when asked, the running workbench's.
  const shown = ctx(repo);
  expect(await run(["creds", "--show-secret"], shown.context)).toBe(0);
  expect(shown.out.join("\n")).toContain("secret     live-secret");
  // All of it as one object.
  const json = ctx(repo);
  expect(await run(["whoami", "--json"], json.context)).toBe(0);
  expect(JSON.parse(json.out.join("\n"))).toMatchObject({
    server: url,
    version: "v9.9.9",
    project: "alibi",
    token: { from: ".corpus/token", accepted: true },
    workbench: {
      running: true,
      pid: process.pid,
      secretPath: path.join(runner, ".corpus", "secret"),
    },
    staleSecret: path.join(repo, ".corpus", "secret"),
  });
});

test("whoami without a local workbench says the server, the project and the token; a stopped one's record is stale; a refused token exits 1 (#1078)", async () => {
  const url = await instance();
  const { repo } = alibi(url, 2 ** 22 + 12345);
  const stopped = ctx(repo);
  expect(await run(["whoami"], stopped.context)).toBe(0);
  expect(stopped.out.join("\n")).toContain(
    `workbench  .corpus/workbench.json is stale: pid ${2 ** 22 + 12345} is not running`,
  );
  rmSync(path.join(repo, ".corpus", "workbench.json"));
  const bare = ctx(repo);
  expect(await run(["whoami"], bare.context)).toBe(0);
  const said = bare.out.join("\n");
  expect(said).toContain(`server     ${url} (Corpus v9.9.9)`);
  expect(said).toContain("token      .corpus/token, accepted");
  expect(said).not.toMatch(/stale/);
  const env = ctx(repo, { CORPUS_TOKEN: "wrong" });
  expect(await run(["whoami"], env.context)).toBe(1);
  expect(env.out.join("\n")).toContain("token      CORPUS_TOKEN, refused");
  // --server asks another instance.
  const other = await instance("other");
  const elsewhere = ctx(repo, { CORPUS_TOKEN: "other" });
  expect(await run(["whoami", "--server", other], elsewhere.context)).toBe(0);
  expect(elsewhere.out.join("\n")).toContain(
    `server     ${other} (Corpus v9.9.9)`,
  );
});

test("whoami names the workbench's own url, and keeps its secret apart from another server it is asked about (#1078 review)", async () => {
  const asked = await instance();
  const local = await instance();
  const { repo } = alibi(asked);
  // The workbench recorded here runs on another port than the config's.
  const record = path.join(repo, ".corpus", "workbench.json");
  const written = JSON.parse(readFileSync(record, "utf8")) as Record<
    string,
    unknown
  >;
  writeFileSync(record, JSON.stringify({ ...written, url: local }));
  const c = ctx(repo);
  expect(await run(["whoami", "--show-secret"], c.context)).toBe(0);
  const said = c.out.join("\n");
  expect(said).toContain(`workbench  running at ${local} (pid ${process.pid})`);
  expect(said).toContain(`not ${asked}, the server asked`);
  expect(said).not.toContain("live-secret");
  expect(said).toContain(
    `secret     not shown: the workbench recorded here is at ${local}`,
  );
  // Asked about it, its secret is shown.
  const there = ctx(repo);
  expect(
    await run(["whoami", "--server", local, "--show-secret"], there.context),
  ).toBe(0);
  expect(there.out.join("\n")).toContain("secret     live-secret");
});

test("whoami trusts a record only as a workbench's: a malformed one, or one that names another file or a pid nobody answers for, shows no secret (#1078 review)", async () => {
  const url = await instance();
  const { repo } = alibi(url);
  const record = path.join(repo, ".corpus", "workbench.json");
  for (const bad of [
    { url, pid: process.pid, version: "1", startedAt: "x", db: "d" },
    {
      url,
      pid: 1,
      secretPath: "/etc/hostname",
      version: "1",
      startedAt: "x",
      db: "d",
    },
    {
      url,
      pid: 0,
      secretPath: path.join(repo, ".corpus", "secret"),
      version: "1",
      startedAt: "x",
      db: "d",
    },
  ]) {
    writeFileSync(record, JSON.stringify(bad));
    const c = ctx(repo);
    await run(["whoami", "--show-secret"], c.context);
    const said = c.out.join("\n");
    expect(said, JSON.stringify(bad)).not.toMatch(/running/);
    expect(said, JSON.stringify(bad)).not.toContain("stale-secret");
    expect(said, JSON.stringify(bad)).toContain(
      ".corpus/workbench.json is no workbench's record",
    );
  }
  // A pid alive that no workbench answers for at the url is stale too.
  const dead = "http://127.0.0.1:9";
  writeFileSync(
    record,
    JSON.stringify({
      url: dead,
      pid: process.pid,
      secretPath: path.join(repo, ".corpus", "secret"),
      version: "1",
      startedAt: "x",
      db: "d",
    }),
  );
  const c = ctx(repo);
  await run(["whoami"], c.context);
  expect(c.out.join("\n")).toContain(
    `workbench  .corpus/workbench.json is stale: nothing answers at ${dead}`,
  );
});

test("whoami says a token taken for another project, and a server that answers but not as Corpus, and exits 1 for both (#1078 review)", async () => {
  const url = await instance();
  const { repo } = alibi(url);
  writeFileSync(
    path.join(repo, "corpus.config.mjs"),
    `export default { project: "other", server: "${url}", sourceLanguage: "pt-PT", languages: ["pt-PT"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }] };\n`,
  );
  const c = ctx(repo);
  expect(await run(["whoami"], c.context)).toBe(1);
  expect(c.out.join("\n")).toContain(
    "token      .corpus/token, accepted, but for the project alibi, not other",
  );
  const odd: Server = createServer((_req, res) => {
    res.end("<html>hello</html>");
  });
  await new Promise<void>((resolve) => odd.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => odd.close());
  const address = odd.address();
  const other = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const o = ctx(repo);
  expect(await run(["whoami", "--server", other], o.context)).toBe(1);
  expect(o.out.join("\n")).toContain(
    `server     ${other} (answers, but not as Corpus)`,
  );
});
