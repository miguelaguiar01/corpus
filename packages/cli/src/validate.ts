import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  libraryOf,
  isDroppedPlural,
  messageKind,
  nestedCountsOf,
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
  type Library,
  type RichText,
  stringEntrySchema,
  type StringEntry,
} from "@corpus/contract";
import { isBlank, pluralBranches } from "@corpus/adapters";
import { printable } from "./printable";
import type { RunContext } from "./cli";
import {
  deprecations,
  execTranslationsSchema,
  fileOf,
  type FileSource,
  hasLanguages,
  nestedCountMessage,
  gettextPluralForms,
  lastWins,
  sourcePluralIds,
  readEntries,
  sourceWritesBack,
  runExporter,
  sourceLibrary,
  unreadReason,
} from "./build";
import { unreadableFile } from "./catalogue-format";
import { CliError, loadConfig } from "./config";

export const VALIDATE_USAGE = "corpus validate [--json]";

export type Finding = {
  file: string;
  key: string;
  // The language the translation is in; a source's own finding carries
  // the source language. A file source's path names it, an exec
  // source's command does not (#592).
  language: string;
  code: ValidationError["code"] | "orphan" | "unread-plural" | "shared-differs";
  // A plural missing a category the runtime picks, or with one it never
  // selects, is incomplete, not invalid (#556, #651): printed apart, and
  // never the reason for exit 1. A source's warning (#767) is the same.
  severity: "invalid" | "incomplete" | "warning";
  message: string;
  sourceFile?: string;
};

// `corpus validate` (§3): the editor's checks (§5, §7) over the target
// files of every source with {lang} that pull writes back, and every
// exec source's exporter, offline. A missing key is not
// a finding (states cover it); a key the source no longer has is.
// A file source's line names the language in its path; an exec source's
// names it after the key, since the command stands for every language,
// and so does a String Catalog's, one file holding them all (#727).
function oneForAll(f: Finding): boolean {
  return f.file.startsWith("exec:") || /\.xcstrings$/i.test(f.file);
}

