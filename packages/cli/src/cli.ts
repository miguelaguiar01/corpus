import { buildSnapshot } from "./build";
import { CliError, loadConfig, requireToken } from "./config";
import { checkFiles } from "./check";
import { pull } from "./pull";

export type RunContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
};

const USAGE =
  "usage: corpus push [--dry-run] | corpus pull [--min-state <untranslated|translated|verified>] | corpus check";

export async function run(argv: string[], ctx: RunContext): Promise<number> {
  const [command] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    ctx.out(USAGE);
    return 0;
  }
  if (command === "push" || command === "pull" || command === "check") {
    try {
      if (command === "push") return await push(argv.slice(1), ctx);
      if (command === "pull") return await pull(argv.slice(1), ctx);
      return await check(ctx);
    } catch (error) {
      if (error instanceof CliError) {
        ctx.err(`corpus: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  ctx.err(USAGE);
  return 1;
}

type PushReport = {
  added: number;
  changed: number;
  stale: number;
  archived: number;
};

async function push(args: string[], ctx: RunContext): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env);
  const snapshot = await buildSnapshot(config, ctx.cwd);

  const url = `${config.server.replace(/\/$/, "")}/api/push${dryRun ? "?dryRun" : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });
  } catch (error) {
    throw new CliError(
      `could not reach the server at ${config.server}: ${(error as Error).message}`,
    );
  }

  if (response.status === 401) {
    ctx.err("corpus: unauthorized — check CORPUS_TOKEN for this project");
    return 1;
  }
  if (response.status === 422) {
    const body = (await response.json()) as {
      errors?: { id: string; message: string }[];
    };
    ctx.err("corpus: the server rejected the snapshot:");
    for (const error of body.errors ?? []) {
      ctx.err(`  ${error.id}: ${error.message}`);
    }
    return 1;
  }
  if (!response.ok) {
    ctx.err(
      `corpus: push failed (HTTP ${response.status})${await serverMessage(response)}`,
    );
    return 1;
  }

  const { report } = (await response.json()) as { report: PushReport };
  const label = dryRun ? "dry-run" : "pushed";
  ctx.out(
    `${label} ${config.project}: ${report.added} added, ${report.changed} changed, ${report.stale} stale, ${report.archived} archived`,
  );
  return 0;
}

// The server's message body for an otherwise-unhandled non-2xx, if any.
async function serverMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `: ${body.message}` : "";
  } catch {
    return "";
  }
}

// `corpus check` (§3): exit 1 with file:line: text per finding, 0 when clean.
async function check(ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const options = config.check ?? {};
  const findings = checkFiles(ctx.cwd, {
    include: options.include ?? ["src"],
    ignore: options.ignore,
    allow: (options.allow ?? []).map((source) => new RegExp(source, "u")),
  });
  for (const f of findings) ctx.err(`${f.file}:${f.line}: ${f.text}`);
  if (findings.length > 0) {
    ctx.err(
      `corpus: ${findings.length} user-facing literal(s) outside declared sources`,
    );
    return 1;
  }
  ctx.out("check: no user-facing literals outside declared sources");
  return 0;
}
