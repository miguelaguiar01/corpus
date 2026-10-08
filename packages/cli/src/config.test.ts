import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, onTestFinished, test } from "vitest";
import { spawnSync } from "node:child_process";
import { run } from "./cli";
import { CliError, generatedBy, ignoreUnchecked, loadConfig } from "./config";

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
  const error = await loadConfig(dir).catch((e: unknown) => e as Error);
  expect(error).toBeInstanceOf(CliError);
  expect(error.message).toContain(dir);
  expect(error.message).toMatch(/corpus\.config\.ts.*corpus\.config\.mjs/);
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

test("an error with a malformed issues array is still reported as a load failure", async () => {
  const dir = client("corpus.config.ts", BODY("odd"));
  writeFileSync(
    path.join(dir, "node_modules", "@corpus-tool", "cli", "index.js"),
    'export const defineCorpus = () => { throw Object.assign(new Error("odd"), { issues: [42] }); };\n',
  );
  await expect(loadConfig(dir)).rejects.toThrow(
    /could not load .*corpus\.config\.ts: odd/,
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

test("a hyphenated code beside a Flutter file named with an underscore is refused with the code to write (#627)", async () => {
  const flutter = (languages: string[]) => {
    const dir = client(
      "corpus.config.mjs",
      `export default {
  project: "app",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ${JSON.stringify(languages)},
  sources: [{ adapter: "messages", type: "ui", path: "l10n/strings_{lang}.arb" }],
};
`,
    );
    mkdirSync(path.join(dir, "l10n"));
    for (const name of ["en", "pt_PT", "pt_BR", "de"])
      writeFileSync(path.join(dir, "l10n", `strings_${name}.arb`), "{}\n");
    return dir;
  };
  await expect(
    loadConfig(flutter(["en", "pt-PT", "pt-BR", "de"])),
  ).rejects.toThrow(
    "l10n/strings_{lang}.arb names its files with underscores: write pt-PT as pt_PT and pt-BR as pt_BR in the config's languages, as gen-l10n does, so pull writes into l10n/strings_pt_PT.arb rather than beside it",
  );
  await expect(
    loadConfig(flutter(["en", "pt_PT", "pt_BR", "de"])),
  ).resolves.toMatchObject({ project: "app" });
  // A hyphen-named file that exists, and a code with no file yet, are
  // not refused.
  const both = flutter(["en", "pt-PT", "fr-CA"]);
  writeFileSync(path.join(both, "l10n", "strings_pt-PT.arb"), "{}\n");
  await expect(loadConfig(both)).resolves.toMatchObject({ project: "app" });
});

test("a path git cannot judge is not asked, so the others' ignores are still read (#1176)", async () => {
  const outer = mkdtempSync(path.join(os.tmpdir(), "corpus-ignore-"));
  dirs.push(outer);
  const dir = path.join(outer, "repo");
  mkdirSync(path.join(dir, "gen"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, ".gitignore"), "/gen\n");
  writeFileSync(path.join(dir, "gen", "en.json"), '{ "a": "A" }');
  mkdirSync(path.join(outer, "outside"));
  writeFileSync(path.join(outer, "outside", "en.json"), '{ "b": "B" }');
  // A source behind a symlink, which git will not judge either.
  symlinkSync(path.join(outer, "outside"), path.join(dir, "linked"));
  // One inside the tree, which git refuses as beyond a symlink, failing
  // a call that asks of it with the others.
  mkdirSync(path.join(dir, "sub"));
  writeFileSync(path.join(dir, "sub", "en.json"), '{ "c": "C" }');
  symlinkSync(path.join(dir, "sub"), path.join(dir, "inner"));
  writeFileSync(
    path.join(dir, "corpus.config.mjs"),
    `export default {
  project: "p",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "gen/{lang}.json" },
    { adapter: "messages", type: "other", path: "../outside/{lang}.json", namespace: "out" },
    { adapter: "messages", type: "linked", path: "linked/{lang}.json", namespace: "ln" },
    { adapter: "messages", type: "inner", path: "inner/{lang}.json", namespace: "in" },
  ],
};
`,
  );
  const config = await loadConfig(dir);
  expect(config.sources.map((s) => generatedBy(s))).toEqual([
    "since git ignores it",
    undefined,
    undefined,
    undefined,
  ]);
  expect(ignoreUnchecked(config)).toBeUndefined();
});

test("where git cannot be asked, build says once that ignore detection did not run (#1176)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-nogit-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, "l"));
  writeFileSync(path.join(dir, "l", "en.json"), '{ "a": "A" }');
  mkdirSync(path.join(dir, "m"));
  writeFileSync(path.join(dir, "m", "en.json"), '{ "b": "B" }');
  writeFileSync(
    path.join(dir, "corpus.config.mjs"),
    `export default {
  project: "p",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "l/{lang}.json" },
    { adapter: "messages", type: "other", path: "m/{lang}.json" },
  ],
};
`,
  );
  // No repository above it, wherever the temporary directory lies.
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  onTestFinished(() => {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = ceiling;
  });
  expect(ignoreUnchecked(await loadConfig(dir))).toBe("not a git repository");
  const output: string[] = [];
  const code = await run(["build", "--out", path.join(dir, "s.json")], {
    cwd: dir,
    env: {},
    out: (s) => output.push(s),
    err: (s) => output.push(s),
  });
  expect(code).toBe(0);
  const notes = output.filter((line) =>
    line.includes("git ignore detection did not run"),
  );
  expect(notes).toEqual([
    "corpus: git ignore detection did not run (not a git repository); a generated source git ignores is not detected: set generated: true on it",
  ]);
});

test("where git refuses the repository, the note says git's own reason, and a top level ending in a space is read as written (#1176 review)", async () => {
  const config = (dir: string, generated = false) => {
    writeFileSync(
      path.join(dir, "corpus.config.mjs"),
      `export default {
  project: "p",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [{ adapter: "messages", type: "ui", path: "gen/{lang}.json"${generated ? ", generated: true" : ""} }],
};
`,
    );
  };
  const outer = mkdtempSync(path.join(os.tmpdir(), "corpus-owner-"));
  dirs.push(outer);
  const dir = path.join(outer, "repo ");
  mkdirSync(path.join(dir, "gen"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, ".gitignore"), "/gen\n");
  writeFileSync(path.join(dir, "gen", "en.json"), '{ "a": "A" }');
  config(dir);
  expect((await loadConfig(dir)).sources.map((s) => generatedBy(s))).toEqual([
    "since git ignores it",
  ]);
  // A checkout another user owns, as a container job's is.
  const owner = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
  onTestFinished(() => {
    if (owner === undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = owner;
  });
  expect(ignoreUnchecked(await loadConfig(dir))).toMatch(
    /^detected dubious ownership in repository at /,
  );
  // Every source already generated: nothing to detect, nothing to say.
  config(dir, true);
  expect(ignoreUnchecked(await loadConfig(dir))).toBeUndefined();
});

test("a source file git ignores is generated, unless the config is ignored too (#1000)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "corpus-generated-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(path.join(dir, "locale", "en"), { recursive: true });
  writeFileSync(
    path.join(dir, "locale", "en", "app.json"),
    '{ "save": "Save" }',
  );
  writeFileSync(path.join(dir, "web.json"), '{ "save": "Save" }');
  writeFileSync(path.join(dir, ".gitignore"), "/locale/en\n");
  writeFileSync(
    path.join(dir, "corpus.config.mjs"),
    `export default {
  project: "p",
  server: "http://localhost:3000",
  sourceLanguage: "en",
  languages: ["en", "de"],
  sources: [
    { adapter: "messages", type: "ui", path: "locale/{lang}/app.json" },
    { adapter: "table", type: "web", path: "web.json", map: { id: "id", text: "text" } },
  ],
};
`,
  );
  const config = await loadConfig(dir);
  expect(config.sources.map((s) => generatedBy(s))).toEqual([
    "since git ignores it",
    undefined,
  ]);
  writeFileSync(
    path.join(dir, ".gitignore"),
    "/locale/en\n/corpus.config.mjs\n",
  );
  expect((await loadConfig(dir)).sources.map((s) => generatedBy(s))).toEqual([
    undefined,
    undefined,
  ]);
  rmSync(dir, { recursive: true, force: true });
});
