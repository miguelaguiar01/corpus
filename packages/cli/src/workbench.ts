import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { RunContext } from "./cli";
import { option } from "./args";
import { CliError, CONFIG_FILENAMES, loadConfig } from "./config";
import {
  CORPUS_DIR,
  DB_FILE,
  SECRET_FILE,
  ignoreCorpusDir,
} from "./corpus-dir";
import { provision, wantsProvision } from "./provision";

export const WORKBENCH_USAGE =
  "corpus workbench [--port <n>] [--db <path>] [--open] [--no-provision]";

const PACKAGE = "@corpus-tool/workbench";
const HEALTH_TIMEOUT_MS = 30_000;

export type Prepared = {
  bin: string;
  version: string;
  dbPath: string;
  secret: string;
  notes: string[];
};

// Everything before the process starts (§2): the workbench package from
// the repository's own node_modules, the database and the secret under
// .corpus/, and .gitignore told about it. Pure enough to test in a temp
// directory; the spawn is in run().
export function prepare(cwd: string, options: { db?: string } = {}): Prepared {
  const require = createRequire(path.join(cwd, "package.json"));
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${PACKAGE}/package.json`);
  } catch {
    throw new CliError(
      `${PACKAGE} is not installed in this repository; add it with: npm install --save-dev ${PACKAGE}`,
    );
  }
  const packageDir = path.dirname(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
  };
  const bin = path.join(packageDir, manifest.bin["corpus-workbench"]!);

  const notes: string[] = [];
  const dir = path.join(cwd, CORPUS_DIR);
  mkdirSync(dir, { recursive: true });
  const secretPath = path.join(dir, SECRET_FILE);
  let secret: string;
  if (existsSync(secretPath)) {
    secret = readFileSync(secretPath, "utf8").trim();
  } else {
    secret = randomBytes(24).toString("hex");
    writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });
    notes.push(`wrote a new instance secret to ${CORPUS_DIR}/${SECRET_FILE}`);
  }
  const dbPath = path.resolve(
    cwd,
    options.db ?? path.join(CORPUS_DIR, DB_FILE),
  );

  const ignored = ignoreCorpusDir(cwd);
  if (ignored) notes.push(ignored);
  return { bin, version: manifest.version, dbPath, secret, notes };
}

export async function healthy(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

export async function workbench(
  args: string[],
  ctx: RunContext,
): Promise<number> {
  const port = Number(option(args, "--port") ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError("--port must be a number between 1 and 65535");
  }
  const prepared = prepare(ctx.cwd, { db: option(args, "--db") });
  for (const note of prepared.notes) ctx.out(`corpus: ${note}`);

  const child = spawn(process.execPath, [prepared.bin], {
    cwd: ctx.cwd,
    env: {
      ...ctx.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      CORPUS_DB_PATH: prepared.dbPath,
      CORPUS_INVITE_SECRET: prepared.secret,
      CORPUS_VERSION: `v${prepared.version}`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const stop = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  const release = () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const url = `http://localhost:${port}`;
  const up = await Promise.race([
    healthy(url, HEALTH_TIMEOUT_MS),
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(false))),
  ]);
  if (!up) {
    stop();
    release();
    throw new CliError(
      `the workbench did not answer at ${url} within ${HEALTH_TIMEOUT_MS / 1000}s`,
    );
  }
  ctx.out("");
  ctx.out(`Corpus workbench ${prepared.version} is running at ${url}`);
  ctx.out(
    `  database  ${path.relative(ctx.cwd, prepared.dbPath) || prepared.dbPath}`,
  );
  ctx.out(
    `  secret    ${prepared.secret}  (join with it once; it is in ${CORPUS_DIR}/${SECRET_FILE})`,
  );
  if (wantsProvision(ctx.cwd, args)) {
    ctx.out(`  ${await provision(ctx.cwd, url, prepared.secret)}`);
  }
  const note = await serverNote(ctx.cwd, url);
  if (note) ctx.out(`  ${note}`);
  ctx.out("  stop      Ctrl-C");
  if (args.includes("--open")) openBrowser(url);

  return new Promise<number>((resolve) => {
    child.once("exit", (code, signal) => {
      release();
      // Stopped by the person (through this command) is a clean exit;
      // any other signal is a failure worth an exit code.
      const stopped = signal === "SIGTERM" || signal === "SIGINT";
      resolve(signal ? (stopped ? 0 : 1) : (code ?? 0));
    });
  });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  // A missing opener fails asynchronously; the URL is printed anyway.
  const opener = spawn(command, args, { detached: true, stdio: "ignore" });
  opener.on("error", () => {});
  opener.unref();
}

// The config's server is where push goes; a workbench on another port
// says so, since the next push would otherwise fail on a URL nobody
// typed (#559). A config that does not load is the build's to report.
export async function serverNote(
  cwd: string,
  url: string,
): Promise<string | undefined> {
  if (!CONFIG_FILENAMES.some((name) => existsSync(path.join(cwd, name)))) {
    return undefined;
  }
  let server: string;
  try {
    server = (await loadConfig(cwd)).server;
  } catch {
    return undefined;
  }
  const same = (value: string) => value.replace(/\/+$/, "").toLowerCase();
  if (same(server) === same(url)) return undefined;
  return `config    server is ${server}; push goes there. Pass --server to init, or edit ${CONFIG_FILENAMES[0]}`;
}
