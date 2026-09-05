import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { run, type RunContext } from "./cli";
import { loadConfig } from "./config";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function project(): {
  dir: string;
  ctx: RunContext;
  out: string[];
  err: string[];
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-init-"));
  dirs.push(dir);
  const out: string[] = [];
  const err: string[] = [];
  return {
    dir,
    out,
    err,
    ctx: {
      cwd: dir,
      env: {},
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    },
  };
}

// The written config imports the CLI package; a stub in the project's own
// node_modules lets it load here.
function stubCli(dir: string) {
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
}

const FLAGS = [
  "init",
  "--project",
  "moonlight-manor",
  "--source",
  "pt-PT",
  "--languages",
  "pt-PT, en",
  "--messages",
  "src/i18n/{lang}.json",
];

test("writes a config that the loader accepts, and says what to do next", async () => {
  const p = project();
  stubCli(p.dir);
  const code = await run(FLAGS, p.ctx);
  expect(code).toBe(0);
  const file = path.join(p.dir, "corpus.config.ts");
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, "utf8");
  expect(text).toContain('from "@corpus-tool/cli"');
  expect(text).not.toContain("process.env");
  const config = await loadConfig(p.dir);
  expect(config.project).toBe("moonlight-manor");
  expect(config.languages).toEqual(["pt-PT", "en"]);
  expect(config.sources[0]).toMatchObject({
    adapter: "messages",
    type: "chrome",
    path: "src/i18n/{lang}.json",
  });
  expect(p.out.join("\n")).toMatch(/wrote corpus\.config\.ts/);
  expect(p.out.join("\n")).toMatch(/projects\/new/);
  expect(p.out.join("\n")).toMatch(/corpus push/);
});

test("refuses to overwrite an existing config, of any filename", async () => {
  const p = project();
  writeFileSync(path.join(p.dir, "corpus.config.mjs"), "export default {};\n");
  const code = await run(FLAGS, p.ctx);
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/corpus\.config\.mjs already exists/);
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
});

test("a missing flag names the flag and shows the usage", async () => {
  const p = project();
  const code = await run(["init", "--project", "x"], p.ctx);
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/--source is required/);
  expect(p.err.join("\n")).toMatch(/usage: corpus init/);
});

test("languages that leave out the source language are refused before anything is written", async () => {
  const p = project();
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--languages",
      "pt-PT",
      "--messages",
      "i18n/{lang}.json",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(
    /sourceLanguage: languages must include sourceLanguage/,
  );
  expect(existsSync(path.join(p.dir, "corpus.config.ts"))).toBe(false);
});

test("the messages path must carry the language placeholder", async () => {
  const p = project();
  const code = await run(
    [
      "init",
      "--project",
      "x",
      "--source",
      "en",
      "--languages",
      "en",
      "--messages",
      "i18n/en.json",
    ],
    p.ctx,
  );
  expect(code).toBe(1);
  expect(p.err.join("\n")).toMatch(/--messages must contain \{lang\}/);
});
