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

// #45 replaces the body with snapshot build + upload; #42 proves the
// config + token resolution and error paths.
async function push(_args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  requireToken(ctx.env);
  ctx.out(
    `push: ${config.project} → ${config.server} [${config.languages.join(", ")}]`,
  );
  return 0;
}
