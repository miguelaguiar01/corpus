import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  libraryOf,
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
  type Library,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import {
  deprecations,
  readEntries,
  writesBack,
  type FileSource,
} from "./build";
import { CliError, loadConfig } from "./config";

export const VALIDATE_USAGE = "corpus validate [--json]";

export type Finding = {
  file: string;
  key: string;
  code: ValidationError["code"] | "orphan";
  message: string;
  sourceFile?: string;
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
  const invalid = findings.filter((f) => f.code !== "orphan");
  const orphans = findings.filter((f) => f.code === "orphan");
  const byKey = orphansByKey(orphans);
  if (json) ctx.out(JSON.stringify(findings, null, 2));
  else {
    for (const f of invalid) ctx.err(`${f.file}:${f.key}: ${f.message}`);
    for (const { first, targets } of byKey.values()) {
      ctx.err(
        `${first.sourceFile}:${first.key}: ${first.message}; ${targets} target file(s) carry it`,
      );
    }
  }
  for (const note of deprecations(config)) ctx.err(`corpus: ${note}`);
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      ctx.err(`corpus: exec "${source.command}" is not validated`);
    }
  }
  if (findings.length > 0) {
    const parts = [
      invalid.length ? `${invalid.length} invalid translation(s)` : "",
      orphans.length
        ? `${byKey.size} orphan key(s) in ${new Set(orphans.map((f) => f.file)).size} file(s)`
        : "",
    ].filter(Boolean);
    ctx.err(`corpus: ${parts.join(", ")}`);
    return 1;
  }
  if (!json) ctx.out("validate: every translation is valid");
  return 0;
}

// One line per orphan key of a source: two sources' target files may
// both keep a key neither source has.
function orphansByKey(
  orphans: Finding[],
): Map<string, { first: Finding; targets: number }> {
  const byKey = new Map<string, { first: Finding; targets: number }>();
  for (const f of orphans) {
    const id = `${f.sourceFile}\0${f.key}`;
    const entry = byKey.get(id) ?? { first: f, targets: 0 };
    entry.targets += 1;
    byKey.set(id, entry);
  }
  return byKey;
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
        // An empty value is a key the target lacks: what an extraction
        // tool leaves for an untranslated row, and what push seeds as
        // untranslated (§8), never a dropped placeholder.
        if (target.trim() === "") continue;
        const original = sources.get(key);
        if (original === undefined) {
          findings.push({
            file,
            key,
            code: "orphan",
            message: "the source no longer has this key",
            sourceFile,
          });
          continue;
        }
        const result = validateTranslation(
          original,
          target,
          language,
          libraryOf(source),
        );
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
            message: describe(error, libraryOf(source)),
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

export function describe(
  error: ValidationError,
  syntax: Library = "icu",
): string {
  const written = (name: string) =>
    syntax === "i18next" ? `{{${name}}}` : `{${name}}`;
  switch (error.code) {
    case "invalid-icu":
      return `invalid ${syntax === "i18next" ? "i18next" : "ICU"} in the ${error.where} at ${error.position}: ${error.message}`;
    case "missing-placeholder":
      return `missing ${written(error.name)}`;
    case "unexpected-placeholder":
      return `unexpected ${written(error.name)}`;
    case "unknown-select":
      return `select on {${error.arg}}, which the source does not select on`;
    case "missing-branch":
      return `select on {${error.arg}} lacks the branch ${error.key}`;
    case "unexpected-branch":
      return `select on {${error.arg}} has the branch ${error.key}, which the source does not`;
    case "unknown-plural":
      return `plural on {${error.arg}}, which the source has no value for`;
    case "missing-category":
      return `plural on {${error.arg}} lacks the ${error.key} branch its language uses`;
    case "unexpected-category":
      return `plural on {${error.arg}} has the branch ${error.key}, which its language does not use`;
    case "missing-tag":
      return `missing the <${error.name}> tag`;
    case "unexpected-tag":
      return `unexpected <${error.name}> tag, which the source does not have`;
    case "missing-form":
      return `${error.have} plural form(s) separated by |, where this language uses ${error.need}`;
    case "unexpected-form":
      return `${error.have} plural form(s) separated by |, where this language uses ${error.need}; the extra one is never shown`;
  }
}
