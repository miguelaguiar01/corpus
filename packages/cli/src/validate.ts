import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import { readEntries, writesBack, type FileSource } from "./build";
import { CliError, loadConfig } from "./config";

export const VALIDATE_USAGE = "corpus validate [--json]";

export type Finding = {
  file: string;
  key: string;
  code: ValidationError["code"] | "orphan";
  message: string;
};

// `corpus validate` (§3): the editor's checks (§5, §7) over the target
// files of every JSON source with {lang}, offline. A missing key is not
// a finding (states cover it); a key the source no longer has is.
export async function validate(
  args: string[],
  ctx: RunContext,
): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const findings = await validateRepo(config, ctx.cwd);
  const json = args.includes("--json");
  if (json) ctx.out(JSON.stringify(findings, null, 2));
  else for (const f of findings) ctx.err(`${f.file}:${f.key}: ${f.message}`);
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      ctx.err(`corpus: exec "${source.command}" is not validated`);
    }
  }
  if (findings.length > 0) {
    ctx.err(`corpus: ${findings.length} invalid translation(s)`);
    return 1;
  }
  if (!json) ctx.out("validate: every translation is valid");
  return 0;
}

export async function validateRepo(
  config: CorpusConfig,
  cwd: string,
): Promise<Finding[]> {
  const jiti = createJiti(import.meta.url);
  const findings: Finding[] = [];
  const targets = config.languages.filter((l) => l !== config.sourceLanguage);
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    if (!source.path.includes("{lang}") || !writesBack(source.path)) continue;
    const sourceFile = source.path.replace("{lang}", config.sourceLanguage);
    const sources = await texts(jiti, cwd, sourceFile, source);
    if (sources === undefined) {
      throw new CliError(`source file ${sourceFile} does not exist`);
    }
    // A source that does not parse is the source file's finding, once.
    const brokenSources = new Set<string>();
    for (const language of targets) {
      const file = source.path.replace("{lang}", language);
      const translations = await texts(jiti, cwd, file, source);
      if (translations === undefined) continue;
      for (const [key, target] of translations) {
        const original = sources.get(key);
        if (original === undefined) {
          findings.push({
            file,
            key,
            code: "orphan",
            message: "the source no longer has this key",
          });
          continue;
        }
        const result = validateTranslation(original, target);
        if (result.ok) continue;
        for (const error of result.errors) {
          const inSource =
            error.code === "invalid-icu" && error.where === "source";
          if (inSource && brokenSources.has(key)) continue;
          if (inSource) brokenSources.add(key);
          findings.push({
            file: inSource ? sourceFile : file,
            key,
            code: error.code,
            message: describe(error),
          });
        }
      }
    }
  }
  return findings;
}

// A catalogue's id → text through the source's own adapter, so the keys
// are the ids push would send. Undefined when the file is absent; a file
// that does not parse is an error naming it.
async function texts(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  rel: string,
  source: FileSource,
): Promise<Map<string, string> | undefined> {
  if (!existsSync(path.join(cwd, rel))) return undefined;
  try {
    const entries = await readEntries(jiti, cwd, rel, source);
    return new Map(entries.map((e) => [e.id, e.source]));
  } catch (error) {
    throw new CliError(`${rel}: ${(error as Error).message}`);
  }
}

export function describe(error: ValidationError): string {
  switch (error.code) {
    case "invalid-icu":
      return `invalid ICU in the ${error.where} at ${error.position}: ${error.message}`;
    case "missing-placeholder":
      return `missing {${error.name}}`;
    case "unexpected-placeholder":
      return `unexpected {${error.name}}`;
    case "unknown-select":
      return `select on {${error.arg}}, which the source does not select on`;
    case "missing-branch":
      return `select on {${error.arg}} lacks the branch ${error.key}`;
    case "unexpected-branch":
      return `select on {${error.arg}} has the branch ${error.key}, which the source does not`;
  }
}
