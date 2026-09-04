import { buildSnapshot } from "./build";
import { CliError, loadConfig, requireToken } from "./config";

export type RunContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
};

const USAGE = "usage: corpus push [--dry-run]";

export async function run(argv: string[], ctx: RunContext): Promise<number> {
  const [command] = argv;

  if (command === "push") {
    try {
      return await push(argv.slice(1), ctx);
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(snapshot),
  });

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
    ctx.err(`corpus: push failed (HTTP ${response.status})`);
    return 1;
  }

  const { report } = (await response.json()) as { report: PushReport };
  const label = dryRun ? "dry-run" : "pushed";
  ctx.out(
    `${label} ${config.project}: ${report.added} added, ${report.changed} changed, ${report.stale} stale, ${report.archived} archived`,
  );
  return 0;
}
