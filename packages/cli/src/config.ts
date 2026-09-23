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
  // The same file through two patterns is one file, said once.
  const seen = new Map<string, string>();
  for (const source of sources) {
    if (source.adapter === "exec") continue;
    const file = source.path.replace("{lang}", input.sourceLanguage);
    const first = seen.get(file);
    if (first !== undefined) {
      throw new CliError(
        first === source.path
          ? `${file} is named twice by ${source.path}`
          : `${file} is named twice, by ${first} and ${source.path}`,
      );
    }
    seen.set(file, source.path);
  }
  return { ...input, sources };
}

// The files a pattern names: `{lang}` is one segment holding a language
// tag (or the one given), `{ns}` one or more segments, and the literal
// parts around them anchor both, so `src/{ns}/i18n/{lang}.json` reaches
// `src/Card/Header/i18n/en.json` and never `src/Button/i18n/nested/en.json`.
export function matchPattern(
  cwd: string,
  pattern: string,
  language?: string,
): { file: string; ns?: string; lang: string }[] {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const langRe = language
    ? escape(language)
    : "[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*";
  const source = pattern
    .split(/(\{ns\}|\{lang\})/)
    .map((part) =>
      part === "{ns}"
        ? "(.+)"
        : part === "{lang}"
          ? `(${langRe})`
          : escape(part),
    )
    .join("");
  const re = new RegExp(`^${source}$`);
  const nsFirst =
    pattern.indexOf("{ns}") >= 0 &&
    pattern.indexOf("{ns}") < pattern.indexOf("{lang}");
  const root = pattern.slice(
    0,
    Math.min(
      ...["{ns}", "{lang}"].map((t) =>
        pattern.includes(t) ? pattern.indexOf(t) : pattern.length,
      ),
    ),
  );
  const dir = root.includes("/") ? root.slice(0, root.lastIndexOf("/")) : ".";
  const out: { file: string; ns?: string; lang: string }[] = [];
  const walk = (rel: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(cwd, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = rel === "." ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else {
        const m = re.exec(file);
        if (!m) continue;
        const ns = pattern.includes("{ns}") ? m[nsFirst ? 1 : 2] : undefined;
        const lang = pattern.includes("{ns}") ? m[nsFirst ? 2 : 1]! : m[1]!;
        out.push(ns === undefined ? { file, lang } : { file, ns, lang });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// The namespaces a `{ns}` pattern captures for a language, as written,
// slashes and all, in name order.
export function namespacesOf(
  cwd: string,
  pattern: string,
  language: string,
): string[] {
  if (!pattern.includes("{ns}")) return [];
  return [
    ...new Set(
      matchPattern(cwd, pattern, language).flatMap((m) => (m.ns ? [m.ns] : [])),
    ),
  ].sort();
}
