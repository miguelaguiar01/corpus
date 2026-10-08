import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  libraryOf,
  chromeDollarsOf,
  type ChromeDollar,
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
import {
  entriesToFluent,
  fluentTerms,
  gettextPluralIds,
  isBlank,
  qtShortForms,
} from "@corpus/adapters";
import { printable } from "./printable";
import { append } from "./append";
import { readRepoText } from "./repo-text";
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
  formsHeld,
  namedPluralRules,
  lastWins,
  sourcePluralIds,
  type SourcePlurals,
  readEntries,
  sourceWritesBack,
  runExporter,
  sourceLibrary,
  buildSnapshotReport,
  namespaced,
  placeholdersOf,
  argumentsOf,
  misnamedSources,
  unknownArguments,
  takesLanguage,
} from "./build";
import { download } from "./pull";
import { unreadableFile } from "./catalogue-format";
import { CliError, loadConfig, requireToken } from "./config";
import { listed } from "./status";

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
    | "shared-differs"
    | "unreadable-file"
    | "unknown-term-argument"
    | "unknown-term-attribute";
  // A plural missing a category the runtime picks, or with one it never
  // selects, is incomplete, not invalid (#556, #651): printed apart, and
  // never the reason for exit 1. A source's warning (#767) is the same.
  // A key the source no longer has is an `orphan` (#1013), counted apart
  // and never the reason for exit 1: the runtime never reads it, and a
  // translation platform keeps it (#1023); under --server, a warning.
  severity: "invalid" | "orphan" | "incomplete" | "warning";
  message: string;
  sourceFile?: string;
  // A translation the instance holds, checked by --server (#1074).
  where?: "server";
  // A category the translation lacks that its source lacks too: listed
  // under the source's finding, not on its own line (#1029).
  sourceLacks?: true;
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
  if (f.code === "unreadable-file") return `${f.file}: ${f.message}`;
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
  const { unchecked } = result;
  const findings = result.findings.map(withLackingToo);
  const json = args.includes("--json");
  const invalid = findings.filter((f) => f.severity === "invalid");
  // A source string that does not parse is the build's refusal, not a
  // translation's problem (#1013).
  const isSource = (f: Finding) =>
    f.code === "invalid-icu" && f.language === config.sourceLanguage;
  const sources = invalid.filter(isSource);
  const unreadable = invalid.filter((f) => f.code === "unreadable-file");
  const problems = invalid.filter(
    (f) => !isSource(f) && f.code !== "unreadable-file",
  );
  // A translation is a string's row in a language, as the server holds
  // it: an id two files of one source share is one (#1013).
  const translations = new Set(
    problems.map((f) => `${f.key}\u0000${f.language}`),
  ).size;
  // A translation's gap its source has too is counted on the source's
  // line, and listed only in --json (#1029).
  const incomplete = findings.filter(
    (f) => f.severity === "incomplete" && !f.sourceLacks,
  );
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
      unreadable.length
        ? `${unreadable.length} target file(s) that do not read`
        : "",
      orphans.length
        ? `${byKey.size} orphan key(s) in ${new Set(orphans.map((f) => f.file)).size} file(s)`
        : "",
      incomplete.length
        ? `${incomplete.length} incomplete plural(s), a category the runtime picks that a source or a translation lacks, one it never picks, or a plural written as one text`
        : "",
      warnings.length ? `${warnings.length} warning(s)` : "",
    ].filter(Boolean);
    ctx.err(`corpus: ${parts.join(", ")}`);
    if (invalid.length > 0) return 1;
  }
  if (!json) {
    const listed = [
      byKey.size > 0
        ? `${byKey.size} orphan key(s) listed above, which the runtime never reads`
        : "",
      incomplete.length > 0
        ? `${incomplete.length} incomplete plural(s) listed above`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (server && "checked" in result) {
      const checked = `(${result.checked} checked)`;
      ctx.out(
        incomplete.length > 0
          ? `validate --server: no invalid translation on the instance ${checked}; ${listed}`
          : `validate --server: every translation on the instance is valid ${checked}${listed ? `; ${listed}` : ""}`,
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
            ? `validate: every translation checked is valid${listed ? `; ${listed}` : ""}${notChecked}`
            : `validate: every translation is valid${listed ? `; ${listed}` : ""}`,
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
  const misnamed = misnamedSources(config, cwd);
  if (misnamed.length > 0) throw new CliError(misnamed.join("\n"));
  const jiti = createJiti(import.meta.url);
  const findings: Finding[] = [];
  const unchecked: Unchecked[] = [];
  const targets = config.languages.filter((l) => l !== config.sourceLanguage);
  // Under last-wins, the copies each group's earlier files hold of a
  // translation, by language (#953), with the findings on each (#1116).
  const shared = new Map<string, Map<string, Copy[]>>();
  // Per language, the Fluent terms its files define, across every fluent
  // source, as the runtime merges them into one bundle (#1033).
  const terms = termsOf(cwd, config);
  // The ids each source's `arguments` names, and those its files hold,
  // as build checks them (#1031).
  const declaredIds = new Map<Record<string, string[]>, Set<string>>();
  // A pattern validate does not read back holds ids it never sees.
  const unseen = new Set<Record<string, string[]>>();
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      const exec = validateExec(
        source.command,
        cwd,
        targets,
        config.sourceLanguage,
        config.richText ?? {},
      );
      append(findings, exec.findings);
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
    const passes = (source as { arguments?: Record<string, string[]> })
      .arguments;
    if (!hasLanguages(source)) {
      if (passes) unseen.add(passes);
      continue;
    }
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
    if (!sourceWritesBack(source)) {
      if (passes) unseen.add(passes);
      continue;
    }
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
    if (passes) {
      const held = declaredIds.get(passes) ?? new Set<string>();
      for (const id of [...sources.keys(), ...refusedSource]) held.add(id);
      declaredIds.set(passes, held);
    }
    append(
      findings,
      sourceWarnings(
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
    const asForms = await formsHeld(
      jiti,
      cwd,
      sourceFile,
      source,
      config.sourceLanguage,
    );
    const augment = (entry: StringEntry): StringEntry => ({
      ...entry,
      ...entryPluralForms(entry, source, pluralForms),
      ...(asForms(entry) && { pluralAsForms: true }),
      ...namedPluralRules(source),
      ...placeholdersOf(source),
      ...argumentsOf(source, entry.id),
    });
    const gaps: SourceGaps = new Map();
    const pairs = pairsOf(cwd, source, sourceFile);
    for (const entry of sources.values())
      if (!refusedSource.has(entry.id))
        findings.push(
          ...sourceGaps(augment(entry), {
            pairs,
            brokenSources,
            sourceFile,
            sourceLanguage: config.sourceLanguage,
            library: entry.library ?? library,
            richText: richTextFor(
              source.type,
              entry.id,
              entry.library ?? library,
              config.richText,
            ),
            gaps,
          }),
        );
    for (const language of targets) {
      // A language the source does not ship has no file of its (#1006).
      if (!takesLanguage(source, config, language)) continue;
      const file = fileOf(source, language, config.sourceLanguage);
      // A target file that does not read is its own finding (#1028), and
      // the others are still checked.
      const unsplit = new Map<string, string[]>();
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
        (key, form) => unsplit.set(key, [...(unsplit.get(key) ?? []), form]),
      ).catch((error: unknown) => {
        findings.push({
          file,
          key: "",
          language,
          code: "unreadable-file",
          severity: "invalid",
          message: `does not read: ${(error as Error).message.replace(`${file}: `, "")}`,
        });
        return undefined;
      });
      if (translations === undefined) continue;
      // A numerus translation short of Qt's forms is the file's defect:
      // a count past them shows the source text (#1004).
      if (source.adapter === "qt-ts")
        for (const { id: raw, have, want } of qtShortForms(
          readFileSync(path.join(cwd, file), "utf8"),
          language,
        )) {
          const id = namespaced(source, raw);
          if (sources.has(id))
            findings.push({
              file,
              key: id,
              language,
              code: "short-numerus",
              severity: "warning",
              message: `Qt's rule for ${language} has ${want} forms; the file has ${have}, so a count past them shows the source text`,
            });
        }
      const group = "group" in source ? source.group : undefined;
      const earlier =
        lastWins(source) && typeof group === "number"
          ? (shared.get(`${group} ${language}`) ?? new Map<string, Copy[]>())
          : undefined;
      if (earlier) {
        for (const [key, { source: text }] of translations) {
          // An empty value is a key the file lacks, never a finding, and
          // an id its source file lacks is no seed (#1071).
          if (isBlank(text) || !sources.has(key)) continue;
          const copies = earlier.get(key) ?? [];
          const held = copies.at(-1);
          if (held !== undefined && held.text !== text)
            findings.push({
              file,
              key,
              language,
              code: "shared-differs",
              severity: "warning",
              message: `reads otherwise in ${held.file}, which the app never shows: this later file's is its translation, as merge: "last-wins" says`,
            });
          for (const copy of copies)
            if (copy.hidden || copy.text !== text) hideCopy(copy, file);
          copies.push({ file, text, findings: [] });
          earlier.set(key, copies);
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
        // A plural object's form the rebuilt text splits otherwise is the
        // finding; the rebuilt text's own would mislead (#1186).
        const forms = unsplit.get(key);
        const checked = forms
          ? forms.map((form): Finding => ({
              file,
              key,
              language,
              code: "unsplittable-form",
              severity: "invalid",
              message: describe(
                { code: "unsplittable-form", arg: "count", key: form },
                entry.library ?? library,
              ),
            }))
          : checkTranslation(augment(entry), target, {
              gaps,
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
            });
        findings.push(...checked);
        earlier
          ?.get(key)
          ?.at(-1)
          ?.findings.push(
            ...checked
              .filter((f) => f.file === file)
              .map((finding) => ({ finding, message: finding.message })),
          );
        if (source.adapter === "fluent")
          findings.push(
            ...termWarnings(target, {
              file,
              key,
              language,
              own: terms(language),
              source: terms(config.sourceLanguage),
            }),
          );
      }
    }
  }
  const unknown = unknownArguments(
    new Map([...declaredIds].filter(([passes]) => !unseen.has(passes))),
  );
  if (unknown.length > 0) throw new CliError(unknown.join("\n"));
  return { findings, unchecked };
}

// A target file's copy of a translation under last-wins (#953), with
// its findings and their messages as checked.
type Copy = {
  file: string;
  text: string;
  findings: { finding: Finding; message: string }[];
  hidden?: true;
};

// A copy a later file of its group holds otherwise is one the app never
// shows: its problems are warnings, not the translation's, naming the
// latest file that holds it otherwise (#1116). A gap its source lacks
// too stays the source's, in --json alone (#1029).
function hideCopy(copy: Copy, later: string): void {
  copy.hidden = true;
  for (const { finding, message } of copy.findings) {
    if (finding.sourceLacks) continue;
    finding.severity = "warning";
    finding.message = `${message}; the app never shows this copy: ${later}'s is its translation, as merge: "last-wins" says`;
  }
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
  pluralIds?: SourcePlurals,
  onUnsplit?: (id: string, key: string) => void,
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
      undefined,
      onUnsplit,
    );
    return new Map(entries.map((e) => [e.id, e]));
  } catch (error) {
    throw new CliError(`${rel}: ${(error as Error).message}`);
  }
}

function quotedPast(error: { quoted?: true }): string {
  return error.quoted
    ? "; an apostrophe before a brace, a tag or a # quotes it: write ’ or ''"
    : "";
}

export function describe(
  error: ValidationError,
  syntax: Library = "icu",
): string {
  const written = (name: string) =>
    syntax === "i18next" ? `{{${name}}}` : `{${name}}`;
  switch (error.code) {
    case "invalid-icu":
      return `invalid ${messageKind(syntax)} in the ${error.where} at ${error.position}: ${error.message}${quotedPast(error)}`;
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
    case "hash-text":
      return `gen-l10n prints # as written: write {${error.arg}} for the count`;
    case "chrome-dollar":
      return chromeDollarMessage(error);
    case "form-count": {
      const read = (n: number) =>
        vueDefaultForms(n)
          .map((meaning) => meaning ?? "unused")
          .join(" | ");
      return `${error.actual} form(s) read as ${read(error.actual)} under vue-i18n's default rule, where the source's ${error.expected} are ${read(error.expected)}`;
    }
    case "missing-category":
      return `plural on {${error.arg}} lacks the ${error.key} branch the runtime picks in its language`;
    case "fixed-count":
      return `the ${error.key} branch of {${error.arg}} writes 1, but this language also picks it for ${error.values.join(", ")}${error.more ? " and more" : ""}: write ${written(error.arg)} in it`;
    case "exact-branch":
      return `{${error.arg}} has an ${error.key} branch, which this file cannot hold, as it holds a plural's categories only: write it in the ${error.category} branch, which this language picks for ${error.key.slice(1)}`;
    case "missing-other":
      return `plural on {${error.arg}} has no other form, which the runtime picks for every count no other form covers${quotedPast(error)}`;
    case "text-beside-plural":
      return `text beside the plural on {${error.arg}}, which this file holds as its forms alone: write the text into each form`;
    case "unsplittable-form":
      return `the ${error.key} form of {${error.arg}} leaves a brace unbalanced, so this file cannot hold it as one of its forms: balance the braces in it`;
    case "shared-form":
      return `${listed(error.keys)} are one form in this file: write the same text in ${error.keys.length === 2 ? "both" : "each"}`;
    case "overridden-branch":
      return `plural on {${error.arg}} writes ${error.key} and ${error.category}, which gen-l10n reads as one branch: it keeps the one written later and drops the other`;
    case "wide-exact": {
      // gen-l10n has =0, =1 and =2 alone: one of those, the only case a
      // language has (French `=1`, whose one also holds 0), is offered.
      const value = error.values[0]!;
      const own = !error.more && error.values.length === 1 && value <= 2;
      return `gen-l10n reads ${error.key} on {${error.arg}} as ${error.category}, which this language also picks for ${error.values.join(", ")}${error.more ? " and more" : ""}: write ${error.category} for what they share${own ? `, or give ${value} its own =${value}` : ""}`;
    }
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
      if (error.expected === null)
        return `{${error.name}} has no format in the source, which passes it as it is: write it without one`;
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
  const file = `exec:${command}`;
  // The source is checked whether or not the exporter hands over any
  // translation of it (#1029).
  const findings: Finding[] = [];
  const gaps: SourceGaps = new Map();
  const brokenSources = new Set<string>();
  for (const entry of sources.values())
    findings.push(
      ...sourceGaps(entry, {
        brokenSources,
        sourceFile: file,
        sourceLanguage,
        library: libraryOf(entry),
        richText: richTextFor(entry.type, entry.id, libraryOf(entry), richText),
        gaps,
      }),
    );
  if (ran.output.translations === undefined) {
    return { findings, handedOver: 0, possible };
  }
  const parsed = execTranslationsSchema.safeParse(ran.output.translations);
  if (!parsed.success) {
    throw new CliError(
      `exec "${command}" emitted invalid translations: a map of language to id to text, or to { text, state: "translated" }`,
    );
  }
  append(findings, sourceWarnings(file, sourceLanguage, sources, libraryOf));
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
          gaps,
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
  const { snapshot, refused, origin, unreadable } = await buildSnapshotReport(
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
  // A target file that does not read is the repository's too (#1028).
  for (const { file, language, message } of unreadable)
    findings.push({
      file,
      key: "",
      language,
      code: "unreadable-file",
      severity: "invalid",
      message: `does not read: ${message}`,
    });
  const refusedIds = new Set(refused.map((r) => r.id));
  const strings = new Map(snapshot.strings.map((e) => [e.id, e]));
  const fileSources = new Map<string, FileSource>();
  for (const source of config.sources)
    if (source.adapter !== "exec")
      fileSources.set(fileOf(source, sourceLanguage, sourceLanguage), source);
  const terms = pulledTermsOf(ctx.cwd, config, payload.translations);
  const orphans = new Map<string, string[]>();
  const brokenSources = new Set<string>();
  const gaps: SourceGaps = new Map();
  const pairsByFile = new Map<string, ReadonlySet<string> | undefined>();
  for (const entry of snapshot.strings) {
    const library = libraryOf(entry);
    const sourceFile = origin.get(entry.id)!;
    const source = fileSources.get(sourceFile);
    if (source && !pairsByFile.has(sourceFile))
      pairsByFile.set(sourceFile, pairsOf(ctx.cwd, source, sourceFile));
    findings.push(
      ...sourceGaps(entry, {
        pairs: pairsByFile.get(sourceFile),
        sourceFile,
        sourceLanguage,
        library,
        richText: richTextFor(entry.type, entry.id, library, config.richText),
        gaps,
      }),
    );
  }
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
      if (entry.languages && !entry.languages.includes(language)) continue;
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
          gaps,
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
      if (source?.adapter === "fluent")
        findings.push(
          ...termWarnings(target, {
            file,
            key,
            language,
            own: terms(language),
            source: terms(sourceLanguage),
          }).map((f) => ({ ...f, sourceFile, where: "server" as const })),
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

function chromeDollarMessage({ at, kind, written }: ChromeDollar): string {
  if (kind === "lone")
    return written.length < 2
      ? `Chrome drops the lone $ that ends the text: write $$ for the sign`
      : `Chrome drops the lone $ at ${at} with the character after it (${JSON.stringify(written)}): write $$ for the sign`;
  if (kind === "price")
    return `Chrome reads ${written} at ${at} as substitution ${written[1]} then ${JSON.stringify(written.slice(2))}: write $${written} for a price`;
  const run = /^\$+/.exec(written)![0].length;
  if (run === 2)
    return `Chrome reads ${written} at ${at} as a $ before the placeholder, then reads that $ with the start of its value, so a text value loses its first character (Bob shows as ob) and a $1 value shows as a literal $1: put a space between`;
  const shown = run - 2;
  return `Chrome reads ${written} at ${at} as ${run - 1} dollars before the placeholder, then reads them with the start of its value, so it shows ${shown} ${shown === 1 ? "dollar" : "dollars"} before a text value (${"$".repeat(shown)}Bob), and a $1 value joins the run and shows literally: put a space between`;
}

// A source's warnings, nested counts, Chrome's dollars and vue-i18n's
// unlinked `@`, each on the string where it is.
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
    // Chrome's `$` a source writes that it reads otherwise (#631).
    ...chromeDollarsOf(entry.source, libraryFor(entry)).map((dollar) => ({
      file,
      key,
      language,
      code: "chrome-dollar" as const,
      severity: "warning" as const,
      message: chromeDollarMessage(dollar),
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

// A source plural's categories that its own language's rule picks and
// it lacks (#1029): Element's English `{ other }` under counterpart,
// which picks `one` at 1. One finding on the source file each, which
// names the translations that lack it too; theirs are kept, marked.
type SourceGaps = Map<string, Finding>;
const lackingToo = new WeakMap<Finding, string[]>();
const gapKey = (sourceFile: string, key: string, message: string) =>
  `${sourceFile}\u0000${key}\u0000${message}`;

function sourceGaps(
  entry: StringEntry,
  at: {
    sourceFile: string;
    sourceLanguage: string;
    library: Library;
    richText: TextReading | undefined;
    gaps: SourceGaps;
    // A gettext source's msgid and msgid_plural pairs, the two forms
    // gettext picks between by n == 1 in any language: no category of
    // the language's own is theirs to lack.
    pairs?: ReadonlySet<string>;
    // The ids said as a source that does not parse, once each, whether
    // or not a target translates them (#1115).
    brokenSources?: Set<string>;
  },
): Finding[] {
  // The source against its own language's rule: no sourceLanguage, which
  // would ask of a language of its base the source's own categories.
  const result = validateTranslation(
    entry.source,
    entry.source,
    at.sourceLanguage,
    at.library,
    {
      richText: at.richText,
      ...(entry.arguments && { arguments: entry.arguments }),
      ...(entry.pluralForms?.[at.sourceLanguage] && {
        pluralForms: entry.pluralForms[at.sourceLanguage],
      }),
      ...(entry.pluralRules && { pluralRules: entry.pluralRules }),
      ...(entry.placeholders && { placeholders: entry.placeholders }),
      ...(at.library === "fluent" &&
        isFluentTermId(entry.id) && { term: true }),
    },
  );
  const out: Finding[] = [];
  const broken = result.ok
    ? undefined
    : result.errors.find(
        (error) => error.code === "invalid-icu" && error.where === "source",
      );
  if (broken && at.brokenSources && !at.brokenSources.has(entry.id)) {
    at.brokenSources.add(entry.id);
    out.push({
      file: at.sourceFile,
      key: entry.id,
      language: at.sourceLanguage,
      code: broken.code,
      severity: "invalid",
      message: describe(broken, at.library),
    });
  }
  if (at.pairs?.has(entry.id)) return out;
  for (const error of result.incomplete ?? []) {
    if (error.code !== "missing-category") continue;
    const message = describe(error, at.library);
    const finding: Finding = {
      file: at.sourceFile,
      key: entry.id,
      language: at.sourceLanguage,
      code: error.code,
      severity: "incomplete",
      message: message.replace(/ in its language$/, ` in ${at.sourceLanguage}`),
    };
    at.gaps.set(gapKey(at.sourceFile, entry.id, message), finding);
    lackingToo.set(finding, []);
    out.push(finding);
  }
  return out;
}

type Terms = ReturnType<typeof fluentTerms>;

// Per language, the terms its files define across every fluent source,
// the first definition of a name kept, read once a language.
function termsOf(
  cwd: string,
  config: CorpusConfig,
): (language: string) => Terms {
  const read = new Map<string, Terms>();
  return (language) => {
    const known = read.get(language);
    if (known) return known;
    const merged: Terms = new Map();
    for (const source of config.sources) {
      if (source.adapter !== "fluent") continue;
      const abs = path.join(
        cwd,
        fileOf(source, language, config.sourceLanguage),
      );
      if (!existsSync(abs)) continue;
      try {
        for (const [name, term] of fluentTerms(readRepoText(abs)))
          if (!merged.has(name)) merged.set(name, term);
      } catch {
        // A file that does not read is its own finding.
      }
    }
    read.set(language, merged);
    return merged;
  };
}

// Per language, the terms of the files a pull would write from the
// instance's translations (#1200): a term is a string the instance
// holds, its draft taking the file's value's place, the file's
// attributes kept and a new file's term written without the source's.
// The source language's are its files', which pull never writes.
function pulledTermsOf(
  cwd: string,
  config: CorpusConfig,
  translations: Record<string, Record<string, string>>,
): (language: string) => Terms {
  const repository = termsOf(cwd, config);
  const read = new Map<string, Terms>();
  return (language) => {
    if (language === config.sourceLanguage) return repository(language);
    const known = read.get(language);
    if (known) return known;
    const merged: Terms = new Map();
    const held = translations[language] ?? {};
    for (const source of config.sources) {
      if (source.adapter !== "fluent") continue;
      if (!takesLanguage(source, config, language)) continue;
      const templatePath = path.join(
        cwd,
        fileOf(source, config.sourceLanguage, config.sourceLanguage),
      );
      const abs = path.join(
        cwd,
        fileOf(source, language, config.sourceLanguage),
      );
      try {
        const template = readRepoText(templatePath);
        const existing = existsSync(abs) ? readRepoText(abs) : undefined;
        const drafts: Record<string, string> = {};
        for (const [name] of fluentTerms(template)) {
          const draft = held[namespaced(source, name)];
          if (draft !== undefined && !isBlank(draft)) drafts[name] = draft;
        }
        const text =
          Object.keys(drafts).length === 0
            ? existing
            : entriesToFluent(template, drafts, existing);
        if (text === undefined) continue;
        for (const [name, term] of fluentTerms(text))
          if (!merged.has(name)) merged.set(name, term);
      } catch {
        // A file that does not read is its own finding.
      }
    }
    read.set(language, merged);
    return merged;
  };
}

// What Fluent renders otherwise than the translation means, which no
// check of the string alone sees (#1033): an argument the locale's term
// never reads where it reads others, which Fluent ignores, Indonesian's
// `kapitalisasi` for `capitalization`, and a select on an attribute the
// term does not define there, which renders the default variant. A term
// that reads no variable is the same text whatever is passed, as
// Czech's brand names are, declined in none. The locale's own
// definition is read, else the source's.
function termWarnings(
  target: string,
  at: {
    file: string;
    key: string;
    language: string;
    own: Terms;
    source: Terms;
  },
): Finding[] {
  const text = target.replace(/\{"(?:[^"\\\n]|\\.)*"\}/g, "");
  const termOf = (name: string) => at.own.get(name) ?? at.source.get(name);
  const out: Finding[] = [];
  const warn = (code: Finding["code"], message: string) =>
    out.push({
      file: at.file,
      key: at.key,
      language: at.language,
      code,
      severity: "warning",
      message,
    });
  for (const call of text.matchAll(
    /\{\s*(-[A-Za-z][\w-]*)\(((?:[^()"\n]|"(?:[^"\\\n]|\\.)*")*)\)\s*\}/g,
  )) {
    const term = termOf(call[1]!);
    if (!term || term.variables.size === 0) continue;
    const args = call[2]!.replace(/"(?:[^"\\\n]|\\.)*"/g, "");
    for (const arg of args.matchAll(/([A-Za-z][\w-]*)\s*:/g))
      if (!term.variables.has(arg[1]!))
        warn(
          "unknown-term-argument",
          `${call[1]} reads no argument ${arg[1]} in this language, so Fluent renders it as if none were passed`,
        );
  }
  for (const select of text.matchAll(
    /\{\s*(-[A-Za-z][\w-]*)\.([A-Za-z][\w-]*)\s*,\s*select\s*,/g,
  )) {
    const term = termOf(select[1]!);
    if (term && !term.attributes.has(select[2]!))
      warn(
        "unknown-term-attribute",
        `${select[1]} has no .${select[2]} in this language, so Fluent renders the default variant`,
      );
  }
  return out;
}

// A gettext source file's msgid and msgid_plural pairs, read from the
// file rather than guessed from the text, which an ICU plural a msgid
// writes may share; none for any other source.
function pairsOf(
  cwd: string,
  source: FileSource,
  sourceFile: string,
): ReadonlySet<string> | undefined {
  if (source.adapter !== "gettext") return undefined;
  try {
    // The ids as the reader writes them, a namespace's prefix included.
    const ids = gettextPluralIds(readRepoText(path.join(cwd, sourceFile)));
    return new Set([...ids].map((id) => namespaced(source, id)));
  } catch {
    return undefined;
  }
}

// The source's line names the translations that lack its category too,
// eight of them, the rest counted.
function withLackingToo(finding: Finding): Finding {
  const languages = lackingToo.get(finding);
  if (!languages || languages.length === 0) return finding;
  const named = languages.slice(0, 8).join(", ");
  const more = languages.length > 8 ? `, and ${languages.length - 8} more` : "";
  return {
    ...finding,
    message: `${finding.message}; ${languages.length} translation(s) lack it too (${named}${more})`,
  };
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
    gaps?: SourceGaps;
  },
): Finding[] {
  const { file, key, language, library } = at;
  const result = validateTranslation(entry.source, target, language, library, {
    richText: at.richText,
    ...(entry.arguments && { arguments: entry.arguments }),
    ...(entry.pluralForms?.[language] && {
      pluralForms: entry.pluralForms[language],
    }),
    ...(entry.pluralShared?.[language] && {
      pluralShared: entry.pluralShared[language],
    }),
    ...(entry.pluralAsForms && { pluralAsForms: true }),
    ...(entry.pluralRules && { pluralRules: entry.pluralRules }),
    ...(entry.placeholders && { placeholders: entry.placeholders }),
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
    severity:
      error.code === "unpassed-selector" ||
      error.code === "chrome-dollar" ||
      error.code === "wide-exact" ||
      error.code === "fixed-count"
        ? "warning"
        : "incomplete",
    message: describe(error, library),
  }));
  // A category the source lacks too is the source's finding (#1029).
  for (const finding of findings) {
    if (finding.code !== "missing-category") continue;
    const gap = at.gaps?.get(gapKey(at.sourceFile, key, finding.message));
    if (!gap) continue;
    finding.sourceLacks = true;
    lackingToo.get(gap)?.push(language);
  }
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
