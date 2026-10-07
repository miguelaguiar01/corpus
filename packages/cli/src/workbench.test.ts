import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { cliVersion } from "./mcp";
import { prepare, serverNote } from "./workbench";
import { CORPUS_DIR } from "./corpus-dir";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repo(withPackage = true): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-workbench-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "package.json"), '{ "name": "client" }\n');
  if (withPackage) {
    const pkg = path.join(dir, "node_modules/@corpus-tool/workbench");
    mkdirSync(path.join(pkg, "bin"), { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        name: "@corpus-tool/workbench",
        version: "9.9.9",
        bin: { "corpus-workbench": "bin/corpus-workbench.cjs" },
      }),
    );
    writeFileSync(path.join(pkg, "bin/corpus-workbench.cjs"), "");
  }
  return dir;
}

test("without the package in the repository it is found beside the CLI, and named when it is nowhere (#561)", () => {
  // This checkout has the workbench beside the CLI, which is the npx
  // shape: both packages in one prefix, none in the repository.
  expect(prepare(repo(false)).bin).toMatch(/corpus-workbench\.cjs$/);
  expect(() => prepare(repo(false), { besideCli: false })).toThrow(
    /@corpus-tool\/workbench is not installed in this repository nor beside the CLI; add it with: npm install --save-dev @corpus-tool\/workbench/,
  );
});

test("the bin, the database and a generated secret, kept out of git", () => {
  const dir = repo();
  writeFileSync(path.join(dir, ".gitignore"), "node_modules\n");
  const first = prepare(dir);
  expect(first.bin).toBe(
    path.join(
      dir,
      "node_modules/@corpus-tool/workbench/bin/corpus-workbench.cjs",
    ),
  );
  expect(first.version).toBe("9.9.9");
  expect(first.dbPath).toBe(path.join(dir, CORPUS_DIR, "corpus.db"));
  expect(first.secret).toMatch(/^[0-9a-f]{48}$/);
  expect(statSync(path.join(dir, CORPUS_DIR, "secret")).mode & 0o777).toBe(
    0o600,
  );
  expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(
    "node_modules\n.corpus/\n",
  );
  // The stub is 9.9.9 and the CLI is not, which is the note's case.
  const apart = `the workbench is 9.9.9 and the CLI ${cliVersion()}; the two packages share a version, so update the one behind`;
  expect(first.notes).toEqual([
    apart,
    "wrote a new instance secret to .corpus/secret",
    "added .corpus/ to .gitignore",
  ]);
  // The second start reuses the secret and says nothing more.
  const second = prepare(dir);
  expect(second.secret).toBe(first.secret);
  expect(second.notes).toEqual([apart]);
});

