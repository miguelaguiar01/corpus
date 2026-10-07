import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunContext } from "./cli";
import { option } from "./args";
import { CliError, loadConfig, readToken } from "./config";
import {
  CORPUS_DIR,
  DB_FILE,
  SECRET_FILE,
  secretPath,
  TOKEN_FILE,
} from "./corpus-dir";
import { request } from "./server";
import { workbenchRecordPath, type WorkbenchRecord } from "./workbench";

export const WHOAMI_USAGE =
  "corpus whoami [--server <url>] [--show-secret] [--json]";

type Health = { reachable: boolean; version: string | null };

type Workbench =
  | { state: "invalid" }
  | (WorkbenchRecord & {
      state: "running" | "no-process" | "no-answer";
      // Whether it is the server whoami was asked about.
      asked: boolean;
    });

type Whoami = {
  server: string;
  reachable: boolean;
  version: string | null;
  project: string;
  token: {
    from: string;
    accepted: boolean | null;
    // The project the server took it for, where not the config's.
    project?: string;
  } | null;
  workbench: Workbench | null;
  staleSecret?: string;
  secret?: string;
};

const RECORD = `${CORPUS_DIR}/workbench.json`;

// `corpus whoami` (§3, #1078): which instance the repository talks to,
// whether its token is taken, and, for a local workbench, the secret
// file the running process reads, which is the repository's own only
// where it was started here. Exits 1 when the server cannot be reached,
// is no Corpus, or refuses the token or takes it for another project.
export async function whoami(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const server = (option(args, "--server") ?? config.server).replace(/\/$/, "");
  const health = await healthOf(server);
  let token: Whoami["token"] = null;
  try {
    const read = readToken(ctx.env, ctx.cwd);
    const status =
      health.version === null ? undefined : await statusOf(server, read.token);
    token = {
      from:
        read.source === "env" ? "CORPUS_TOKEN" : `${CORPUS_DIR}/${TOKEN_FILE}`,
      accepted: status?.accepted ?? null,
      ...(status?.project !== undefined &&
        status.project !== config.project && { project: status.project }),
    };
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
  }
  const workbench = await recordedWorkbench(ctx.cwd, server);
  const own = secretPath(ctx.cwd);
  const running = workbench?.state === "running" ? workbench : undefined;
  const stale =
    running &&
    existsSync(own) &&
    path.resolve(running.secretPath) !== path.resolve(own);
  const shown =
    args.includes("--show-secret") &&
    running?.asked &&
    existsSync(running.secretPath)
      ? readFileSync(running.secretPath, "utf8").trim()
      : undefined;
  const result: Whoami = {
    server,
    reachable: health.reachable,
    version: health.version,
    project: config.project,
    token,
    workbench,
    ...(stale && { staleSecret: own }),
    ...(shown !== undefined && { secret: shown }),
  };
  if (args.includes("--json")) ctx.out(JSON.stringify(result, null, 2));
  else for (const line of render(result, args)) ctx.out(line);
  const fine =
    health.version !== null &&
    token?.accepted !== false &&
    token?.project === undefined;
  return fine ? 0 : 1;
}

