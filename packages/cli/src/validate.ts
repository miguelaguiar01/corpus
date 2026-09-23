import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  libraryOf,
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
  type Library,
  stringEntrySchema,
  type StringEntry,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import {
  deprecations,
  execTranslationsSchema,
  readEntries,
  runExporter,
  type FileSource,
  writesBack,
} from "./build";
import { CliError, loadConfig } from "./config";

export const VALIDATE_USAGE = "corpus validate [--json]";

export type Finding = {
  file: string;
  key: string;
  // The language the translation is in; a source's own finding carries
  // the source language. A file source's path names it, an exec
  // source's command does not (#592).
  language: string;
  code: ValidationError["code"] | "orphan";
  // A plural missing a category its language uses is incomplete, not
  // invalid (#556): printed apart, and never the reason for exit 1.
  severity: "invalid" | "incomplete";
  message: string;
  sourceFile?: string;
};

// `corpus validate` (§3): the editor's checks (§5, §7) over the target
// files of every JSON source with {lang}, offline. A missing key is not
// a finding (states cover it); a key the source no longer has is.
// A file source's line names the language in its path; an exec source's
// names it after the key, since the command stands for every language.
function line(f: Finding): string {
  return f.file.startsWith("exec:")
    ? `${f.file} [${f.key}] ${f.language}: ${f.message}`
    : `${f.file}:${f.key}: ${f.message}`;
}

export async function validate(
  args: string[],
  ctx: RunContext,
): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const { findings, unvalidated } = await validateRepo(config, ctx.cwd);
  const json = args.includes("--json");
  const invalid = findings.filter(
    (f) => f.code !== "orphan" && f.severity === "invalid",
  );
  const incomplete = findings.filter((f) => f.severity === "incomplete");
  const orphans = findings.filter((f) => f.code === "orphan");
  const byKey = orphansByKey(orphans);
  if (json) ctx.out(JSON.stringify(findings, null, 2));
  else {
    for (const f of invalid) ctx.err(line(f));
    for (const { first, targets } of byKey.values()) {
      ctx.err(
        `${first.sourceFile}:${first.key}: ${first.message}; ${targets} target file(s) carry it`,
      );
    }
    for (const f of incomplete) ctx.err(line(f));
  }
  for (const note of deprecations(config)) ctx.err(`corpus: ${note}`);
  for (const command of unvalidated) {
    ctx.err(
      `corpus: exec "${command}" is not validated: its exporter emits no translations`,
    );
  }
  if (findings.length > 0) {
    const parts = [
      invalid.length ? `${invalid.length} invalid translation(s)` : "",
      orphans.length
        ? `${byKey.size} orphan key(s) in ${new Set(orphans.map((f) => f.file)).size} file(s)`
        : "",
      incomplete.length
        ? `${incomplete.length} incomplete plural(s), a category the language uses and the translation lacks`
        : "",
    ].filter(Boolean);
    ctx.err(`corpus: ${parts.join(", ")}`);
    if (invalid.length > 0 || orphans.length > 0) return 1;
  }
  if (!json) {
    ctx.out(
      incomplete.length > 0
        ? `validate: no invalid translation; ${incomplete.length} incomplete plural(s) listed above`
        : "validate: every translation is valid",
    );
  }
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
): Promise<{ findings: Finding[]; unvalidated: string[] }> {
  const jiti = createJiti(import.meta.url);
  const findings: Finding[] = [];
  const unvalidated: string[] = [];
  const targets = config.languages.filter((l) => l !== config.sourceLanguage);
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      const exec = validateExec(
        source.command,
        cwd,
        targets,
        config.sourceLanguage,
      );
      findings.push(...exec.findings);
      if (!exec.validated) unvalidated.push(source.command);
      continue;
    }
    if (!source.path.includes("{lang}") || !writesBack(source.path)) continue;
    const sourceFile = source.path.replace("{lang}", config.sourceLanguage);
    const sources = await texts(jiti, cwd, sourceFile, source, true);
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
            language,
            code: "orphan",
            severity: "invalid",
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
        for (const error of result.incomplete ?? []) {
          findings.push({
            file,
            key,
            language,
            code: error.code,
            severity: "incomplete",
            message: describe(error, libraryOf(source)),
          });
        }
        if (result.ok) continue;
        for (const error of result.errors) {
          const inSource =
            error.code === "invalid-icu" && error.where === "source";
          if (inSource && brokenSources.has(key)) continue;
          if (inSource) brokenSources.add(key);
          findings.push({
            file: inSource ? sourceFile : file,
            key,
            language: inSource ? config.sourceLanguage : language,
            code: error.code,
            severity: "invalid",
            message: describe(error, libraryOf(source)),
          });
        }
      }
    }
  }
  return { findings, unvalidated };
}

