import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  libraryOf,
  vueDefaultForms,
  isDroppedPlural,
  isFluentTermId,
  messageKind,
  nestedCountsOf,
  bareAtOf,
  parseIcu,
  tagMode,
  validateTranslation,
  type CorpusConfig,
  type ValidationError,
  type Library,
  type RichText,
  type TextReading,
  richTextFor,
  stringEntrySchema,
  type StringEntry,
} from "@corpus/contract";
import { isBlank, qtShortForms } from "@corpus/adapters";
import { printable } from "./printable";
import type { RunContext } from "./cli";
import {
  deprecations,
  execTranslationsSchema,
  fileOf,
  type FileSource,
  hasLanguages,
  isFluentTerm,
  nestedCountMessage,
  BARE_AT_MESSAGE,
  pluralFormsOf,
  entryPluralForms,
  lastWins,
  sourcePluralIds,
  readEntries,
  sourceWritesBack,
  runExporter,
  sourceLibrary,
  buildSnapshotReport,
} from "./build";
import { download } from "./pull";
import { unreadableFile } from "./catalogue-format";
import { CliError, loadConfig, requireToken } from "./config";

export const VALIDATE_USAGE = "corpus validate [--server] [--json]";

export type Finding = {
  file: string;
  key: string;
  // The language the translation is in; a source's own finding carries
  // the source language. A file source's path names it, an exec
  // source's command does not (#592).
  language: string;
  code:
    | ValidationError["code"]
    | "orphan"
    | "unread-plural"
    | "unread-message"
    | "short-numerus"
    | "shared-differs";
  // A plural missing a category the runtime picks, or with one it never
  // selects, is incomplete, not invalid (#556, #651): printed apart, and
  // never the reason for exit 1. A source's warning (#767) is the same.
  // A key the source no longer has is an `orphan` (#1013): exit 1, as an
  // invalid one, but counted apart; under --server it is a warning.
  severity: "invalid" | "orphan" | "incomplete" | "warning";
  message: string;
  sourceFile?: string;
  // A translation the instance holds, checked by --server (#1074).
  where?: "server";
};

// An exec source whose translations the repository does not hold all of:
// what its drafts on the instance are, offline, unchecked (#1074).
export type Unchecked = { source: string; reason: string };

