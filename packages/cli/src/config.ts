import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  corpusConfigSchema,
  type CorpusConfig,
  type CorpusInput,
  type Source,
} from "@corpus/contract";
import { CORPUS_DIR, TOKEN_FILE, tokenPath } from "./corpus-dir";

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
  return expandSources(parsed.data, cwd);
}

type Issue = { path: PropertyKey[]; message: string };

function issuesOf(error: unknown): Issue[] | undefined {
  const issues = (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return undefined;
  const wellFormed = issues.every(
    (issue) =>
      Array.isArray((issue as Issue)?.path) &&
      typeof (issue as Issue).message === "string",
  );
  return wellFormed ? (issues as Issue[]) : undefined;
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

export type TokenSource = "env" | "file";

// The project token (§10): the env var, then the file the workbench
// wrote; where it came from decides whether a rotation rewrites the file.
export function readToken(
  env: NodeJS.ProcessEnv,
  cwd: string,
): { token: string; source: TokenSource } {
  if (env.CORPUS_TOKEN) return { token: env.CORPUS_TOKEN, source: "env" };
  const file = tokenPath(cwd);
  if (existsSync(file)) {
    const token = readFileSync(file, "utf8").trim();
    if (token) return { token, source: "file" };
  }
  throw new CliError(
    `CORPUS_TOKEN is not set and ${CORPUS_DIR}/${TOKEN_FILE} does not exist (the per-project push token)`,
  );
}

export function requireToken(env: NodeJS.ProcessEnv, cwd: string): string {
  return readToken(env, cwd).token;
}

// A source's patterns become concrete sources (#513): an array is one
// source per pattern, and a `{ns}` pattern is one source per namespace
// found in the source language's files, the namespace kept so the ids
// it contributes are `ns:key` and a pull can strip it again.
export function expandSources(input: CorpusInput, cwd: string): CorpusConfig {
  const sources: Source[] = input.sources.flatMap((source): Source[] => {
    if (source.adapter === "exec") return [source];
    const patterns = Array.isArray(source.path) ? source.path : [source.path];
    return patterns.flatMap((pattern): Source[] => {
      if (!pattern.includes("{ns}")) return [{ ...source, path: pattern }];
      const names = namespacesOf(cwd, pattern, input.sourceLanguage);
      if (names.length === 0) {
        throw new CliError(
          `${pattern} matches no file for ${input.sourceLanguage}: nothing fills {ns}`,
        );
      }
      return names.map((ns) => ({
        ...source,
        path: pattern.replace("{ns}", ns),
        namespace: ns,
      }));
    });
  });
  return { ...input, sources };
}

// The namespaces a `{ns}` pattern captures for a language: the files
// that fill its one segment, in name order. A capture is one segment,
// so `locales/{lang}/{ns}.json` never reaches into a subdirectory.
export function namespacesOf(
  cwd: string,
  pattern: string,
  language: string,
): string[] {
  const concrete = pattern.replace("{lang}", language);
  const at = concrete.indexOf("{ns}");
  if (at < 0) return [];
  const before = concrete.slice(0, at);
  const after = concrete.slice(at + "{ns}".length);
  const dir = path.join(cwd, path.dirname(`${before}x`));
  const prefix = path.basename(`${before}x`).slice(0, -1);
  const suffix = after.split("/")[0] ?? "";
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => name.slice(prefix.length, name.length - suffix.length))
    .filter((ns) => ns.length > 0 && !ns.includes("/"))
    .filter((ns) => existsSync(path.join(cwd, concrete.replace("{ns}", ns))))
    .sort();
}
