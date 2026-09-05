import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { CliError, loadConfig } from "./config";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// A client project: a config, and a stand-in for the installed CLI package
// in its own node_modules. The stand-in's defineCorpus tags the project
// name, so a config that loads through it proves resolution went through
// the client's node_modules, not the CLI's own location.
function client(configName: string, body: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-client-"));
  dirs.push(dir);
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
    'export const defineCorpus = (c) => ({ ...c, project: c.project + "-via-client" });\n',
  );
  writeFileSync(path.join(dir, configName), body);
  return dir;
}

const BODY = (
  project: string,
) => `import { defineCorpus } from "@corpus-tool/cli";
export default defineCorpus({
  project: "${project}",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "pt-PT"],
  sources: [{ adapter: "messages", type: "chrome", path: "src/i18n/{lang}.json" }],
});
`;

test("a TypeScript config resolves its CLI import from the client's node_modules", async () => {
  const dir = client("corpus.config.ts", BODY("ts-project"));
  const config = await loadConfig(dir);
  expect(config.project).toBe("ts-project-via-client");
});

test("a plain ESM config works the same way", async () => {
  const dir = client("corpus.config.mjs", BODY("mjs-project"));
  const config = await loadConfig(dir);
  expect(config.project).toBe("mjs-project-via-client");
});

test("no config names the directory and every filename looked for", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-empty-"));
  dirs.push(dir);
  await expect(loadConfig(dir)).rejects.toThrow(
    new RegExp(
      `${dir.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}.*corpus\\.config\\.ts.*corpus\\.config\\.mjs`,
    ),
  );
});

test("a config that fails to load names the file and the cause", async () => {
  const dir = client("corpus.config.ts", "export default oops(");
  await expect(loadConfig(dir)).rejects.toThrow(CliError);
  await expect(loadConfig(dir)).rejects.toThrow(
    /could not load .*corpus\.config\.ts/,
  );
});

test("a config rejected inside defineCorpus is reported the same way", async () => {
  const dir = client("corpus.config.ts", BODY("bad"));
  writeFileSync(
    path.join(dir, "node_modules", "@corpus-tool", "cli", "index.js"),
    'export const defineCorpus = () => { throw Object.assign(new Error("schema"), { issues: [{ path: ["languages"], message: "expected array" }] }); };\n',
  );
  await expect(loadConfig(dir)).rejects.toThrow(
    /corpus\.config\.ts is not a valid config: languages: expected array/,
  );
});

test("an invalid config names the file and the field", async () => {
  const dir = client(
    "corpus.config.ts",
    BODY("bad").replace('languages: ["en", "pt-PT"]', 'languages: "en"'),
  );
  await expect(loadConfig(dir)).rejects.toThrow(
    /corpus\.config\.ts is not a valid config: languages/,
  );
});