// `corpus validate` (§3): the editor's checks (§5, §7) over the target
// files of every source with {lang} that pull writes back, and every
// exec source's exporter, offline. A missing key is not
// a finding (states cover it); a key the source no longer has is.
// A file source's line names the language in its path; an exec source's
// names it after the key, since the command stands for every language,
// and so does a String Catalog's, one file holding them all (#727).
function oneForAll(f: Finding): boolean {
  return (
    f.file.startsWith("exec:") ||
    /\.xcstrings$/i.test(f.file) ||
    // An instance's translation of a file without {lang}.
    (f.where === "server" && f.file === f.sourceFile)
  );
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
  const server = args.includes("--server");
  const value = args[args.indexOf("--server") + 1];
  if (server && value !== undefined && !value.startsWith("--")) {
    throw new CliError(
      `validate: --server takes no value; it checks the instance the config names (${value} given)`,
    );
  }
  const result = server
    ? await validateServer(config, ctx)
    : await validateRepo(config, ctx.cwd);
  if (result === undefined) return 1;
  const { findings, unchecked } = result;
  const json = args.includes("--json");
  const invalid = findings.filter((f) => f.severity === "invalid");
  // A source string that does not parse is the build's refusal, not a
  // translation's problem (#1013).
  const isSource = (f: Finding) =>
    f.code === "invalid-icu" && f.language === config.sourceLanguage;
  const sources = invalid.filter(isSource);
  const problems = invalid.filter((f) => !isSource(f));
  // A translation is a string's row in a language, as the server holds
  // it: an id two files of one source share is one (#1013).
  const translations = new Set(
    problems.map((f) => `${f.key}\u0000${f.language}`),
  ).size;
  const incomplete = findings.filter((f) => f.severity === "incomplete");
  const warnings = findings.filter((f) => f.severity === "warning");
  const orphans = findings.filter((f) => f.severity === "orphan");
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
  for (const { source, reason } of unchecked) {
    ctx.err(
      `corpus: exec "${source}" ${reason}; any others, such as drafts on the instance, are not checked here: \`corpus validate --server\` checks them`,
    );
  }
  if (findings.length > 0) {
    const parts = [
      translations
        ? `${translations} invalid translation(s)${problems.length > translations ? ` (${problems.length} problem(s))` : ""}`
        : "",
      sources.length
        ? `${sources.length} source string(s) that do not parse, which build refuses`
        : "",
      orphans.length
        ? `${byKey.size} orphan key(s) in ${new Set(orphans.map((f) => f.file)).size} file(s)`
        : "",
      incomplete.length
        ? `${incomplete.length} incomplete plural(s), a category the runtime picks that the translation lacks, one it never picks, or a plural written as one text`
        : "",
      warnings.length ? `${warnings.length} warning(s)` : "",
    ].filter(Boolean);
    ctx.err(`corpus: ${parts.join(", ")}`);
    if (invalid.length > 0 || orphans.length > 0) return 1;
  }
  if (!json) {
    const listed = `${incomplete.length} incomplete plural(s) listed above`;
    if (server && "checked" in result) {
      const checked = `(${result.checked} checked)`;
      ctx.out(
        incomplete.length > 0
          ? `validate --server: no invalid translation on the instance ${checked}; ${listed}`
          : `validate --server: every translation on the instance is valid ${checked}`,
      );
    } else {
      const notChecked =
        unchecked.length > 0
          ? `; not checked: what ${unchecked.map((u) => `exec "${u.source}"`).join(" and ")} ${unchecked.length === 1 ? "does" : "do"} not hand over (\`corpus validate --server\` checks it)`
          : "";
      ctx.out(
        incomplete.length > 0
          ? `validate: no invalid translation${unchecked.length > 0 ? " checked" : ""}; ${listed}${notChecked}`
          : unchecked.length > 0
            ? `validate: every translation checked is valid${notChecked}`
            : "validate: every translation is valid",
      );
    }
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
): Promise<{ findings: Finding[]; unchecked: Unchecked[] }> {
  const jiti = createJiti(import.meta.url);
  const findings: Finding[] = [];
  const unchecked: Unchecked[] = [];
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
      if (exec.handedOver < exec.possible)
        unchecked.push({
          source: source.command,
          reason:
            exec.handedOver === 0
              ? "hands over no translations"
              : `hands over ${exec.handedOver} of the ${exec.possible} translations its strings can have`,
        });
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
    // A source message Corpus cannot read is refused by itself (#991): a
    // finding once, and its translations are no orphans.
    const refusedSource = new Set<string>();
    const sources = await texts(
      jiti,
      cwd,
      sourceFile,
      source,
      true,
      config.sourceLanguage,
      (key, reason) => {
        refusedSource.add(key);
        findings.push({
          file: sourceFile,
          key,
          language: config.sourceLanguage,
          code: "invalid-icu",
          severity: "invalid",
          message: `invalid ${source.adapter === "fluent" ? "Fluent message" : "entry"}: ${reason ?? "not read"}`,
        });
      },
    );
    if (sources === undefined) {
      throw new CliError(`source file ${sourceFile} does not exist`);
    }
    findings.push(
      ...sourceWarnings(
        sourceFile,
        config.sourceLanguage,
        sources,
        (entry) => entry.library ?? library,
      ),
    );
    // A source that does not parse is the source file's finding, once.
    const brokenSources = new Set<string>();
    const pluralForms = pluralFormsOf(cwd, source, config);
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
        // Qt reads such forms, as Fluent does such messages; Corpus
        // cannot, so it says so, once (#751, #991, #1026).
        (key, reason) =>
          // A message the source cannot read is that source's finding,
          // and a target's own term no translation at all (#990).
          refusedSource.has(key) ||
          (isFluentTerm(source, key) && !sources.has(key)) ||
          findings.push(
            source.adapter !== "qt-ts"
              ? {
                  file,
                  key,
                  language,
                  code: "unread-message",
                  severity: "warning",
                  message: `Corpus cannot read this ${source.adapter === "fluent" ? "message" : "entry"} (${reason ?? "not read"}); it is not seeded, and pull leaves it as the file has it`,
                }
              : {
                  file,
                  key,
                  language,
                  code: "unread-plural",
                  severity: "warning",
                  message:
                    "a numerus form Corpus cannot read as one plural; it is not seeded, and pull leaves it as the file has it",
                },
          ),
        pluralIds,
      );
      if (translations === undefined) continue;
      // A numerus translation short of Qt's forms is the file's defect:
      // a count past them shows the source text (#1004).
      if (source.adapter === "qt-ts")
        for (const { id, have, want } of qtShortForms(
          readFileSync(path.join(cwd, file), "utf8"),
          language,
        ))
          if (sources.has(id))
            findings.push({
              file,
              key: id,
              language,
              code: "short-numerus",
              severity: "warning",
              message: `Qt's rule for ${language} has ${want} forms; the file has ${have}, so a count past them shows the source text`,
            });
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
        if (entry === undefined && refusedSource.has(key)) continue;
        // A target's own Fluent term is the locale's, defined for its
        // messages, never a key the source dropped (#990).
        if (entry === undefined && isFluentTerm(source, key)) continue;
        if (entry === undefined) {
          findings.push({
            file,
            key,
            language,
            code: "orphan",
            severity: "orphan",
            message: "the source no longer has this key",
            sourceFile,
          });
          continue;
        }
        findings.push(
          ...checkTranslation(
            {
              ...entry,
              ...((forms) => forms && { pluralForms: forms })(
                entryPluralForms(entry, source, pluralForms),
              ),
              ...((source as { pluralRules?: unknown }).pluralRules ===
                "default" && { pluralRules: "default" as const }),
            },
            target,
            {
              file,
              sourceFile,
              key,
              language,
              sourceLanguage: config.sourceLanguage,
              library: entry.library ?? library,
              richText: richTextFor(
                source.type,
                key,
                entry.library ?? library,
                config.richText,
              ),
              brokenSources,
            },
          ),
        );
      }
    }
  }
  return { findings, unchecked };
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
  onUnread?: (id: string, reason?: string) => void,
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
      return `missing ${error.written ?? written(error.name)}${error.quoted ? "; an apostrophe before a brace quotes it: write ’ or ''" : ""}`;
    case "unexpected-placeholder":
      return `unexpected ${error.written ?? written(error.name)}`;
    case "moved-placeholder":
      return `${error.written ?? written(error.name)} is in the text where the source writes it inside <${error.tag}>; is the tag written wrong?`;
    case "changed-verb":
      return error.moved
        ? `${error.actual} at position ${error.name} is ${error.expected} in the source; a verb that moved needs its index, ${error.indexed}`
        : /^\d+$/.test(error.name)
          ? `${error.actual} at position ${error.name} where the source has ${error.expected}`
          : `${error.actual} where the source has ${error.expected}`;
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
    case "bare-at":
      return BARE_AT_MESSAGE;
    case "form-count": {
      const read = (n: number) =>
        vueDefaultForms(n)
          .map((meaning) => meaning ?? "unused")
          .join(" | ");
      return `${error.actual} form(s) read as ${read(error.actual)} under vue-i18n's default rule, where the source's ${error.expected} are ${read(error.expected)}`;
    }
    case "missing-category":
      return `plural on {${error.arg}} lacks the ${error.key} branch the runtime picks in its language`;
    case "unexpected-category":
      return `plural on {${error.arg}} has the branch ${error.key}, which the runtime never picks in its language`;
    case "count-for-marker":
      return `${error.written ?? `%${error.name}`} is dropped; %n shows the count in its place`;
    case "changed-ordinal":
      return error.ordinal
        ? `{${error.arg}} is a selectordinal in the source, counted by the ordinal rule (1st, 2nd); write it as one, not as a plural`
        : `{${error.arg}} is a plural in the source; write it as one, not as a selectordinal`;
    case "flattened-plural":
      return `the plural on {${error.arg}} is written as one text: no value is lost, but every count reads the same form`;
    case "unpassed-selector":
      return `selects on {${error.arg}}, which the source never passes: Fluent renders the default`;
    case "unexpected-format":
      return error.actual === null
        ? `{${error.name}} is a ${error.expected} in the source; write it {${error.name}, ${error.expected}}`
        : `{${error.name}} is a ${error.expected} in the source, not a ${error.actual}`;
    case "missing-tag":
      return `missing the <${error.name}> tag${error.quoted ? "; an apostrophe before a tag quotes it: write ’ or ''" : ""}`;
    case "unpaired-tag":
      return `<${error.name}> wraps nothing here, where the source's <${error.name}>…</${error.name.split(" ")[0]}> wraps text`;
    case "unexpected-tag":
      return `unexpected <${error.name}> tag, which the source does not have`;
  }
}

