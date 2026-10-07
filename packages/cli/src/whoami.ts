import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunContext } from "./cli";
import { option } from "./args";
import { CliError, loadConfig, readToken } from "./config";
import { CORPUS_DIR, DB_FILE, secretPath, TOKEN_FILE } from "./corpus-dir";
import { request } from "./server";
import { workbenchRecordPath, type WorkbenchRecord } from "./workbench";

export const WHOAMI_USAGE =
  "corpus whoami [--server <url>] [--show-secret] [--json]";

type Whoami = {
  server: string;
  version: string | null;
  project: string;
  token: { from: string; accepted: boolean | null } | null;
  workbench: (WorkbenchRecord & { running: boolean }) | null;
  staleSecret?: string;
  secret?: string;
};

// `corpus whoami` (§3, #1078): which instance the repository talks to,
// whether its token is taken, and, for a local workbench, the secret
// file the running process reads, which is the repository's own only
// where it was started here. Exits 1 when the server cannot be reached
// or refuses the token.
export async function whoami(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const server = (option(args, "--server") ?? config.server).replace(/\/$/, "");
  const version = await healthVersion(server);
  let token: Whoami["token"] = null;
  try {
    const read = readToken(ctx.env, ctx.cwd);
    const response =
      version === null ? undefined : await statusOf(server, read.token);
    token = {
      from:
        read.source === "env" ? "CORPUS_TOKEN" : `${CORPUS_DIR}/${TOKEN_FILE}`,
      accepted: response === undefined ? null : response,
    };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
  }
  const workbench = recordedWorkbench(ctx.cwd);
  const own = secretPath(ctx.cwd);
  const stale =
    workbench?.running &&
    existsSync(own) &&
    path.resolve(workbench.secretPath) !== path.resolve(own);
  const result: Whoami = {
    server,
    version,
    project: config.project,
    token,
    workbench,
    ...(stale && { staleSecret: own }),
    ...(args.includes("--show-secret") &&
      workbench?.running &&
      existsSync(workbench.secretPath) && {
        secret: readFileSync(workbench.secretPath, "utf8").trim(),
      }),
  };
  if (args.includes("--json")) ctx.out(JSON.stringify(result, null, 2));
  else for (const line of render(result, args)) ctx.out(line);
  return version !== null && token?.accepted !== false ? 0 : 1;
}

function render(result: Whoami, args: string[]): string[] {
  const lines = [
    `server     ${result.server} ${
      result.version === null ? "(not reachable)" : `(Corpus ${result.version})`
    }`,
    `project    ${result.project}`,
    `token      ${
      result.token === null
        ? `none: CORPUS_TOKEN is not set and ${CORPUS_DIR}/${TOKEN_FILE} does not exist`
        : `${result.token.from}, ${
            result.token.accepted === null
              ? "not checked"
              : result.token.accepted
                ? "accepted"
                : "refused"
          }`
    }`,
  ];
  const workbench = result.workbench;
  if (workbench)
    lines.push(
      workbench.running
        ? `workbench  running (pid ${workbench.pid}), reads its secret from ${workbench.secretPath}`
        : `workbench  ${CORPUS_DIR}/workbench.json is stale: pid ${workbench.pid} is not running`,
    );
  if (result.staleSecret)
    lines.push(
      `           ${CORPUS_DIR}/secret is stale: the running workbench reads another`,
    );
  if (result.secret !== undefined) lines.push(`secret     ${result.secret}`);
  else if (args.includes("--show-secret"))
    lines.push(
      "secret     unknown here: no running workbench recorded its secret file beside this repository's database",
    );
  return lines;
}

async function healthVersion(server: string): Promise<string | null> {
  try {
    const response = await fetch(`${server}/api/health`);
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : "unknown";
  } catch {
    return null;
  }
}

// Whether the server takes the token, by the cheapest call that needs one.
async function statusOf(
  server: string,
  token: string,
): Promise<boolean | undefined> {
  try {
    const response = await request(`${server}/api/status`, token);
    if (response.status === 401) return false;
    return response.ok ? true : undefined;
  } catch {
    return undefined;
  }
}

// The workbench recorded beside the repository's own database, where a
// workbench started elsewhere with `--db` writes it too.
function recordedWorkbench(
  cwd: string,
): (WorkbenchRecord & { running: boolean }) | null {
  const file = workbenchRecordPath(path.join(cwd, CORPUS_DIR, DB_FILE));
  if (!existsSync(file)) return null;
  let record: WorkbenchRecord;
  try {
    record = JSON.parse(readFileSync(file, "utf8")) as WorkbenchRecord;
  } catch {
    return null;
  }
  return { ...record, running: alive(record.pid) };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