test("--db picks the database path; no .gitignore means one is created with the line", () => {
  const dir = repo();
  const prepared = prepare(dir, { db: "data/local.db" });
  expect(prepared.dbPath).toBe(path.join(dir, "data/local.db"));
  expect(prepared.notes).toContain("created .gitignore with .corpus/");
  expect(readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe(".corpus/\n");
  // A second start finds the line and says nothing.
  expect(
    prepare(dir, { db: "data/local.db" }).notes.filter(
      (n) => !n.startsWith("the workbench is"),
    ),
  ).toEqual([]);
});

test("a config whose server is another port is named beside the URL (#559)", async () => {
  const dir = repo();
  expect(await serverNote(dir, "http://localhost:4100")).toBeUndefined();
  writeFileSync(
    path.join(dir, "corpus.config.mjs"),
    `export default { project: "p", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "ui", path: "i18n/{lang}.json" }] };\n`,
  );
  expect(await serverNote(dir, "http://localhost:4100")).toBe(
    "config    server is http://localhost:3000; push goes there. Edit corpus.config.mjs to point it here",
  );
  expect(await serverNote(dir, "http://localhost:3000/")).toBeUndefined();
});

test("a running workbench says where it runs beside its database, and forgets it when it stops (#1078)", async () => {
  const runner = repo();
  // The fake bin is a server that answers health until it is stopped.
  writeFileSync(
    path.join(
      runner,
      "node_modules/@corpus-tool/workbench/bin/corpus-workbench.cjs",
    ),
    `require("node:http").createServer((q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"status":"ok"}'); }).listen(Number(process.env.PORT), "127.0.0.1");\n`,
  );
  const elsewhere = mkdtempSync(path.join(os.tmpdir(), "corpus-db-"));
  dirs.push(elsewhere);
  const db = path.join(elsewhere, CORPUS_DIR, "corpus.db");
  const port = 47_000 + Math.floor(Math.random() * 2000);
  const { run } = await import("./cli");
  const out: string[] = [];
  const running = run(
    ["workbench", "--port", String(port), "--db", db, "--no-provision"],
    {
      cwd: runner,
      env: { ...process.env },
      out: (l) => out.push(l),
      err: (l) => out.push(l),
    },
  );
  const file = path.join(elsewhere, CORPUS_DIR, "workbench.json");
  const deadline = Date.now() + 15_000;
  while (!existsSync(file) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
  const recorded = JSON.parse(readFileSync(file, "utf8")) as {
    url: string;
    pid: number;
    secretPath: string;
    version: string;
    startedAt: string;
    db: string;
  };
  expect(recorded).toMatchObject({
    url: `http://localhost:${port}`,
    secretPath: path.join(runner, CORPUS_DIR, "secret"),
    version: "9.9.9",
    db,
  });
  expect(Number.isInteger(recorded.pid)).toBe(true);
  expect(Number.isNaN(Date.parse(recorded.startedAt))).toBe(false);
  process.kill(recorded.pid, "SIGTERM");
  expect(await running).toBe(0);
  expect(existsSync(file)).toBe(false);
}, 30_000);

// The fake workbench: a server that answers health until stopped.
function fakeServer(dir: string) {
  writeFileSync(
    path.join(
      dir,
      "node_modules/@corpus-tool/workbench/bin/corpus-workbench.cjs",
    ),
    `require("node:http").createServer((q, r) => { r.writeHead(200, { "content-type": "application/json" }); r.end('{"status":"ok"}'); }).listen(Number(process.env.PORT), "127.0.0.1");\n`,
  );
}

async function until(test: () => boolean, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (!test() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
}

test("a record that cannot be written is a note, and the workbench runs on and stops with the command (#1078 review)", async () => {
  const runner = repo();
  fakeServer(runner);
  const ro = mkdtempSync(path.join(os.tmpdir(), "corpus-ro-"));
  dirs.push(ro);
  mkdirSync(path.join(ro, CORPUS_DIR));
  const db = path.join(ro, CORPUS_DIR, "corpus.db");
  chmodSync(path.join(ro, CORPUS_DIR), 0o555);
  const port = 49_100 + Math.floor(Math.random() * 500);
  const { run } = await import("./cli");
  const out: string[] = [];
  const running = run(
    ["workbench", "--port", String(port), "--db", db, "--no-provision"],
    {
      cwd: runner,
      env: { ...process.env },
      out: (l) => out.push(l),
      err: (l) => out.push(l),
    },
  );
  await until(() => out.some((l) => l.includes("stop      Ctrl-C")));
  chmodSync(path.join(ro, CORPUS_DIR), 0o755);
  expect(out.join("\n")).toMatch(
    /corpus: could not record this workbench beside its database .*workbench\.json/,
  );
  // The command still owns its child: a SIGTERM to it stops the server.
  process.emit("SIGTERM");
  expect(await running).toBe(0);
}, 30_000);

test("a workbench that stops leaves the record of another that took its database (#1078 review)", async () => {
  const runner = repo();
  fakeServer(runner);
  const shared = mkdtempSync(path.join(os.tmpdir(), "corpus-shared-"));
  dirs.push(shared);
  const db = path.join(shared, CORPUS_DIR, "corpus.db");
  const file = path.join(shared, CORPUS_DIR, "workbench.json");
  const { run } = await import("./cli");
  const start = (port: number) =>
    run(["workbench", "--port", String(port), "--db", db, "--no-provision"], {
      cwd: runner,
      env: { ...process.env },
      out: () => {},
      err: () => {},
    });
  const base = 49_700 + Math.floor(Math.random() * 200);
  const a = start(base);
  await until(() => existsSync(file));
  const first = JSON.parse(readFileSync(file, "utf8")) as { pid: number };
  const b = start(base + 1);
  await until(
    () =>
      existsSync(file) &&
      (JSON.parse(readFileSync(file, "utf8")) as { pid: number }).pid !==
        first.pid,
  );
  const second = JSON.parse(readFileSync(file, "utf8")) as { pid: number };
  process.kill(first.pid, "SIGTERM");
  expect(await a).toBe(0);
  expect((JSON.parse(readFileSync(file, "utf8")) as { pid: number }).pid).toBe(
    second.pid,
  );
  process.kill(second.pid, "SIGTERM");
  expect(await b).toBe(0);
  expect(existsSync(file)).toBe(false);
}, 40_000);
