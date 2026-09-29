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
import { run, type RunContext } from "@corpus-tool/cli";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { memoryDb } from "@/db/test-helpers";
import { createProject } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { applyTransition } from "@/translations/service";
import { proposeAdd, proposeDelete, proposeEdit } from "@/proposals/service";

const db = memoryDb();
vi.mock("@/db", async (importActual) => ({
  ...(await importActual<typeof import("@/db")>()),
  getDb: () => db,
}));
const push = await import("@/app/api/push/route");
const pull = await import("@/app/api/pull/route");
const health = await import("@/app/api/health/route");

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
          : req.url === "/api/health"
            ? health.GET()
            : await pull.GET(request);
      // The body goes through as bytes with its encoding: a pull over
      // the gzip threshold is inflated by the CLI's fetch, not here (#602).
      const encoding = response.headers.get("content-encoding");
      res.writeHead(response.status, {
        "content-type": "application/json",
        ...(encoding ? { "content-encoding": encoding } : {}),
      });
      res.end(Buffer.from(await response.arrayBuffer()));
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

// The target catalogues in the fixture hold translations already; when
// Corpus holds the same text, pull rewrites them and must land on the
// same bytes, for both adapters.
function translate(id: string, text: string) {
  const detail = stringDetail(db, projectId, id)!;
  const [ana] = db.select().from(users).all();
  applyTransition(db, {
    stringId: detail.string.id,
    language: "en",
    action: { type: "save", text },
    actor: ana!,
  });
}