// An exec source's translations are what its exporter hands over (§3):
// validated like a target file's, the command standing for the file
// (#560). The exporter runs once; how many it handed over of the
// translations its strings can have says what the instance may hold
// that nothing here checked (#1074).
function validateExec(
  command: string,
  cwd: string,
  targets: string[],
  sourceLanguage: string,
  richText: Record<string, RichText>,
): { findings: Finding[]; handedOver: number; possible: number } {
  const ran = runExporter(command, cwd);
  if (!ran.ok) throw new CliError(ran.error);
  const sources = new Map<string, StringEntry>();
  for (const raw of ran.output.strings ?? []) {
    const entry = stringEntrySchema.safeParse(raw);
    if (entry.success) sources.set(entry.data.id, entry.data);
  }
  // A string the build refuses can have no translation to hand over.
  const builds = (e: StringEntry) => {
    const library = libraryOf(e);
    return parseIcu(e.source, library, {
      html: tagMode(library, richTextFor(e.type, e.id, library, richText)),
    }).ok;
  };
  const possible = [...sources.values()].filter(builds).length * targets.length;
  if (ran.output.translations === undefined) {
    return { findings: [], handedOver: 0, possible };
  }
  const parsed = execTranslationsSchema.safeParse(ran.output.translations);
  if (!parsed.success) {
    throw new CliError(
      `exec "${command}" emitted invalid translations: a map of language to id to text, or to { text, state: "translated" }`,
    );
  }
  const findings: Finding[] = [];
  const file = `exec:${command}`;
  findings.push(...sourceWarnings(file, sourceLanguage, sources, libraryOf));
  const brokenSources = new Set<string>();
  let handedOver = 0;
  for (const [language, texts] of Object.entries(parsed.data)) {
    if (!targets.includes(language)) continue;
    for (const [key, target] of Object.entries(texts)) {
      if (target.trim() === "") continue;
      const entry = sources.get(key);
      if (entry && builds(entry)) handedOver += 1;
      if (!entry) {
        findings.push({
          file,
          key,
          language,
          code: "orphan",
          severity: "orphan",
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
          richText: richTextFor(entry.type, key, libraryOf(entry), richText),
          brokenSources,
        }),
      );
    }
  }
  return { findings, handedOver, possible };
}

