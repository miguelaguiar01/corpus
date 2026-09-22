// The wiki shows what the CLI does, so the CLI is what writes it. The
// configs and the command output under docs/wiki/recorded/ are recorded
// from a real run in a temporary repository, and this test fails when
// the recording and the CLI disagree. `bin/wiki-record` rewrites them.
//
// It covers the commands that need no server. Output that needs a
// running instance is prose on the page, and bin/wiki-check says which
// pages are prose so nobody assumes otherwise.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { corpusConfigSchema } from "@corpus/contract";
import { createJiti } from "jiti";
import { afterEach, expect, test } from "vitest";
import { apiOver, tools } from "./agent-tools";
import { run, type RunContext } from "./cli";

const examples = fileURLToPath(
  new URL("../../../docs/wiki/examples", import.meta.url),
);
const recordings = fileURLToPath(
  new URL("../../../docs/wiki/recorded", import.meta.url),
);
const recording = process.env.WIKI_RECORD === "1";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function repo(): { dir: string; ctx: RunContext; out: string[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-wiki-"));
  dirs.push(dir);
  const out: string[] = [];
  // The written config imports the CLI package; a stub in the repo's
  // own node_modules lets the loader find it here.
  const pkg = path.join(dir, "node_modules", "@corpus-tool", "cli");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@corpus-tool/cli",
      type: "module",
      exports: "./index.js",
    }),
  );
  writeFileSync(
    path.join(pkg, "index.js"),
    "export const defineCorpus = (c) => c;\n",
  );
  return {
    dir,
    out,
    ctx: {
      cwd: dir,
      env: {},
      out: (line) => out.push(line),
      err: (line) => out.push(line),
    },
  };
}

// What a recorded file should hold, against what it holds today.
function recorded(name: string, text: string): void {
  const file = path.join(recordings, name);
  if (recording) {
    writeFileSync(file, text);
    return;
  }
  expect(
    readFileSync(file, "utf8"),
    `${name} is not what the CLI prints; run bin/wiki-record`,
  ).toBe(text);
}

test("the wiki's first-push page shows what corpus init and build really do", async () => {
  const project = repo();
  mkdirSync(path.join(project.dir, "src", "i18n"), { recursive: true });
  // A small catalogue, translated into one language and half into the
  // other, so the page's numbers are a real repository's numbers.
  const catalogue = {
    en: {
      "document.delete": "Delete this document?",
      "document.deleted": "Document deleted",
      "document.rename": "Rename",
      "editor.save": "Save",
      "editor.saving": "Saving…",
      "editor.unsaved": "You have unsaved changes",
    },
    de: {
      "document.delete": "Dieses Dokument löschen?",
      "document.deleted": "Dokument gelöscht",
      "document.rename": "Umbenennen",
      "editor.save": "Speichern",
      "editor.saving": "Wird gespeichert…",
      "editor.unsaved": "Sie haben ungespeicherte Änderungen",
    },
    "pt-PT": {
      "document.delete": "Eliminar este documento?",
      "editor.save": "Guardar",
    },
  };
  for (const [lang, strings] of Object.entries(catalogue)) {
    writeFileSync(
      path.join(project.dir, "src", "i18n", `${lang}.json`),
      `${JSON.stringify(strings, null, 2)}\n`,
    );
  }

  expect(
    await run(
      [
        "init",
        "--project",
        "acme-app",
        "--source",
        "en",
        "--messages",
        "src/i18n/{lang}.json",
        "--type",
        "ui",
      ],
      project.ctx,
    ),
  ).toBe(0);
  recorded(
    "first-push.config.ts",
    readFileSync(path.join(project.dir, "corpus.config.ts"), "utf8"),
  );
  recorded("init.out", `${project.out.join("\n")}\n`);

  const building: string[] = [];
  const build = {
    ...project.ctx,
    out: (line: string) => building.push(line),
    err: (line: string) => building.push(line),
  };
  expect(await run(["build"], build)).toBe(0);
  recorded("build.out", `${building.join("\n")}\n`);
});

