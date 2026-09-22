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