test("translations that match the repository's target catalogues write the same bytes", async () => {
  const before = tree(repo);
  expect(await run(["push"], ctx())).toBe(0);
  translate("app.title", "Corpus");
  translate("app.greeting", "Hello {name}");
  translate("step.open", "Open the door.");
  translate("step.key", "Find the key {where}.");
  translate("page.signIn", "Sign in with <LINK>Google</LINK>");
  translate("Abrir o menu", "Open the menu");
  translate("Cancelar", "Cancel");
  translate("Janela | Transferências (%1)", "Transfers (%1)");
  translate("rails.close", "Close");
  translate("rails.greeting", "Hello %{name}");
  translate(
    "rails.items",
    "{count, plural, one {%{count} item} other {%{count} items}}",
  );
  translate(
    "Janela | %n ficheiro(s)",
    "{count, plural, one {%n file} other {%n files}}",
  );
  translate(
    "ios.photos %lld",
    "{count, plural, one {%lld photo} other {%lld photos}}",
  );
  translate("%d ficheiro", "{count, plural, one {%d file} other {%d files}}");
  expect(await run(["pull", "--min-state", "translated"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(before);
  expect(output.join("\n")).toContain("0 file(s) changed");
});

test("a translation saved in Corpus comes back in exactly the expected file and key, and the source files are never written", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  translate("app.greeting", "Hi {name}");
  translate("step.key", "Look for the key {where}.");
  // A key segment with dots stays one segment (#642).
  translate("evento.m.sala.topico.removido", "The topic was removed.");
  translate("page.later", "Later");
  translate("porta\u2404Fechar", "Close the door");
  translate("ios.welcome", "Welcome");
  translate("Janela | Sair | menu", "Exit");
  translate("rails.close", "Shut");
  translate(
    "rails.footer_MF",
    "You have {n, plural, one {# warning} other {# warnings}}.\n",
  );
  expect(await run(["pull", "--min-state", "translated"], ctx())).toBe(0);
  const after = tree(repo);
  // XLIFF: the one target changed, its state with it; the source file stays.
  expect(after["locale/messages.xlf"]).toBe(before["locale/messages.xlf"]);
  expect(after["locale/messages.en.xlf"]).toBe(
    before["locale/messages.en.xlf"]!.replace(
      '<target state="new">Mais tarde</target>',
      '<target state="translated">Later</target>',
    ),
  );
  // gettext: the msgstr rewritten, its fuzzy flag and previous msgid gone.
  expect(after["po/messages.pot"]).toBe(before["po/messages.pot"]);
  expect(after["po/en.po"]).toBe(
    before["po/en.po"]!.replace(
      '#, fuzzy\n#| msgid "Fecha"\nmsgctxt "porta"\nmsgid "Fechar"\nmsgstr "Close"',
      'msgctxt "porta"\nmsgid "Fechar"\nmsgstr "Close the door"',
    ),
  );
  // String Catalog: the one unit rewritten, translated; nothing else.
  expect(after["ios/Localizable.xcstrings"]).toBe(
    before["ios/Localizable.xcstrings"]!.replace(
      '"state" : "needs_review",\n            "value" : "Welcom"',
      '"state" : "translated",\n            "value" : "Welcome"',
    ),
  );
  // Rails YAML: the plain scalar changed in place, the missing _MF key
  // inserted after its neighbour; the source untouched.
  expect(after["config/app.pt-PT.yml"]).toBe(before["config/app.pt-PT.yml"]);
  expect(after["config/app.en.yml"]).toBe(
    before["config/app.en.yml"]!.replace("close: Close", "close: Shut") +
      '    footer_MF: "You have {n, plural, one {# warning} other {# warnings}}.\\n"\n',
  );
  // Qt: the unfinished row spliced, its mark gone; the source untouched.
  expect(after["qt/app_pt-PT.ts"]).toBe(before["qt/app_pt-PT.ts"]);
  expect(after["qt/app_en.ts"]).toBe(
    before["qt/app_en.ts"]!.replace(
      '<translation type="unfinished">Exti</translation>',
      "<translation>Exit</translation>",
    ),
  );
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  expect(after["i18n/pt-PT.json"]).toBe(before["i18n/pt-PT.json"]);
  expect(after["data/steps.pt-PT.json"]).toBe(before["data/steps.pt-PT.json"]);
  expect(JSON.parse(after["i18n/en.json"]!)).toEqual({
    app: { title: "Corpus", greeting: "Hi {name}" },
    evento: { "m.sala.topico": { removido: "The topic was removed." } },
  });
  expect(JSON.parse(after["data/steps.en.json"]!)).toEqual([
    { id: "step.open", text: "Open the door.", kind: "hint" },
    { id: "step.key", text: "Look for the key {where}.", kind: "task" },
  ]);
  expect(output.join("\n")).toContain("i18n/en.json");
  expect(output.join("\n")).toContain("data/steps.en.json");
});

test("a verified-only pull writes nothing when nothing is verified", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  expect(await run(["pull"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(before);
});

test("a pending proposal comes back in exactly its source's files, at its key; nothing else moves", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  const [ana] = db.select().from(users).all();
  const greeting = stringDetail(db, projectId, "app.greeting")!;
  proposeEdit(db, {
    stringRowId: greeting.string.id,
    text: "Bem-vindo, {name}",
    actor: ana!,
  });
  proposeAdd(db, {
    projectId,
    key: "step.close",
    sourcePath: "data/steps.{lang}.json",
    text: "Fecha a porta.",
    actor: ana!,
  });
  const open = stringDetail(db, projectId, "step.open")!;
  proposeDelete(db, { stringRowId: open.string.id, actor: ana! });
  const nav = stringDetail(db, projectId, "nav.catalogue")!;
  proposeDelete(db, { stringRowId: nav.string.id, actor: ana! });
  expect(await run(["pull"], ctx())).toBe(0);
  const after = tree(repo);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  expect(JSON.parse(after["i18n/pt-PT.json"]!)).toEqual({
    app: { title: "Corpus", greeting: "Bem-vindo, {name}" },
    evento: { "m.sala.topico": { removido: "O tópico foi removido." } },
  });
  // The nested removal reached the target file; nothing else in it moved.
  const enBefore = JSON.parse(before["i18n/en.json"]!) as Record<
    string,
    unknown
  >;
  delete enBefore.nav;
  expect(JSON.parse(after["i18n/en.json"]!)).toEqual(enBefore);
  // Pulling again before the merge is pushed changes nothing more.
  expect(await run(["pull"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(after);
  expect(await run(["pull", "--check"], ctx())).toBe(0);
  expect(JSON.parse(after["data/steps.pt-PT.json"]!)).toEqual([
    { id: "step.key", text: "Procura a chave {where}.", kind: "task" },
    { id: "step.close", text: "Fecha a porta." },
  ]);
  // The removal left the target file too; the edit and the add did not touch it.
  expect(
    JSON.parse(after["data/steps.en.json"]!).map((r: { id: string }) => r.id),
  ).toEqual(["step.key"]);
  // Pushing the repository as it now is lands the proposals.
  expect(await run(["push"], ctx())).toBe(0);
  expect(await run(["pull", "--check"], ctx())).toBe(0);
});

test("a proposal on a Rails catalogue lands in its source file and, for a removal, its targets; nothing else moves (#757)", async () => {
  expect(await run(["push"], ctx())).toBe(0);
  const before = tree(repo);
  const [ana] = db.select().from(users).all();
  const close = stringDetail(db, projectId, "rails.close")!;
  expect(
    proposeEdit(db, {
      stringRowId: close.string.id,
      text: "Fechar já",
      actor: ana!,
    }).ok,
  ).toBe(true);
  expect(
    proposeAdd(db, {
      projectId,
      key: "rails.open",
      sourcePath: "config/app.{lang}.yml",
      text: "Abrir",
      actor: ana!,
    }).ok,
  ).toBe(true);
  const greeting = stringDetail(db, projectId, "rails.greeting")!;
  expect(
    proposeDelete(db, { stringRowId: greeting.string.id, actor: ana! }).ok,
  ).toBe(true);
  expect(await run(["pull"], ctx())).toBe(0);
  const after = tree(repo);
  expect(after["config/app.pt-PT.yml"]).toBe(
    before["config/app.pt-PT.yml"]!.replace(
      'close: "Fechar"',
      'close: "Fechar já"',
    )
      .replace("    greeting: 'Olá %{name}'\n", "")
      .replace(
        "      Tem {n, plural, one {# aviso} other {# avisos}}.\n",
        '      Tem {n, plural, one {# aviso} other {# avisos}}.\n    open: "Abrir"\n',
      ),
  );
  expect(after["config/app.en.yml"]).toBe(
    before["config/app.en.yml"]!.replace("    greeting: 'Hello %{name}'\n", ""),
  );
  expect(await run(["pull"], ctx())).toBe(0);
  expect(tree(repo)).toEqual(after);
});