test("the library page shows what a catalogue read under the wrong one really says", async () => {
  const project = repo();
  mkdirSync(path.join(project.dir, "src", "i18n"), { recursive: true });
  writeFileSync(
    path.join(project.dir, "src", "i18n", "en.json"),
    `${JSON.stringify({ greeting: "Hello {{ name }}" }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(project.dir, "corpus.config.mjs"),
    `export default { project: "acme-app", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en"], sources: [{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }] };\n`,
  );
  expect(await run(["build"], project.ctx)).toBe(1);
  recorded("wrong-library.out", `${project.out.join("\n")}\n`);
});

test("the workbench page shows the banner the workbench prints", async () => {
  // The banner is built where the workbench starts; the page shows the
  // shape, and this pins the lines it is made of.
  const banner = [
    readFileSync(
      fileURLToPath(new URL("./workbench.ts", import.meta.url)),
      "utf8",
    ),
    readFileSync(
      fileURLToPath(new URL("./provision.ts", import.meta.url)),
      "utf8",
    ),
  ].join("\n");
  for (const line of [
    "is running at",
    "  database  ",
    "  secret    ",
    "token     ",
    "  stop      Ctrl-C",
  ]) {
    expect(banner, `the workbench no longer prints ${line.trim()}`).toContain(
      line,
    );
  }
});

test("the CI page shows what check and validate really say", async () => {
  const project = repo();
  mkdirSync(path.join(project.dir, "src", "i18n"), { recursive: true });
  mkdirSync(path.join(project.dir, "src", "components"), { recursive: true });
  writeFileSync(
    path.join(project.dir, "src", "i18n", "en.json"),
    `${JSON.stringify(
      {
        "editor.save": "Save",
        "editor.unsaved":
          "You have {count, plural, one {# change} other {# changes}}",
      },
      null,
      2,
    )}\n`,
  );
  // A translation that dropped the count, which is what validate is for.
  writeFileSync(
    path.join(project.dir, "src", "i18n", "pt-PT.json"),
    `${JSON.stringify(
      {
        "editor.save": "Guardar",
        "editor.unsaved": "Tem alterações por guardar",
      },
      null,
      2,
    )}\n`,
  );
  // A component that says something to a person without going through
  // the catalogue, which is what check is for.
  writeFileSync(
    path.join(project.dir, "src", "components", "Toolbar.tsx"),
    'export function Toolbar() {\n  return <button title="Save the document">Save</button>;\n}\n',
  );
  writeFileSync(
    path.join(project.dir, "corpus.config.mjs"),
    `export default { project: "acme-app", server: "http://localhost:3000", sourceLanguage: "en", languages: ["en", "pt-PT"], sources: [{ adapter: "messages", type: "ui", path: "src/i18n/{lang}.json" }], check: { include: ["src"] } };\n`,
  );

  expect(await run(["check"], project.ctx)).toBe(1);
  recorded("check.out", `${project.out.join("\n")}\n`);

  const validating: string[] = [];
  expect(
    await run(["validate"], {
      ...project.ctx,
      out: (line: string) => validating.push(line),
      err: (line: string) => validating.push(line),
    }),
  ).toBe(1);
  recorded("validate.out", `${validating.join("\n")}\n`);
});

test("every corpus command the CI workflow runs is one the CLI has", async () => {
  // The page's workflow is only worth showing if its commands are real.
  // The usage text puts several commands on one line, so it is split
  // into one segment per command before a flag is looked for: otherwise
  // `push --check` passes on `pull`'s flag, and a truncated `--chec`
  // passes on the string it is a prefix of.
  const workflow = readFileSync(path.join(examples, "ci.yml"), "utf8");
  const usage: string[] = [];
  await run(["--help"], {
    ...repo().ctx,
    out: (line: string) => usage.push(line),
  });
  const segments = usage
    .join("\n")
    .split(/\n|\s\|\s/)
    .map((segment) => segment.replace(/^\s*(usage:\s*)?/, "").trim())
    .filter((segment) => segment.startsWith("corpus "));
  // A word that is not a flag is a subcommand or a flag's value, and
  // belongs to the command rather than to the set being checked.
  const commands = [...workflow.matchAll(/npx corpus ([^\n]+)/g)].map(
    (found) => {
      const [command, ...rest] = found[1]!.trim().split(/\s+/);
      const flags = rest
        .filter((word) => word.startsWith("--"))
        .map((word) => word.split("=")[0]!);
      return [command!, flags] as const;
    },
  );
  expect(commands.length).toBeGreaterThan(0);
  for (const [command, flags] of commands) {
    const segment =
      segments.find((row) => row.startsWith(`corpus ${command} `)) ??
      segments.find((row) => row === `corpus ${command}`);
    expect(segment, `the CLI has no ${command} command`).toBeDefined();
    const known = new Set(segment!.match(/--[a-z-]+/g) ?? []);
    for (const flag of flags) {
      expect(known, `corpus ${command} has no ${flag}`).toContain(flag);
    }
  }
});

test("the agent pages name every tool the server has, and no other", async () => {
  // The recordings come from a live instance (bin/wiki-record-live), so
  // the gate cannot re-run them. What it can hold is the names: a tool
  // renamed, added or dropped must reach the pages that list it.
  const names = tools(apiOver("http://localhost:0", "t")).map(
    (tool) => tool.name,
  );
  const page = readFileSync(
    fileURLToPath(
      new URL("../../../docs/wiki/The-MCP-server.md", import.meta.url),
    ),
    "utf8",
  );
  const listed = [...page.matchAll(/^\| `([a-z_]+)` \|/gm)].map(
    (found) => found[1]!,
  );
  expect([...listed].sort()).toEqual([...names].sort());

  // Every tool the transcript calls is a tool that exists.
  const session = readFileSync(
    path.join(recordings, "mcp-session.txt"),
    "utf8",
  );
  const called = [
    ...session.matchAll(
      /"method":"tools\/call","params":\{"name":"([a-z_]+)"/g,
    ),
  ].map((found) => found[1]!);
  expect(called.length).toBeGreaterThan(0);
  for (const name of called) expect(names).toContain(name);
});

test("every config the wiki shows is a config the CLI accepts", async () => {
  const jiti = createJiti(import.meta.url);
  const configs = [examples, recordings].flatMap((dir) =>
    // A kind with nothing in it yet is a directory git does not carry.
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter((name) => name.endsWith(".config.ts"))
      .map((name) => path.join(dir, name)),
  );
  expect(configs.length).toBeGreaterThan(0);
  for (const name of configs) {
    const loaded = await jiti.import(name, {
      default: true,
    });
    const parsed = corpusConfigSchema.safeParse(loaded);
    expect(parsed.success, `${name}: ${parsed.error?.issues[0]?.message}`).toBe(
      true,
    );
  }
});