function line(f: Finding): string {
  return oneForAll(f)
    ? `${f.file} [${printable(f.key)}] ${f.language}: ${f.message}`
    : `${f.file}:${printable(f.key)}: ${f.message}`;
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
  const warnings = findings.filter((f) => f.severity === "warning");
  const orphans = findings.filter((f) => f.code === "orphan");
  const byKey = orphansByKey(orphans);
  if (json) ctx.out(JSON.stringify(findings, null, 2));
  else {
    for (const f of invalid) ctx.err(line(f));
    for (const { first, targets } of byKey.values()) {
      ctx.err(
        `${orphanLine(first)}${targets > 1 ? `; ${targets - 1} more ${first.file.startsWith("exec:") ? "language(s)" : "target file(s)"} carry it` : ""}`,
      );
    }
    for (const f of incomplete) ctx.err(line(f));
    for (const f of warnings) ctx.err(line(f));
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
        ? `${incomplete.length} incomplete plural(s), a category the runtime picks that the translation lacks, or one it never picks`
        : "",
      warnings.length ? `${warnings.length} warning(s)` : "",
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

// An orphan is named where it is, the target file that keeps it (#662),
// with the source that no longer has it.
function orphanLine(f: Finding): string {
  if (oneForAll(f)) return line(f);
  return `${f.file}:${printable(f.key)}: ${f.message} (${f.sourceFile})`;
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
  // Under last-wins, the translations each group's earlier files hold,
  // by language (#953).
  const shared = new Map<string, Map<string, { file: string; text: string }>>();
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      const exec = validateExec(
        source.command,
        cwd,
        targets,
        config.sourceLanguage,
        config.richText ?? {},
      );
      findings.push(...exec.findings);
      if (!exec.validated) unvalidated.push(source.command);
      continue;
    }
    if (!hasLanguages(source)) continue;
    const sourceFile = fileOf(
      source,
      config.sourceLanguage,
      config.sourceLanguage,
    );
    if (source.adapter === "messages" || source.adapter === "table") {
      const abs = path.join(cwd, sourceFile);
      const unreadable = unreadableFile(abs);
      if (unreadable) throw new CliError(`${sourceFile}: ${unreadable}`);
    }
    if (!sourceWritesBack(source)) continue;
    const library = sourceLibrary(source);
    const sources = await texts(
      jiti,
      cwd,
      sourceFile,
      source,
      true,
      config.sourceLanguage,
    );
    if (sources === undefined) {
      throw new CliError(`source file ${sourceFile} does not exist`);
    }
    findings.push(
      ...nestedCounts(
        sourceFile,
        config.sourceLanguage,
        sources,
        (entry) => entry.library ?? library,
      ),
    );
    // A source that does not parse is the source file's finding, once.
    const brokenSources = new Set<string>();
    const pluralForms =
      source.adapter === "gettext"
        ? gettextPluralForms(cwd, source, config)
        : undefined;
    const pluralIds = await sourcePluralIds(
      jiti,
      cwd,
      source,
      config.sourceLanguage,
    );
    for (const language of targets) {
      const file = fileOf(source, language, config.sourceLanguage);
      const translations = await texts(
        jiti,
        cwd,
        file,
        source,
        false,
        language,
        // The runtime reads such forms; Corpus cannot, so it says so,
        // once (#751, #982).
        (key) =>
          findings.push({
            file,
            key,
            language,
            code: "unread-plural",
            severity: "warning",
            message: `${unreadReason(source.adapter)}; it is not seeded, and pull leaves it as the file has it`,
          }),
        pluralIds,
      );
      if (translations === undefined) continue;
      const group = "group" in source ? source.group : undefined;
      if (lastWins(source) && typeof group === "number") {
        const earlier =
          shared.get(`${group} ${language}`) ??
          new Map<string, { file: string; text: string }>();
        for (const [key, { source: text }] of translations) {
          // An empty value is a key the file lacks, never a finding.
          if (isBlank(text)) continue;
          const held = earlier.get(key);
          if (held !== undefined && held.text !== text)
            findings.push({
              file,
              key,
              language,
              code: "shared-differs",
              severity: "warning",
              message: `reads otherwise in ${held.file}, which the app never shows: this later file's is its translation, as merge: "last-wins" says`,
            });
          earlier.set(key, { file, text });
        }
        shared.set(`${group} ${language}`, earlier);
      }
      for (const [key, { source: target }] of translations) {
        // An empty value is a key the target lacks: what an extraction
        // tool leaves for an untranslated row, and what push seeds as
        // untranslated (§8), never a dropped placeholder.
        if (isBlank(target)) continue;
        const entry = sources.get(key);
        if (entry === undefined) {
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
        findings.push(
          ...checkTranslation(
            pluralForms && pluralBranches(entry.source)
              ? { ...entry, pluralForms }
              : entry,
            target,
            {
              file,
              sourceFile,
              key,
              language,
              sourceLanguage: config.sourceLanguage,
              library: entry.library ?? library,
              richText: config.richText?.[source.type],
              brokenSources,
            },
          ),
        );
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
  language?: string,
  onUnread?: (id: string) => void,
  pluralIds?: ReadonlySet<string>,
): Promise<Map<string, StringEntry> | undefined> {
  if (!existsSync(path.join(cwd, rel))) return undefined;
  try {
    const entries = await readEntries(
      jiti,
      cwd,
      rel,
      source,
      sourceFile,
      language,
      onUnread,
      pluralIds,
    );
    return new Map(entries.map((e) => [e.id, e]));
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
      return `invalid ${messageKind(syntax)} in the ${error.where} at ${error.position}: ${error.message}`;
    case "missing-placeholder":
      // Under android a value that is not a verb is the plural's count:
      // the translation is a <string> where the source is a <plurals>.
      if (syntax === "android" && error.written === undefined)
        return `a <string> where the source is a <plurals> on ${error.name}`;
      if (isDroppedPlural(error, syntax))
        return `the source is a plural on ${error.name}: write the translation as one`;
      return `missing ${error.written ?? written(error.name)}`;
    case "unexpected-placeholder":
      return `unexpected ${error.written ?? written(error.name)}`;
    case "changed-verb":
      return error.moved
        ? `${error.actual} at position ${error.name} is ${error.expected} in the source; a verb that moved needs its index, ${error.indexed}`
        : `${error.actual} at position ${error.name} where the source has ${error.expected}`;
    case "unknown-select":
      return `select on {${error.arg}}, which the source does not select on`;
    case "missing-branch":
      return `select on {${error.arg}} lacks the branch ${error.key}`;
    case "unexpected-branch":
      return `select on {${error.arg}} has the branch ${error.key}, which the source does not`;
    case "unknown-plural":
      return `plural on {${error.arg}}, which the source has no value for`;
    case "changed-nesting":
      return `{${error.inner}} sits inside {${error.outer}}'s branch, where the source does not put it`;
    case "nested-count":
      return nestedCountMessage(error.arg);
    case "missing-category":
      return `plural on {${error.arg}} lacks the ${error.key} branch the runtime picks in its language`;
    case "unexpected-category":
      return `plural on {${error.arg}} has the branch ${error.key}, which the runtime never picks in its language`;
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
  richText: Record<string, RichText>,
): { findings: Finding[]; validated: boolean } {
  const ran = runExporter(command, cwd);
  if (!ran.ok) throw new CliError(ran.error);
  if (ran.output.translations === undefined) {
    return { findings: [], validated: false };
  }
  const parsed = execTranslationsSchema.safeParse(ran.output.translations);
  if (!parsed.success) {
    throw new CliError(
      `exec "${command}" emitted invalid translations: a map of language to id to text, or to { text, state: "translated" }`,
    );
  }
  const sources = new Map<string, StringEntry>();
  for (const raw of ran.output.strings ?? []) {
    const entry = stringEntrySchema.safeParse(raw);
    if (entry.success) sources.set(entry.data.id, entry.data);
  }
  const findings: Finding[] = [];
  const file = `exec:${command}`;
  findings.push(...nestedCounts(file, sourceLanguage, sources, libraryOf));
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
      findings.push(
        ...checkTranslation(entry, target, {
          file,
          sourceFile: file,
          key,
          language,
          sourceLanguage,
          library: libraryOf(entry),
          richText: richText[entry.type],
          brokenSources,
        }),
      );
    }
  }
  return { findings, validated: true };
}

// A source's nested counts, a warning on each string where it is.
function nestedCounts(
  file: string,
  language: string,
  sources: Map<string, StringEntry>,
  libraryFor: (entry: StringEntry) => Library,
): Finding[] {
  return [...sources].flatMap(([key, entry]) =>
    nestedCountsOf(entry.source, libraryFor(entry)).map((arg) => ({
      file,
      key,
      language,
      code: "nested-count",
      severity: "warning" as const,
      message: nestedCountMessage(arg),
    })),
  );
}

// One translation against its source string: its incomplete plurals,
// then its errors, a source that does not parse named once per key, on
// the source's file in the source language.
function checkTranslation(
  entry: StringEntry,
  target: string,
  at: {
    file: string;
    sourceFile: string;
    key: string;
    language: string;
    sourceLanguage: string;
    library: Library;
    richText: RichText | undefined;
    brokenSources: Set<string>;
  },
): Finding[] {
  const { file, key, language, library } = at;
  const result = validateTranslation(entry.source, target, language, library, {
    richText: at.richText,
    ...(entry.arguments && { arguments: entry.arguments }),
    ...(entry.pluralForms?.[language] && {
      pluralForms: entry.pluralForms[language],
    }),
  });
  const findings: Finding[] = (result.incomplete ?? []).map((error) => ({
    file,
    key,
    language,
    code: error.code,
    severity: "incomplete",
    message: describe(error, library),
  }));
  if (result.ok) return findings;
  for (const error of result.errors) {
    const inSource = error.code === "invalid-icu" && error.where === "source";
    if (inSource && at.brokenSources.has(key)) continue;
    if (inSource) at.brokenSources.add(key);
    findings.push({
      file: inSource ? at.sourceFile : file,
      key,
      language: inSource ? at.sourceLanguage : language,
      code: error.code,
      severity: "invalid",
      message: describe(error, library),
    });
  }
  return findings;
}