// `corpus validate --server` (§3, #1074): the instance's translations
// at translated or above, each against its string as the repository's
// sources build it, exporters run, so what an exec source drafted on
// the instance and never wrote back is checked too. A finding's file is
// the language's file of the source the string is read from: for an id
// two files of one source share, the copy the build keeps, whose text
// the app reads.
async function validateServer(
  config: CorpusConfig,
  ctx: RunContext,
): Promise<
  { findings: Finding[]; unchecked: Unchecked[]; checked: number } | undefined
> {
  const { snapshot, refused, origin } = await buildSnapshotReport(
    config,
    ctx.cwd,
  );
  const token = requireToken(ctx.env, ctx.cwd);
  const payload = await download(config, token, "translated", [], ctx);
  if (payload === undefined) return undefined;
  const sourceLanguage = config.sourceLanguage;
  // A source string the build refuses is the repository's finding, once.
  const findings: Finding[] = refused.map((r) => ({
    file: r.file,
    key: r.id,
    language: sourceLanguage,
    code: "invalid-icu",
    severity: "invalid",
    message: r.message,
  }));
  const refusedIds = new Set(refused.map((r) => r.id));
  const strings = new Map(snapshot.strings.map((e) => [e.id, e]));
  const fileSources = new Map<string, FileSource>();
  for (const source of config.sources)
    if (source.adapter !== "exec")
      fileSources.set(fileOf(source, sourceLanguage, sourceLanguage), source);
  const orphans = new Map<string, string[]>();
  const brokenSources = new Set<string>();
  let checked = 0;
  for (const language of config.languages) {
    if (language === sourceLanguage) continue;
    for (const [key, target] of Object.entries(
      payload.translations[language] ?? {},
    )) {
      if (isBlank(target)) continue;
      const entry = strings.get(key);
      if (entry === undefined) {
        if (!refusedIds.has(key))
          orphans.set(key, [...(orphans.get(key) ?? []), language]);
        continue;
      }
      const sourceFile = origin.get(key)!;
      const source = fileSources.get(sourceFile);
      const file =
        source && hasLanguages(source)
          ? fileOf(source, language, sourceLanguage)
          : sourceFile;
      const library = libraryOf(entry);
      checked += 1;
      findings.push(
        ...checkTranslation(entry, target, {
          file,
          sourceFile,
          key,
          language,
          sourceLanguage,
          library,
          richText: richTextFor(entry.type, key, library, config.richText),
          brokenSources,
        }).map((f) =>
          // A source that does not parse is the repository's finding.
          f.language === sourceLanguage && f.file === sourceFile
            ? f
            : { ...f, sourceFile, where: "server" as const },
        ),
      );
    }
  }
  for (const [key, languages] of orphans)
    findings.push({
      file: config.server,
      sourceFile: config.server,
      key,
      language: languages.join(", "),
      code: "orphan",
      severity: "warning",
      message:
        "the instance holds a translation of this id, which the sources no longer have; the next push archives it",
      where: "server",
    });
  return { findings, unchecked: [], checked };
}

