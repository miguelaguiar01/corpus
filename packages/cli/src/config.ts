import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { corpusConfigSchema, type CorpusConfig } from "@corpus/contract";

// In the order they are looked for.
export const CONFIG_FILENAMES = [
  "corpus.config.ts",
  "corpus.config.mts",
  "corpus.config.js",
  "corpus.config.mjs",
] as const;

export class CliError extends Error {}

// Loads and validates the client repo's config (§3). jiti is anchored at
// the config file itself, so its imports (the CLI package, anything
// relative) resolve from the client project no matter where the CLI runs
// from; a TypeScript config needs no build step in the client repo.
export async function loadConfig(cwd: string): Promise<CorpusConfig> {
  const configPath = CONFIG_FILENAMES.map((name) => path.join(cwd, name)).find(
    (candidate) => existsSync(candidate),
  );
  if (!configPath) {
    throw new CliError(
      `no config found in ${cwd} (looked for ${CONFIG_FILENAMES.join(", ")})`,
    );
  }
  const jiti = createJiti(configPath, { moduleCache: false });
  let loaded: unknown;
  try {
    loaded = await jiti.import(configPath, { default: true });
  } catch (error) {
    // defineCorpus validates as the config module runs, so a bad config
    // surfaces here as a schema error, not only from the parse below.
    const issues = issuesOf(error);
    if (issues) throw invalid(configPath, issues);
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`could not load ${configPath}: ${message}`);
  }
  const parsed = corpusConfigSchema.safeParse(loaded);
  if (!parsed.success) throw invalid(configPath, parsed.error.issues);
  return parsed.data;
}

type Issue = { path: PropertyKey[]; message: string };

function issuesOf(error: unknown): Issue[] | undefined {
  const issues = (error as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as Issue[]) : undefined;
}

function invalid(configPath: string, issues: Issue[]): CliError {
  const list = issues
    .map(
      (issue) =>
        `${issue.path.map(String).join(".") || "config"}: ${issue.message}`,
    )
    .join("; ");
  return new CliError(`${configPath} is not a valid config: ${list}`);
}

export function requireToken(env: NodeJS.ProcessEnv): string {
  const token = env.CORPUS_TOKEN;
  if (!token) {
    throw new CliError("CORPUS_TOKEN is not set (the per-project push token)");
  }
  return token;
}
