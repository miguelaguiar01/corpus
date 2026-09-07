import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { messagesToEntries, tableToEntries } from "@corpus/adapters";
import {
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import { writesBack } from "./build";
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
  const findings = validateRepo(config, ctx.cwd);
  const skipped = config.sources.filter((s) => s.adapter === "exec");
  if (args.includes("--json")) {
    ctx.out(JSON.stringify(findings, null, 2));
  } else {
    for (const f of findings) ctx.err(`${f.file}:${f.key}: ${f.message}`);
  }
  for (const source of skipped) {
    ctx.err(
      `corpus: exec "${source.command}" is not validated: its translations live where its import command puts them`,
    );
  }
  if (findings.length > 0) {
    ctx.err(`corpus: ${findings.length} invalid translation(s)`);
    return 1;
  }
  if (!args.includes("--json")) ctx.out("validate: every translation is valid");
  return 0;
}

export function validateRepo(config: CorpusConfig, cwd: string): Finding[] {
  const findings: Finding[] = [];
  const targets = config.languages.filter((l) => l !== config.sourceLanguage);
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    if (!source.path.includes("{lang}") || !writesBack(source.path)) continue;
    const sourceFile = source.path.replace("{lang}", config.sourceLanguage);
    const sources = texts(cwd, sourceFile, source);
    if (sources === undefined) {
      throw new CliError(`source file ${sourceFile} does not exist`);
    }
    for (const language of targets) {
      const file = source.path.replace("{lang}", language);
      const translations = texts(cwd, file, source);
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
          findings.push({
            file,
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

// A catalogue's id → text, through the source's own adapter, so the
// keys are the ids push would send. Undefined when the file is absent;
// a file that does not parse is an error naming it.
function texts(
  cwd: string,
  rel: string,
  source: Exclude<CorpusConfig["sources"][number], { adapter: "exec" }>,
): Map<string, string> | undefined {
  const abs = path.join(cwd, rel);
  if (!existsSync(abs)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    throw new CliError(`${rel}: ${(error as Error).message}`);
  }
  try {
    const entries =
      source.adapter === "messages"
        ? messagesToEntries(data, { type: source.type })
        : tableToEntries(data, { type: source.type, map: source.map });
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