// A catalogue's id → text through the source's own adapter, so the keys
// are the ids push would send. Undefined when the file is absent; a file
// that does not parse is an error naming it.
async function texts(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  rel: string,
  source: FileSource,
  sourceFile = false,
): Promise<Map<string, string> | undefined> {
  if (!existsSync(path.join(cwd, rel))) return undefined;
  try {
    const entries = await readEntries(jiti, cwd, rel, source, sourceFile);
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
    case "unexpected-format":
      return error.actual === null
        ? `{${error.name}} is a ${error.expected} in the source; write it {${error.name}, ${error.expected}}`
        : `{${error.name}} is a ${error.expected} in the source, not a ${error.actual}`;
    case "missing-tag":
      return `missing the <${error.name}> tag`;
    case "unexpected-tag":
      return `unexpected <${error.name}> tag, which the source does not have`;
  }
}

// An exec source's translations are what its exporter hands over (§3):
// validated like a target file's, the command standing for the file
// (#560). The exporter runs once; one that emits no translations is
// named as not validated.
function validateExec(
  command: string,
  cwd: string,
  targets: string[],
  sourceLanguage: string,
): { findings: Finding[]; validated: boolean } {
  const ran = runExporter(command, cwd);
  if (!ran.ok) throw new CliError(ran.error);
  if (ran.output.translations === undefined) {
    return { findings: [], validated: false };
  }
  const parsed = execTranslationsSchema.safeParse(ran.output.translations);
  if (!parsed.success) {
    throw new CliError(
      `exec "${command}" emitted invalid translations: a map of language to id to text`,
    );
  }
  const sources = new Map<string, StringEntry>();
  for (const raw of ran.output.strings ?? []) {
    const entry = stringEntrySchema.safeParse(raw);
    if (entry.success) sources.set(entry.data.id, entry.data);
  }
  const findings: Finding[] = [];
  const file = `exec:${command}`;
  const brokenSources = new Set<string>();
  for (const [language, texts] of Object.entries(parsed.data)) {
    if (!targets.includes(language)) continue;
    for (const [key, target] of Object.entries(texts)) {
      if (target.trim() === "") continue;
      const entry = sources.get(key);
      if (!entry) {
        findings.push({
          file,
          key,
          language,
          code: "orphan",
          severity: "invalid",
          message: "the exporter's strings no longer have this id",
          sourceFile: file,
        });
        continue;
      }
      const library = libraryOf(entry);
      const result = validateTranslation(
        entry.source,
        target,
        language,
        library,
      );
      for (const error of result.incomplete ?? []) {
        findings.push({
          file,
          key,
          language,
          code: error.code,
          severity: "incomplete",
          message: describe(error, library),
        });
      }
      if (result.ok) continue;
      for (const error of result.errors) {
        const inSource =
          error.code === "invalid-icu" && error.where === "source";
        if (inSource && brokenSources.has(key)) continue;
        if (inSource) brokenSources.add(key);
        findings.push({
          file,
          key,
          language: inSource ? sourceLanguage : language,
          code: error.code,
          severity: "invalid",
          message: describe(error, library),
        });
      }
    }
  }
  return { findings, validated: true };
}