function render(result: Whoami, args: string[]): string[] {
  const lines = [
    `server     ${result.server} ${
      !result.reachable
        ? "(not reachable)"
        : result.version === null
          ? "(answers, but not as Corpus)"
          : `(Corpus ${result.version})`
    }`,
    `project    ${result.project}`,
  ];
  const token = result.token;
  lines.push(
    `token      ${
      token === null
        ? `none: CORPUS_TOKEN is not set and ${CORPUS_DIR}/${TOKEN_FILE} does not exist`
        : `${token.from}, ${
            token.accepted === null
              ? "not checked"
              : !token.accepted
                ? "refused"
                : token.project !== undefined
                  ? `accepted, but for the project ${token.project}, not ${result.project}`
                  : "accepted"
          }`
    }`,
  );
  const workbench = result.workbench;
  if (workbench?.state === "invalid")
    lines.push(
      `workbench  ${RECORD} is no workbench's record, so nothing in it is used`,
    );
  else if (workbench?.state === "no-process")
    lines.push(
      `workbench  ${RECORD} is stale: pid ${workbench.pid} is not running`,
    );
  else if (workbench?.state === "no-answer")
    lines.push(
      `workbench  ${RECORD} is stale: nothing answers at ${workbench.url}`,
    );
  else if (workbench?.state === "running") {
    lines.push(
      `workbench  running at ${workbench.url} (pid ${workbench.pid}), reads its secret from ${workbench.secretPath}`,
    );
    if (!workbench.asked)
      lines.push(`           not ${result.server}, the server asked`);
  }
  if (result.staleSecret)
    lines.push(
      `           ${CORPUS_DIR}/secret is stale: the running workbench reads another`,
    );
  if (!args.includes("--show-secret")) return lines;
  const running = workbench?.state === "running" ? workbench : undefined;
  lines.push(
    result.secret !== undefined
      ? `secret     ${result.secret}`
      : !running
        ? "secret     unknown here: no running workbench is recorded beside this repository's database"
        : !running.asked
          ? `secret     not shown: the workbench recorded here is at ${running.url}; ask with --server ${running.url}`
          : `secret     the running workbench's secret file ${running.secretPath} is gone`,
  );
  return lines;
}

async function healthOf(server: string): Promise<Health> {
  let response: Response;
  try {
    response = await fetch(`${server}/api/health`);
  } catch {
    return { reachable: false, version: null };
  }
  if (!response.ok) return { reachable: false, version: null };
  try {
    const body = (await response.json()) as { version?: unknown };
    return {
      reachable: true,
      version: typeof body.version === "string" ? body.version : null,
    };
  } catch {
    return { reachable: true, version: null };
  }
}

// Whether the server takes the token, by the cheapest call that needs
// one, and the project it takes it for.
async function statusOf(
  server: string,
  token: string,
): Promise<{ accepted: boolean | null; project?: string }> {
  try {
    const response = await request(`${server}/api/status`, token);
    if (response.status === 401) return { accepted: false };
    if (!response.ok) return { accepted: null };
    const body = (await response.json()) as { project?: unknown };
    return {
      accepted: true,
      ...(typeof body.project === "string" && { project: body.project }),
    };
  } catch {
    return { accepted: null };
  }
}

// The workbench recorded beside the repository's own database, where a
// workbench started elsewhere with `--db` writes it too. The record is
// trusted only as one: a pid a workbench could have, a secret file
// named as `corpus workbench` names it, and running only where that pid
// is alive and something answers health at its url, so a pid reused
// after a reboot is not taken for it.
async function recordedWorkbench(
  cwd: string,
  server: string,
): Promise<Workbench | null> {
  const file = workbenchRecordPath(path.join(cwd, CORPUS_DIR, DB_FILE));
  if (!existsSync(file)) return null;
  let record: Partial<WorkbenchRecord>;
  try {
    record = JSON.parse(readFileSync(file, "utf8")) as WorkbenchRecord;
  } catch {
    return { state: "invalid" };
  }
  if (
    typeof record.url !== "string" ||
    !Number.isInteger(record.pid) ||
    record.pid! <= 1 ||
    typeof record.secretPath !== "string" ||
    path.basename(record.secretPath) !== SECRET_FILE
  )
    return { state: "invalid" };
  const valid = record as WorkbenchRecord;
  const asked = sameInstance(valid.url, server);
  if (!alive(valid.pid)) return { ...valid, state: "no-process", asked };
  if (!(await healthOf(valid.url)).reachable)
    return { ...valid, state: "no-answer", asked };
  return { ...valid, state: "running", asked };
}

// Two URLs of one instance: the same port on the same host, the
// loopback's names taken as one.
function sameInstance(a: string, b: string): boolean {
  const parse = (url: string) => {
    try {
      const u = new URL(url);
      const host = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
        u.hostname,
      )
        ? "loopback"
        : u.hostname;
      return `${u.protocol}//${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
    } catch {
      return url;
    }
  };
  return parse(a) === parse(b);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