// A source's warnings, nested counts and vue-i18n's unlinked `@`, each
// on the string where it is.
function sourceWarnings(
  file: string,
  language: string,
  sources: Map<string, StringEntry>,
  libraryFor: (entry: StringEntry) => Library,
): Finding[] {
  return [...sources].flatMap(([key, entry]): Finding[] => [
    ...nestedCountsOf(entry.source, libraryFor(entry)).map((arg) => ({
      file,
      key,
      language,
      code: "nested-count" as const,
      severity: "warning" as const,
      message: nestedCountMessage(arg),
    })),
    // vue-i18n's unlinked `@`, said where the source writes it (#1017).
    ...(bareAtOf(entry.source, libraryFor(entry))
      ? [
          {
            file,
            key,
            language,
            code: "bare-at" as const,
            severity: "warning" as const,
            message: BARE_AT_MESSAGE,
          },
        ]
      : []),
  ]);
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
    richText: TextReading | undefined;
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
    ...(entry.pluralRules && { pluralRules: entry.pluralRules }),
    ...(library === "fluent" && isFluentTermId(key) && { term: true }),
    sourceLanguage: at.sourceLanguage,
  });
  // A select on what the source never passes is Fluent's default, a
  // warning; the rest of the list is incomplete plurals (#1032).
  const findings: Finding[] = (result.incomplete ?? []).map((error) => ({
    file,
    key,
    language,
    code: error.code,
    severity: error.code === "unpassed-selector" ? "warning" : "incomplete",
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
