import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { corpusConfigSchema, type CorpusConfig } from "@corpus/contract";

export const CONFIG_FILENAME = "corpus.config.ts";

export class CliError extends Error {}

// Loads and validates the client repo's corpus.config.ts (§3) via jiti, a
// runtime TS loader — no build step in the client repo.
export async function loadConfig(cwd: string): Promise<CorpusConfig> {
  const configPath = path.join(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    throw new CliError(`no ${CONFIG_FILENAME} found in ${cwd}`);
  }
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const loaded = await jiti.import(configPath, { default: true });
  return corpusConfigSchema.parse(loaded);
}

export function requireToken(env: NodeJS.ProcessEnv): string {
  const token = env.CORPUS_TOKEN;
  if (!token) {
    throw new CliError("CORPUS_TOKEN is not set (the per-project push token)");
  }
  return token;
}
