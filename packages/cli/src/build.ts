import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import {
  androidDirOf,
  androidToEntries,
  fluentToEntries,
  gettextToEntries,
  xcstringsToEntries,
  xcstringsTranslations,
  qtTsToEntries,
  qtShortForms,
  qtTsTranslations,
  yamlToEntries,
  yamlTranslations,
  yamlPluralIds,
  gettextPluralCategories,
  gettextSuggestions,
  gettextTranslations,
  xliffToEntries,
  xliffTranslations,
  isBlank,
  messagesToEntries,
  pluralBranches,
  pluralObjectIds,
  suffixPluralIds,
  type PluralObjects,
  RAILS_I18N_VERSION,
  RAILS_PLURALS,
  stripBom,
  tableToEntries,
} from "@corpus/adapters";
import {
  entitySchema,
  libraryOf,
  sameMessage,
  isFluentTermId,
  WHOLE_PLURAL_LIBRARIES,
  tagMode,
  richTextFor,
  isHtml,
  messageKind,
  nestedCountsOf,
  bareAtOf,
  parseIcu,
  proseTagsOf,
  pluralCategoriesOf,
  snapshotSchema,
  stringEntrySchema,
  glossaryFileSchema,
  type CorpusConfig,
  type Entity,
  type Glossary,
  type Snapshot,
  type Library,
  type Source,
  type StringEntry,
  type WritableSource,
  refusalAdvice,
  refusalCause,
  type RefusalCause,
} from "@corpus/contract";
import type { Refusals } from "./agent-tools";
import { printable } from "./printable";
import { unreadableFile } from "./catalogue-format";
import { CliError, fileCodeOf } from "./config";

type Sourced = { entry: StringEntry; file: string };
// `hint` is the advice clause, kept apart from the message so refusals
// can be grouped by what caused them (#491).
export type Refused = {
  file: string;
  id: string;
  message: string;
  hint: string;
  // What it is put down to, when the advice says (#549).
  cause?: RefusalCause;
  // Its type, where the type read as HTML would take it: an unclosed
  // tag or a lone <br> as text (#952).
  htmlType?: string;
};
export type BuildReport = {
  snapshot: Snapshot;
  refused: Refused[];
  // What the build wants said that is not a refusal: a file whose empty
  // values took the key as the text (#589).
  notes: string[];
  // Each string's source-language file, or `exec:<command>` (#1074).
  origin: Map<string, string>;
};
// What an exporter says the repository already holds for its strings
// (§3, §8): per target language, id to text; taken as seeds once the
// snapshot's ids are known.
type ExecSeeds = {
  command: string;
  translations: Record<string, Record<string, string>>;
  // The ids the exporter marks translated though their text is the
  // source's (#658).
  translated: Record<string, string[]>;
};
// A translation is its text, or `{ text, state: "translated" }` for one
// the exporter says is done whatever its text: a loanword (#658).
const execTranslation = z.union([
  z.string(),
  z.object({ text: z.string(), state: z.literal("translated").optional() }),
]);
export const execTranslationsSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    execTranslation.transform((t) => (typeof t === "string" ? t : t.text)),
  ),
);
const execStatesSchema = z.record(
  z.string(),
  z.record(z.string(), execTranslation),
);

function translatedIds(raw: unknown): Record<string, string[]> {
  const parsed = execStatesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).map(([lang, texts]) => [
      lang,
      Object.entries(texts)
        .filter(([, t]) => typeof t === "object" && t.state === "translated")
        .map(([id]) => id),
    ]),
  );
}

// The strict build: a refused entry fails it, for a caller that wants
// the whole catalogue or nothing.
export async function buildSnapshot(
  config: CorpusConfig,
  cwd: string,
): Promise<Snapshot> {
  const { snapshot, refused } = await buildSnapshotReport(config, cwd);
  if (refused.length > 0) {
    throw new CliError(
      `snapshot build failed:\n  ${refused.map(describeRefused).join("\n  ")}`,
    );
  }
  return snapshot;
}

// Refusals this many of them deep that carry advice are one cause
// rather than that many: a mistyped library, or a tag left open in
// five strings. Below it, a refusal is a string's own problem and the
// build goes on without it.
const SAME_CAUSE = 5;

// Why the build should stop rather than push what parsed (#491).
// Pushing the rest archives every refused id, and a pending proposal on
// an archived string is superseded, which no later push reverses.
//
// Two shapes say a file is being read wrongly rather than holding a
// typo: every entry of a file refused, and many refusals across the
// snapshot that carry advice. The second is the one that
// catches a real project — Outline read as ICU refuses 365 of 1,920
// strings, a fifth of the catalogue, but 363 of those say "declare
// library: i18next".
function ruinedReasons(sourced: Sourced[], refused: Refused[]): string[] {
  const reasons: string[] = [];
  const total = new Map<string, number>();
  for (const { file } of sourced) total.set(file, (total.get(file) ?? 0) + 1);
  const perFile = new Map<string, number>();
  for (const { file } of refused) {
    perFile.set(file, (perFile.get(file) ?? 0) + 1);
    total.set(file, (total.get(file) ?? 0) + 1);
  }
  for (const [file, count] of perFile) {
    if (count === (total.get(file) ?? count)) {
      reasons.push(`${file}: every string in the file was refused (${count})`);
    }
  }
  // Refusals are counted per cause, not per advice text (#549): five
  // tags left open in five strings are one cause whatever their names,
  // and a catalogue read under the wrong library is one cause whichever
  // of the two library advices each string drew. Four of one cause and
  // one of another stop nothing.
  const byCause = new Map<RefusalCause, Refused[]>();
  for (const refusal of refused) {
    if (!refusal.cause) continue;
    byCause.set(refusal.cause, [
      ...(byCause.get(refusal.cause) ?? []),
      refusal,
    ]);
  }
  for (const [cause, group] of byCause) {
    if (group.length < SAME_CAUSE) continue;
    const advices = new Set(group.map((r) => r.hint));
    const one =
      advices.size === 1 ? ` — ${group[0]!.hint.replace(/^;\s*/, "")}` : "";
    reasons.push(
      cause === "library"
        ? `${group.length} strings were refused for the library they were read under, at or past the ${SAME_CAUSE} that stops a build: one cause${one || ", whichever advice each drew; each refusal above says which library to declare"}`
        : `${group.length} strings were refused for a rich-text tag written as prose, at or past the ${SAME_CAUSE} that stops a build: one cause${one || "; each refusal above says how to write it"}`,
    );
  }
  return reasons;
}

// A build stopped by its refusals, which it still carries (#1011).
export class RuinedBuild extends CliError {
  constructor(
    readonly refused: Refused[],
    message: string,
  ) {
    super(message);
  }
}

// What the build refuses, as an agent's tools say it (#1011): read once
// a process, the first time it is asked for, so a session sees the
// repository as it was then; a build that fails for another reason
// refuses nothing it can name.
export function refusalsIn(config: CorpusConfig, cwd: string): Refusals {
  let read: ReturnType<Refusals> | undefined;
  return () =>
    (read ??= (async () => {
      let refused: Refused[];
      try {
        refused = (await buildSnapshotReport(config, cwd)).refused;
      } catch (error) {
        if (!(error instanceof RuinedBuild)) return undefined;
        refused = error.refused;
      }
      return refused.map((entry) => ({
        id: entry.id,
        reason: describeRefused(entry),
      }));
    })());
}

export function describeRefused({ file, id, message }: Refused): string {
  return `${file} [${printable(id)}]: ${message}`;
}

// Reads the configured sources, feeds the pure adapters (and custom exec
// exporters), and assembles a corpus/1 envelope validated locally before
// any upload (§3, §8). A source string that does not parse is refused by
// entry; anything else that fails, a file that will not read, a
// duplicate id, an exporter that exits non-zero, fails the build.
export async function buildSnapshotReport(
  config: CorpusConfig,
  cwd: string,
  // Whether the snapshot is for a push, which the refusal names.
  pushing = false,
): Promise<BuildReport> {
  const jiti = createJiti(import.meta.url);
  const sourced: Sourced[] = [];
  const entities: Entity[] = [];
  const execSeeds: ExecSeeds[] = [];
  const errors: string[] = [];
  const refused: Refused[] = [];
  const notes: string[] = [];

  for (const source of config.sources) {
    if (source.adapter === "exec") {
      collectExec(
        source.command,
        cwd,
        sourced,
        entities,
        execSeeds,
        errors,
        refused,
        config.richText,
        notes,
      );
      continue;
    }
    // Push reads the source-language file; a table path may carry {lang}
    // too when its translations are pulled back per language (§8).
    const file = fileOf(source, config.sourceLanguage, config.sourceLanguage);
    if (!existsSync(path.join(cwd, file))) {
      errors.push(`source file ${file} does not exist`);
      continue;
    }
    let entries: StringEntry[];
    const skipped: string[] = [];
    try {
      entries = await readEntries(
        jiti,
        cwd,
        file,
        source,
        true,
        config.sourceLanguage,
        // A message the source's file holds that Corpus cannot read is
        // refused by itself, as a string that does not parse is (#991).
        (id, reason) =>
          refused.push({
            file,
            id,
            hint: "",
            message: `invalid ${source.adapter === "fluent" ? "Fluent message" : "entry"}: ${reason ?? "not read"}`,
          }),
        undefined,
        (id) => skipped.push(id),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: ${message}`);
      continue;
    }
    // A string later set to null leaves the snapshot, and push archives
    // it: said, so that is never silent (#1026).
    if (skipped.length > 0)
      notes.push(
        `${file}: ${skipped.length} value(s) are no string (a number, true, false or null) and are not read (${skipped
          .slice(0, 3)
          .map(printable)
          .join(", ")}${skipped.length > 3 ? ", …" : ""})`,
      );
    // The file rides with the entry (§4) so a proposal can come back to
    // it, and only where pull can write it: a .ts catalogue carries none,
    // so a proposal on its strings is refused up front, not left pending.
    const writable = takesProposals(source);
    // A msgid is its key by nature, not an empty value (#718), and so is
    // a String Catalog key with no source-language unit (#727).
    const keyed =
      source.adapter === "gettext" ||
      source.adapter === "xcstrings" ||
      source.adapter === "qt-ts"
        ? 0
        : entries.filter((entry) => entry.keyIsText).length;
    if (keyed > 0) {
      notes.push(
        `${file}: ${keyed} string(s) have an empty value and take the key as the text; a proposal on them is refused, since the text is the key`,
      );
    }
    // i18next reads a `</br>` no `<br>` opens as text, which `Trans`
    // renders as nothing and `t()` as the letters: a source defect to
    // name, never to refuse (#986).
    if (sourceLibrary(source) === "i18next") {
      const stray = entries.filter((e) =>
        proseTagsOf(e.source, "i18next").some(
          (t) => t.close && t.name.toLowerCase() === "br",
        ),
      );
      if (stray.length > 0)
        notes.push(
          `${file}: ${stray.length} string(s) write a </br> no <br> opens, which renders as nothing or as its letters; write <br/> (${stray
            .slice(0, 3)
            .map((e) => printable(e.id))
            .join(", ")}${stray.length > 3 ? ", …" : ""})`,
        );
    }
    // A family's keys were strings of their own before 0.22 (#985).
    if (readsSuffixPlurals(source)) {
      const families = suffixPluralIds(
        await readModule(jiti, path.join(cwd, file)),
        config.sourceLanguage,
      );
      if (families.size > 0) {
        const [first] = families;
        notes.push(
          `${file}: ${families.size} i18next plural famil${families.size === 1 ? "y" : "ies"} read as one string each (${printable(first!)}_<category> → ${printable(first!)})`,
        );
      }
    }
    const pluralForms = pluralFormsOf(cwd, source, config, (note) => {
      if (!notes.includes(note)) notes.push(note);
    });
    for (const entry of entries) {
      validateEntry(
        {
          ...entry,
          ...withPluralForms(entryPluralForms(entry, source, pluralForms)),
          ...namedPluralRules(source),
          // A key-is-text entry carries no file: a proposal would rewrite
          // the key, which is the code's, not the catalogue's.
          ...(writable && !entry.keyIsText ? { file } : {}),
          ...libraryFields(source),
          // An entry that names its own library keeps it: a Rails
          // catalogue's `*_MF` keys are ICU (#752).
          ...(entry.library && {
            library: entry.library,
            syntax: entry.library,
          }),
        },
        file,
        sourced,
        refused,
        config.richText,
        notes,
      );
    }
  }

  // An id in two files of one source is one string when its text is the
  // same in both (#661): Element merges its app's and its shared
  // components' catalogues at runtime. Anywhere else a duplicate is an
  // error.
  const groupOf = new Map<string, number>();
  const laterWins = new Set<string>();
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    const group = "group" in source ? source.group : undefined;
    const file = fileOf(source, config.sourceLanguage, config.sourceLanguage);
    if (typeof group === "number") groupOf.set(file, group);
    if (lastWins(source)) laterWins.add(file);
  }
  const byId = new Map<string, Sourced>();
  const merged = new Set<Sourced>();
  for (const item of sourced) {
    const { entry, file } = item;
    const prev = byId.get(entry.id);
    if (!prev) {
      byId.set(entry.id, item);
      continue;
    }
    const oneSource =
      groupOf.has(file) && groupOf.get(file) === groupOf.get(prev.file);
    if (oneSource && prev.entry.source === entry.source) {
      // The copy that can take a proposal is the one kept: a key-is-text
      // copy carries no file.
      if (!prev.entry.file && entry.file) {
        merged.add(prev);
        byId.set(entry.id, item);
      } else merged.add(item);
    } else if (oneSource && laterWins.has(file)) {
      merged.add(prev);
      byId.set(entry.id, item);
      notes.push(
        `${printable(entry.id)} reads otherwise in ${prev.file} and ${file}: the later file's is the source, as merge: "last-wins" says`,
      );
    } else
      errors.push(
        `duplicate id ${printable(entry.id)} in ${prev.file} and ${file}${oneSource ? ", with different text" : ""}`,
      );
  }
  if (merged.size > 0) {
    const kept = sourced.filter((item) => !merged.has(item));
    sourced.length = 0;
    sourced.push(...kept);
  }

  // The declarations travel with the snapshot (§4): the server renders
  // and validates metadata from them without reading the config.
  const sources = writableSources(config);
  const glossary = readGlossary(config, cwd, errors);
  const seedTranslations = await readSeeds(
    jiti,
    config,
    cwd,
    new Set(sourced.map((s) => s.entry.id)),
    execSeeds,
    errors,
    notes,
    new Set(refused.map((r) => r.id)),
  );
  // A mark counts only for a seed that is there to import.
  const seedTranslated: Record<string, string[]> = {};
  for (const { translated } of execSeeds)
    for (const [lang, ids] of Object.entries(translated)) {
      const kept = ids.filter(
        (id) => seedTranslations[lang]?.[id] !== undefined,
      );
      if (kept.length > 0) (seedTranslated[lang] ??= []).push(...kept);
    }
  // An XLIFF target marked translated, or a gettext msgstr neither empty
  // nor fuzzy, whose text is the source's, the same message (#1009), is
  // a translation, not work (#658, #710, #718): only such targets are
  // seeds.
  for (const source of config.sources) {
    if (source.adapter === "exec" || !STATED_TARGETS.has(source.adapter))
      continue;
    const file = fileOf(source, config.sourceLanguage, config.sourceLanguage);
    for (const { entry } of sourced.filter((s) => s.file === file))
      for (const [lang, texts] of Object.entries(seedTranslations))
        if (
          texts[entry.id] !== undefined &&
          sameMessage(
            entry.source,
            texts[entry.id]!,
            entry.library ?? sourceLibrary(source),
          )
        )
          (seedTranslated[lang] ??= []).push(entry.id);
  }
  const seedSuggestions = readSuggestions(
    config,
    cwd,
    new Set(sourced.map((s) => s.entry.id)),
    seedTranslations,
    notes,
  );
  const snapshot = {
    contract: "corpus/1" as const,
    project: config.project,
    sourceLanguage: config.sourceLanguage,
    strings: sourced.map((s) => s.entry),
    entities,
    ...(config.stringTypes && { stringTypes: config.stringTypes }),
    ...(config.entityTypes && { entityTypes: config.entityTypes }),
    typeNotes: config.typeNotes ?? {},
    richText: config.richText ?? {},
    glossary,
    ...(Object.keys(seedTranslations).length > 0 && { seedTranslations }),
    ...(Object.keys(seedTranslated).length > 0 && { seedTranslated }),
    ...(Object.keys(seedSuggestions).length > 0 && { seedSuggestions }),
    // Always sent, so a config that drops a variant drops it on the
    // server too (#658).
    sourceVariants: config.sourceVariants ?? [],
    // Always sent, empty included, so the server can tell "nothing
    // writable" from a push that predates the field (§4).
    sources,
  };

  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (errors.length > 0) {
    throw new CliError(`snapshot build failed:\n  ${errors.join("\n  ")}`);
  }
  // A whole file refused is a misread file, not a typo (#491): pushing
  // the rest would archive every string it holds, and a pending
  // proposal on an archived string is superseded, which no later push
  // reverses. One bad entry among many still goes on without it.
  const ruined = ruinedReasons(sourced, refused);
  if (ruined.length > 0) {
    // Every refusal is listed, not only those of the ruined file: a
    // build that stops should say everything it found, and the hints
    // live in these lines.
    throw new RuinedBuild(
      refused,
      [
        "snapshot build failed:",
        ...refused.map((entry) => `  ${describeRefused(entry)}`),
        ...richTextAdvice(refused).map((advice) => `  ${advice}`),
        ...ruined.map((reason) => `  ${reason}`),
        `  ${pushing ? "nothing was pushed" : "no snapshot was built"}: pushing the rest would archive every refused string`,
      ].join("\n"),
    );
  }
  return {
    snapshot: parsed.data as Snapshot,
    refused,
    notes: [...richTextAdvice(refused), ...notes],
    origin: new Map(sourced.map((s) => [s.entry.id, s.file])),
  };
}

// A Fluent term (`-brand`), under its namespace or not: a string where
// the source defines it (#990), the locale's own where only a target
// does.
export function isFluentTerm(source: FileSource, id: string): boolean {
  return source.adapter === "fluent" && isFluentTermId(id);
}

// Whether the patterns of a source take the later one's text for an id
// two of them hold, as an app that merges them in order does (#953).
export function lastWins(source: Source): boolean {
  return "merge" in source && source.merge === "last-wins";
}

// A type as a config object's key: bare where it can be.
export function configKey(type: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(type) ? type : JSON.stringify(type);
}

// One line per type whose refused strings its reading as HTML would
// take (#952), naming the declaration that does.
export function richTextAdvice(refused: Refused[]): string[] {
  const byType = new Map<string, number>();
  for (const { htmlType } of refused)
    if (htmlType) byType.set(htmlType, (byType.get(htmlType) ?? 0) + 1);
  return [...byType].map(
    ([type, count]) =>
      `${count} refused ${type} string(s) hold tags a type read as HTML takes as text, an unclosed tag or a lone <br>: if the app renders ${type} as HTML, declare richText: { ${configKey(type)}: "html" } in the config`,
  );
}

// A vue-i18n `@` that opens no link (#1017), said to the author.
export const BARE_AT_MESSAGE =
  "an @ that opens no link does not compile in vue-i18n, which then shows the message raw; write {'@'}";

// A `#` in a select within a plural, said of a source by build and
// validate and of a translation by validate (#767).
export function nestedCountMessage(arg: string): string {
  return `# in a select within the plural on {${arg}} is text to some runtimes; write {${arg}}`;
}

function validateEntry(
  entry: StringEntry,
  file: string,
  sourced: Sourced[],
  refused: Refused[],
  richText: CorpusConfig["richText"],
  notes: string[],
): void {
  const syntax = libraryOf(entry);
  const reading = richTextFor(entry.type, entry.id, syntax, richText);
  const icu = parseIcu(entry.source, syntax, {
    html: tagMode(syntax, reading),
  });
  if (icu.ok) {
    sourced.push({ entry, file });
    // An exec entry's file is its command, said as the command's own
    // lines say it.
    const where = file.startsWith("exec:")
      ? `exec "${file.slice("exec:".length)}" [${printable(entry.id)}]`
      : `${file}:${printable(entry.id)}`;
    for (const arg of nestedCountsOf(entry.source, syntax))
      notes.push(`${where}: ${nestedCountMessage(arg)}`);
    if (bareAtOf(entry.source, syntax))
      notes.push(`${where}: ${BARE_AT_MESSAGE}`);
  } else {
    const message = icu.errors[0]?.message ?? "";
    const advice = refusalAdvice(entry.source, syntax, message);
    const cause = refusalCause(entry.source, syntax, message);
    const html =
      !isHtml(reading) && parseIcu(entry.source, syntax, { html: "markup" }).ok;
    refused.push({
      file,
      id: entry.id,
      hint: advice,
      ...(cause ? { cause } : {}),
      ...(html && { htmlType: entry.type }),
      message: `invalid ${messageKind(syntax)}: ${message}${advice}`,
    });
  }
}

// What an exporter or importer may print: spawnSync's default is 1 MiB,
// which Ente's exporter (3.2 MB, 56 languages of seeds) and Documenso's
// (3.4 MB) both passed, dying as "exited null:" with nothing said (#554).
export const EXEC_MAX_BUFFER = 256 * 1024 * 1024;

export function describeExecFailure(
  command: string,
  result: {
    status: number | null;
    signal: NodeJS.Signals | null;
    stderr: string | null | undefined;
    error?: NodeJS.ErrnoException;
  },
  kind: "exec" | "import" = "exec",
): string {
  const name = `${kind} ${JSON.stringify(command)}`;
  if (result.error?.code === "ENOBUFS") {
    return `${name} printed more than ${EXEC_MAX_BUFFER / 1048576} MiB; ${kind === "exec" ? "the build reads an exporter's" : "pull reads an importer's"} whole output at once`;
  }
  if (result.signal) return `${name} was killed by ${result.signal}`;
  if (result.error) return `${name} could not run: ${result.error.message}`;
  return `${name} exited ${result.status}: ${result.stderr?.trim() ?? ""}`;
}

// An exporter's output, run once and parsed (§3); `validate` reads the
// same output for the translations it hands over (#560).
export type ExporterOutput = {
  strings?: unknown[];
  entities?: unknown[];
  translations?: unknown;
};

export function runExporter(
  command: string,
  cwd: string,
):
  | { ok: true; output: ExporterOutput; stderr: string }
  | { ok: false; error: string } {
  const result = spawnSync(command, {
    shell: true,
    cwd,
    encoding: "utf8",
    maxBuffer: EXEC_MAX_BUFFER,
  });
  if (result.status !== 0) {
    return { ok: false, error: describeExecFailure(command, result) };
  }
  try {
    return {
      ok: true,
      output: JSON.parse(result.stdout) as ExporterOutput,
      stderr: result.stderr ?? "",
    };
  } catch {
    return { ok: false, error: `exec "${command}" did not emit valid JSON` };
  }
}

// How much of an exporter's stderr is said: a converter's summary, not
// a tool's every warning.
const STDERR_LINES = 20;

function collectExec(
  command: string,
  cwd: string,
  sourced: Sourced[],
  entities: Entity[],
  execSeeds: ExecSeeds[],
  errors: string[],
  refused: Refused[],
  richText: CorpusConfig["richText"],
  notes: string[],
): void {
  const ran = runExporter(command, cwd);
  if (!ran.ok) {
    errors.push(ran.error);
    return;
  }
  // What an exporter says on stderr is its own account, skipped or
  // fuzzy entries (#659): said under its command, as pull says an
  // importer's.
  const said = ran.stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
  for (const line of said.slice(0, STDERR_LINES))
    notes.push(`exec "${command}": ${line}`);
  if (said.length > STDERR_LINES)
    notes.push(
      `exec "${command}": … and ${said.length - STDERR_LINES} more line(s) on stderr`,
    );
  const out = ran.output;
  for (const raw of out.strings ?? []) {
    const parsedEntry = stringEntrySchema.safeParse(raw);
    if (!parsedEntry.success) {
      errors.push(`exec "${command}" emitted an invalid string entry`);
      continue;
    }
    // An exporter's own `file` is dropped (§4): pull trusts the field to
    // pick what it rewrites, and an exec source is not rewritable.
    const entry = { ...parsedEntry.data };
    delete entry.file;
    validateEntry(entry, `exec:${command}`, sourced, refused, richText, notes);
  }
  for (const raw of out.entities ?? []) {
    const entity = entitySchema.safeParse(raw);
    if (!entity.success)
      errors.push(`exec "${command}" emitted an invalid entity`);
    else entities.push(entity.data);
  }
  if (out.translations !== undefined) {
    const translations = execTranslationsSchema.safeParse(out.translations);
    if (translations.success) {
      execSeeds.push({
        command,
        translations: translations.data,
        translated: translatedIds(out.translations),
      });
    } else {
      errors.push(
        `exec "${command}" emitted invalid translations: a map of language to id to text, or to { text, state: "translated" }`,
      );
    }
  }
}

// A source's library travels under both names until 1.0 (§4): a server
// older than the field still reads a newer CLI's push correctly.
function libraryFields(source: FileSource): {
  library?: Library;
  syntax?: Library;
} {
  const library = sourceLibrary(source);
  return library === "icu" ? {} : { library, syntax: library };
}

export type FileSource = Exclude<Source, { adapter: "exec" }>;

export function sourceLibrary(source: FileSource): Library {
  if (source.adapter === "android") return "android";
  // gettext's msgids are C's format strings unless the source says else.
  if (source.adapter === "gettext" || source.adapter === "xcstrings")
    return source.library ?? "printf";
  if (source.adapter === "qt-ts") return source.library ?? "qt";
  if (source.adapter === "yaml") return source.library ?? "rails";
  if (source.adapter === "fluent") return "fluent";
  return source.adapter === "xliff" ? "icu" : libraryOf(source);
}

// The file a source keeps a language in: its pattern with {lang}
// filled, or, for Android, the `values` directory of the language.
export function fileOf(
  source: FileSource,
  language: string,
  sourceLanguage: string,
): string {
  if (
    (source.adapter === "xliff" ||
      source.adapter === "gettext" ||
      source.adapter === "qt-ts") &&
    source.sourcePath &&
    language === sourceLanguage
  )
    return source.sourcePath;
  // A String Catalog holds every language in its one file (#727).
  if (source.adapter === "xcstrings") return source.path;
  if (source.adapter !== "android")
    return source.path.replaceAll("{lang}", fileCodeOf(source, language));
  const dir =
    language === sourceLanguage
      ? "values"
      : (source.languageDirs?.[language] ?? androidDirOf(language));
  return path.posix.join(source.path, dir, "strings.xml");
}

// A `{ one, other }` object is one plural string (#662) where the
// library's text can carry one read whole: not vue, whose plurals are
// pipes, nor Chrome's entries; under i18next, only one of two forms or
// more (#984).
export function readsPluralObjects(source: FileSource): PluralObjects {
  if (source.adapter !== "messages") return false;
  const library = libraryOf(source);
  if (library === "i18next") return "several";
  return (
    library === "icu" ||
    library === "formatjs" ||
    WHOLE_PLURAL_LIBRARIES.has(library)
  );
}

// i18next's plural keys, `item_one` beside `item_other`, are one plural
// string `item`, as `t("item", { count })` reads them (#985).
export function readsSuffixPlurals(source: FileSource): boolean {
  return source.adapter === "messages" && libraryOf(source) === "i18next";
}

// The language a gettext target file is for, as the config names it:
// its {lang} read back from the path, a `languageFiles` code (#657)
// turned back into its tag, for the plural rules (`sr@latin` is sr-Latn).
function languageOfFile(
  file: string,
  source: { path: string; languageFiles?: Record<string, string> },
): string {
  // A `{lang}` written twice holds one code (#856).
  const [first = "", ...rest] = source.path
    .split("{lang}")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const code =
    new RegExp(`^${first}(?<lang>.+?)${rest.join("\\k<lang>")}$`).exec(file)
      ?.groups?.lang ?? file;
  return (
    Object.entries(source.languageFiles ?? {}).find(
      ([, c]) => c === code,
    )?.[0] ?? code
  );
}

// Whether a source keeps a file per language, and so takes
// translations back.
export function hasLanguages(source: FileSource): boolean {
  return (
    source.adapter === "android" ||
    source.adapter === "xcstrings" ||
    source.path.includes("{lang}")
  );
}

// The adapters that write their own format back; messages and table
// write back only a JSON catalogue (§8).
const OWN_FORMAT = new Set<FileSource["adapter"]>([
  "android",
  "fluent",
  "xliff",
  "gettext",
  "xcstrings",
  "qt-ts",
  "yaml",
]);

// The adapters whose keys are the code's own (a msgid, a String Catalog
// key, a `tr()` literal): no proposal is taken on their strings (#719,
// #728, #741).
export const CODE_KEYED_ADAPTERS = ["gettext", "xcstrings", "qt-ts"] as const;
type CodeKeyed = (typeof CODE_KEYED_ADAPTERS)[number];
const CODE_KEYED = new Set<FileSource["adapter"]>(CODE_KEYED_ADAPTERS);

// The adapters whose target file says which translations are done, so
// one identical to its source is a translation, not filler (#658, #710,
// #718, #727, #740).
const STATED_TARGETS = new Set<FileSource["adapter"]>([
  "xliff",
  "gettext",
  "xcstrings",
  "qt-ts",
]);

export function sourceWritesBack(source: FileSource): boolean {
  return OWN_FORMAT.has(source.adapter) || writesBack(source.path);
}

// A source a proposal can be written into (§11): one pull writes back,
// whose keys are not the code's.
export function takesProposals(source: FileSource): boolean {
  return sourceWritesBack(source) && !CODE_KEYED.has(source.adapter);
}

// A catalogue file through its source's adapter: the entries push would
// send for it, or, for a target file, the translations it holds.
// `sourceFile` is the source language's catalogue, where an empty value
// under a sentence key reads the key as the text (#589); a target's
// empty value is an untranslated row.
export async function readEntries(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  file: string,
  source: FileSource,
  sourceFile = false,
  // The language a file is read for, where one file holds them all
  // (xcstrings): a target's, or the source's, which the file must name.
  language?: string,
  // A translation the file holds that is not read, a Qt numerus form
  // no plural holds (#751). A Fluent message, a messages list or an
  // xliff unit Corpus cannot read, with why (#991, #1026).
  onUnread?: (id: string, reason?: string) => void,
  // The ids the source file holds as plural objects, as the file writes
  // them, where a target's object of categories is the plural though it
  // lacks `other` (#950): sourcePluralIds.
  pluralIds?: ReadonlySet<string>,
  // A messages value that is no string, a null, number or boolean.
  onSkipped?: (id: string) => void,
): Promise<StringEntry[]> {
  const typed = <T>(entries: T[]) =>
    entries.map((e) => ({ ...e, type: source.type }));
  const own = (id: string) =>
    source.namespace ? `${source.namespace}:${id}` : id;
  const text = () => readFileSync(path.join(cwd, file), "utf8");
  switch (source.adapter) {
    case "xcstrings":
      return sourceFile
        ? xcstringsToEntries(text(), {
            type: source.type,
            ...(language !== undefined && { sourceLanguage: language }),
          })
        : typed(xcstringsTranslations(text(), language ?? ""));
    case "android": {
      const entries = androidToEntries(text(), { type: source.type });
      // A `{ns}` module's ids are its own (#989).
      return source.namespace
        ? entries.map((e) => ({ ...e, id: `${source.namespace}:${e.id}` }))
        : entries;
    }
    case "gettext":
      return sourceFile
        ? gettextToEntries(text(), { type: source.type })
        : typed(gettextTranslations(text(), languageOfFile(file, source)));
    case "yaml": {
      // The root key is the file's own code for its language (`pt_BR`).
      const tag = sourceFile
        ? (language ?? languageOfFile(file, source))
        : languageOfFile(file, source);
      const root = fileCodeOf(source, tag);
      return sourceFile
        ? yamlToEntries(text(), { type: source.type, root })
        : typed(yamlTranslations(text(), root, pluralIds));
    }
    case "qt-ts":
      return sourceFile
        ? qtTsToEntries(text(), {
            type: source.type,
            ...(language !== undefined && { language }),
          })
        : typed(
            qtTsTranslations(text(), languageOfFile(file, source), onUnread),
          );
    case "xliff":
      return sourceFile
        ? xliffToEntries(text(), {
            type: source.type,
            onRefused: (id, reason) => onUnread?.(id, reason),
          })
        : typed(
            xliffTranslations(text(), (id, reason) => onUnread?.(id, reason)),
          );
    case "fluent": {
      const entries = fluentToEntries(text(), {
        type: source.type,
        onRefused: (id, reason) => onUnread?.(own(id), reason),
      });
      return entries.map((e) => ({ ...e, id: own(e.id) }));
    }
  }
  const data = await readModule(
    jiti,
    path.join(cwd, file),
    source.adapter === "table" ? source.export : undefined,
  );
  const entries =
    source.adapter === "messages"
      ? messagesToEntries(data, {
          type: source.type,
          arb: isArb(file),
          chrome: libraryOf(source) === "chrome",
          keyIsText: sourceFile,
          plurals: readsPluralObjects(source),
          suffixPlurals: readsSuffixPlurals(source),
          ...(sourceFile &&
            language !== undefined && { sourceLanguage: language }),
          ...(pluralIds && { pluralIds }),
          onRefused: (id, reason) => onUnread?.(own(id), reason),
          ...(onSkipped && { onSkipped: (id: string) => onSkipped(own(id)) }),
        })
      : tableToEntries(data, { type: source.type, map: source.map });
  // A namespaced file's ids are `ns:key` (#513), i18next's own separator.
  return source.namespace
    ? entries.map((entry) => ({
        ...entry,
        id: `${source.namespace}:${entry.id}`,
      }))
    : entries;
}

// What a target file holds that Corpus cannot read, in a note or a
// warning: a Fluent message, a Qt numerus form, a messages list or an
// xliff unit (#991, #751, #1026).
export function unreadKind(source: FileSource): string {
  if (source.adapter === "fluent") return "a message Corpus cannot read";
  if (source.adapter === "qt-ts")
    return "a numerus form Corpus cannot read as one plural";
  return "an entry Corpus cannot read";
}

// Per target language, the plural categories a source's runtime picks
// where they are not the language's CLDR ones: a gettext file's
// `Plural-Forms` (#951), rails-i18n's rule for a Rails catalogue (#983).
export function pluralFormsOf(
  cwd: string,
  source: FileSource,
  config: CorpusConfig,
  onNote?: (note: string) => void,
): Record<string, string[]> | undefined {
  const own =
    source.adapter === "gettext"
      ? gettextPluralForms(cwd, source, config)
      : source.adapter === "yaml" && sourceLibrary(source) === "rails"
        ? railsPluralForms(cwd, source, config, onNote)
        : undefined;
  return own;
}

const withPluralForms = (forms: Record<string, string[]> | undefined) =>
  forms ? { pluralForms: forms } : {};

// A source's plural rule by name, which its entries carry (#1018, #961).
export function namedPluralRules(source: FileSource): {
  pluralRules?: "default" | "cldr";
} {
  const rules = (source as { pluralRules?: unknown }).pluralRules;
  return rules === "default" || rules === "cldr" ? { pluralRules: rules } : {};
}

// An entry's plural forms, per language, in the source's own library:
// the file's (`pluralFormsOf`) for a text that is the plural, as a
// gettext or Rails plural is, never an ICU plural inside a msgid, which
// its formatter picks by CLDR; and over them the source's declared
// `pluralRules` for any plural it writes (#997).
export function entryPluralForms(
  entry: StringEntry,
  source: FileSource,
  own: Record<string, string[]> | undefined,
): Record<string, string[]> | undefined {
  if (entry.library !== undefined && entry.library !== sourceLibrary(source))
    return undefined;
  const rules = (source as { pluralRules?: unknown }).pluralRules;
  const declared =
    rules !== null && typeof rules === "object"
      ? (rules as Record<string, string[]>)
      : undefined;
  const forms = {
    ...(own && pluralBranches(entry.source) !== undefined && own),
    ...(declared && PLURAL_ARGUMENT_RE.test(entry.source) && declared),
  };
  return Object.keys(forms).length > 0 ? forms : undefined;
}

const PLURAL_ARGUMENT_RE = /\{\s*[^{},\s]+\s*,\s*plural\s*,/;

// Per target language, the plural keys rails-i18n registers for a Rails
// catalogue's locale, where the repository's Gemfile.lock lists the gem
// (#983): the file's root key as Ruby names the locale, else each parent
// before a `-`, as I18n's fallbacks reach them, else one and other,
// I18n's own rule. A locale the app gives a rule of its own, in
// config/initializers or config/locales, keeps CLDR's, which Corpus can
// read, as does every language of a repository without the gem; `zero`,
// which I18n picks for 0 wherever it is written, is allowed by the
// library (§5).
function railsPluralForms(
  cwd: string,
  source: FileSource,
  config: CorpusConfig,
  onNote?: (note: string) => void,
): Record<string, string[]> | undefined {
  let lock: string;
  try {
    lock = readFileSync(path.join(cwd, "Gemfile.lock"), "utf8");
  } catch {
    return undefined;
  }
  const version = /^ {4}rails-i18n \(([^)]+)\)$/m.exec(lock)?.[1];
  if (!version) return undefined;
  const own = new Map<string, string>();
  const locale = String.raw`:?["']?([\w-]+)["']?`;
  const rules = [
    // I18n.backend.store_translations(:zh_CN, i18n: { plural: { rule: … } })
    new RegExp(
      String.raw`store_translations\s*\(?\s*${locale}\s*,(?:(?!store_translations)[\s\S]){0,200}?\bplural\b[^}]{0,100}?\brule\b`,
      "g",
    ),
    // config/locales/zh_CN.rb: { zh_CN: { i18n: { plural: { rule: … } } } }
    new RegExp(
      String.raw`${locale}\s*(?:=>|:)\s*\{\s*:?["']?i18n["']?\s*(?:=>|:)\s*\{\s*:?["']?plural\b[^}]{0,100}?\brule\b`,
      "g",
    ),
  ];
  for (const dir of ["config/initializers", "config/locales"]) {
    let names: string[];
    try {
      names = readdirSync(path.join(cwd, dir), { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".rb"));
    } catch {
      continue;
    }
    for (const name of names) {
      const ruby = readFileSync(path.join(cwd, dir, name), "utf8");
      for (const rule of rules)
        for (const m of ruby.matchAll(rule)) own.set(m[1]!, `${dir}/${name}`);
    }
  }
  const out: Record<string, string[]> = {};
  // Locales whose rule is the app's, by the file that stores it.
  const kept = new Map<string, string>();
  for (const lang of config.languages) {
    if (lang === config.sourceLanguage) continue;
    const code = fileCodeOf(source, lang);
    const cldr = pluralCategoriesOf(lang);
    if (cldr.length === 0) continue;
    // The first of the locale and its parents with a rule, the app's
    // or the gem's, is the one Ruby's lookup through the fallbacks finds.
    const parts = code.split("-");
    let keys: string[] | undefined;
    for (let i = parts.length; i > 0 && !keys; i--) {
      const at = parts.slice(0, i).join("-");
      if (own.has(at)) {
        kept.set(code, own.get(at)!);
        break;
      }
      keys = RAILS_PLURALS[at];
    }
    if (kept.has(code)) continue;
    keys ??= ["one", "other"];
    if (keys.join() !== cldr.join()) out[lang] = keys;
  }
  onNote?.(
    `plural rules: rails-i18n ${version} (Gemfile.lock), read from Corpus's table of ${RAILS_I18N_VERSION}` +
      (kept.size > 0
        ? `; ${[...kept.keys()].join(", ")} ${kept.size === 1 ? "takes a rule" : "take rules"} the app stores (${[...new Set(kept.values())].join(", ")}), which Corpus cannot run, so CLDR's stands in`
        : ""),
  );
  return Object.keys(out).length > 0 ? out : undefined;
}

// Per target language, the plural categories a gettext source's target
// file picks, where they are not the language's CLDR ones (#951): a
// missing file is the one pull would write, from the language's table,
// and one that will not read is named where its seeds are read. A tag
// the runtime has no plural data for has none: its rules would be the
// pushing machine's locale, and nothing is enforced for it.
function gettextPluralForms(
  cwd: string,
  source: FileSource,
  config: CorpusConfig,
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const lang of config.languages) {
    if (lang === config.sourceLanguage) continue;
    const rel = fileOf(source, lang, config.sourceLanguage);
    const file = path.join(cwd, rel);
    const tag = languageOfFile(rel, source);
    const cldr = pluralCategoriesOf(tag);
    if (cldr.length === 0) continue;
    let text: string | undefined;
    try {
      text = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    } catch {
      continue;
    }
    const picked = gettextPluralCategories(text, tag);
    if (picked.join() !== cldr.join()) out[lang] = picked;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// The ids a source's own file holds as a plural object or hash, which
// the writers keep as one (#950); none where the file is absent.
export async function sourcePluralIds(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  source: FileSource,
  sourceLanguage: string,
): Promise<ReadonlySet<string> | undefined> {
  const file = fileOf(source, sourceLanguage, sourceLanguage);
  const abs = path.join(cwd, file);
  if (!existsSync(abs)) return undefined;
  if (source.adapter === "yaml")
    return yamlPluralIds(
      readFileSync(abs, "utf8"),
      fileCodeOf(source, sourceLanguage),
    );
  if (source.adapter === "messages" && readsPluralObjects(source)) {
    const data = await readModule(jiti, abs);
    const ids = pluralObjectIds(data, readsPluralObjects(source));
    if (readsSuffixPlurals(source))
      for (const id of suffixPluralIds(data, sourceLanguage)) ids.add(id);
    return ids;
  }
  return undefined;
}

async function readModule(
  jiti: ReturnType<typeof createJiti>,
  abs: string,
  exportName?: string,
): Promise<unknown> {
  const unreadable = unreadableFile(abs);
  if (unreadable) throw new Error(unreadable);
  if (abs.endsWith(".json") || isArb(abs)) {
    if (exportName !== undefined) {
      throw new Error(
        `a JSON file has no exports; drop export ${JSON.stringify(exportName)}`,
      );
    }
    return JSON.parse(stripBom(readFileSync(abs, "utf8")));
  }
  if (exportName === undefined) return jiti.import(abs, { default: true });
  const mod = (await jiti.import(abs)) as Record<string, unknown>;
  if (!(exportName in mod)) {
    throw new Error(
      `the module has no export named ${JSON.stringify(exportName)}`,
    );
  }
  return mod[exportName];
}

// The sources a proposal can be written into (§4, §11): not exec, and
// `takesProposals`; {lang} is not required, so a table without it takes
// proposals though it takes no translations.
export function writableSources(config: CorpusConfig): WritableSource[] {
  return config.sources.flatMap((source) =>
    source.adapter !== "exec" && takesProposals(source)
      ? [
          {
            // Android's source file itself: the server fills {lang} in
            // a pattern, and a res directory has none.
            // XLIFF's source file too: its name may hold no language,
            // and so does one whose source language languageFiles maps
            // (Anki's `templates`, #994).
            path:
              source.adapter === "android" ||
              source.adapter === "xliff" ||
              fileCodeOf(source, config.sourceLanguage) !==
                config.sourceLanguage
                ? fileOf(source, config.sourceLanguage, config.sourceLanguage)
                : source.path,
            // Every file adapter not code-keyed: tsc checks this set
            // against the snapshot's writable enum.
            adapter: source.adapter as Exclude<
              FileSource["adapter"],
              CodeKeyed
            >,
            type: source.type,
            ...(typeof source.namespace === "string" && {
              namespace: source.namespace,
            }),
            ...libraryFields(source),
          },
        ]
      : [],
  );
}

// A config that still says `syntax` keeps working and hears the new
// name once, naming every source that uses it (§3).
export function deprecations(config: CorpusConfig): string[] {
  const named = config.sources.flatMap((source) =>
    source.adapter !== "exec" &&
    source.adapter !== "android" &&
    source.syntax !== undefined
      ? [source.path]
      : [],
  );
  return named.length === 0
    ? []
    : [
        `syntax is the old name for library, on ${named.join(", ")}; it goes at 1.0`,
      ];
}

// Sources that cannot take translations back (§8): pull says so too,
// but the author should hear it before anyone translates.
export function pushOnlyNotes(config: CorpusConfig): string[] {
  const notes: string[] = [];
  for (const source of config.sources) {
    if (source.adapter === "exec") {
      if (!source.importCommand) {
        notes.push(
          `exec "${source.command}" is push-only: add importCommand to write translations back`,
        );
      }
    } else {
      const note = writeBackRefusal(source);
      if (note) notes.push(note);
    }
  }
  return notes;
}

// Why pull cannot write a source's translations back (§8), which push
// says too; undefined where it can.
export function writeBackRefusal(source: FileSource): string | undefined {
  if (!hasLanguages(source))
    return `${source.path} has no {lang}: its translations cannot be written back`;
  if (!sourceWritesBack(source))
    return `${source.path} is not JSON: pull writes JSON only, so its translations cannot be written back`;
  return undefined;
}

// Pull rewrites a catalogue in place and only knows JSON (§8); a .ts or
// .js catalogue pushes fine but nothing can come back to it.
function writesBack(sourcePath: string): boolean {
  return sourcePath.toLowerCase().endsWith(".json") || isArb(sourcePath);
}

// Flutter's catalogue: JSON under another name (#558).
export function isArb(sourcePath: string): boolean {
  return sourcePath.toLowerCase().endsWith(".arb");
}

// One glossary file per target language (§5): absent is an empty
// glossary for that language, malformed is a build error.
function readGlossary(
  config: CorpusConfig,
  cwd: string,
  errors: string[],
): Glossary {
  const glossary: Glossary = {};
  if (!config.glossary) return glossary;
  for (const lang of config.languages) {
    if (lang === config.sourceLanguage) continue;
    const file = config.glossary.path.replaceAll("{lang}", lang);
    let raw: string;
    try {
      raw = readFileSync(path.resolve(cwd, file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        glossary[lang] = [];
        continue;
      }
      errors.push(`${file}: ${(error as Error).message}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(stripBom(raw));
    } catch (error) {
      errors.push(`${file}: not a glossary: ${(error as Error).message}`);
      continue;
    }
    const parsed = glossaryFileSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push(
        `${file}: not a glossary: ${issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid"}`,
      );
      continue;
    }
    glossary[lang] = parsed.data;
  }
  return glossary;
}

// Per target language, the gettext fuzzy rows: what a translator may
// start from, never a translation (#721). Only a string the source has
// and the language did not seed.
function readSuggestions(
  config: CorpusConfig,
  cwd: string,
  ids: Set<string>,
  seeds: Record<string, Record<string, string>>,
  notes: string[],
): Record<string, Record<string, string>> {
  const suggestions: Record<string, Record<string, string>> = {};
  for (const source of config.sources) {
    if (source.adapter !== "gettext") continue;
    for (const lang of config.languages) {
      if (lang === config.sourceLanguage) continue;
      const file = fileOf(source, lang, config.sourceLanguage);
      if (!existsSync(path.join(cwd, file))) continue;
      const text = readFileSync(path.join(cwd, file), "utf8");
      for (const entry of gettextSuggestions(text, lang))
        if (
          ids.has(entry.id) &&
          entry.source.trim() !== "" &&
          seeds[lang]?.[entry.id] === undefined
        )
          (suggestions[lang] ??= {})[entry.id] = entry.source;
    }
  }
  const counts = Object.entries(suggestions).map(
    ([lang, texts]) => `${lang} ${Object.keys(texts).length}`,
  );
  if (counts.length > 0)
    notes.push(
      `${counts.join(", ")} fuzzy row(s) carried as suggestions, not translations`,
    );
  return suggestions;
}

// The repository's existing target-language catalogues (§8): every
// writable source with {lang} in its path is read once per target
// language, and the texts travel as seeds; an exec source has no file to
// read, so what its exporter emits as `translations` is taken under the
// same rules. The server imports a seed as translated only where it holds
// no edit for the row, so a push after the first is harmless; a file that
// will not read, or a language the exporter should not name, is a build
// error.
async function readSeeds(
  jiti: ReturnType<typeof createJiti>,
  config: CorpusConfig,
  cwd: string,
  ids: Set<string>,
  execSeeds: ExecSeeds[],
  errors: string[],
  notes: string[],
  refusedIds: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const seeds: Record<string, Record<string, string>> = {};
  for (const { command, translations } of execSeeds) {
    // Every translation an exporter hands over is accounted for (#659):
    // Discourse's 252,417 came to six fewer seeds, with no line why.
    let unknown = 0;
    let refusedCount = 0;
    let empty = 0;
    for (const [lang, texts] of Object.entries(translations)) {
      if (lang === config.sourceLanguage) {
        errors.push(
          `exec "${command}" emitted translations for the source language ${lang}`,
        );
        continue;
      }
      if (!config.languages.includes(lang)) {
        errors.push(
          `exec "${command}" emitted translations for ${lang}, which the config does not declare`,
        );
        continue;
      }
      for (const [id, text] of Object.entries(texts)) {
        if (refusedIds.has(id)) refusedCount += 1;
        else if (!ids.has(id)) unknown += 1;
        else if (text.trim() === "") empty += 1;
        else (seeds[lang] ??= {})[id] = text;
      }
    }
    const left = [
      unknown ? `${unknown} for ids it did not emit` : "",
      refusedCount ? `${refusedCount} for strings refused above` : "",
      empty ? `${empty} empty` : "",
    ].filter(Boolean);
    if (left.length > 0)
      notes.push(
        `exec "${command}": ${unknown + refusedCount + empty} translation(s) not seeded: ${left.join(", ")}`,
      );
  }
  const seededFrom: Record<string, Record<string, string>> = {};
  for (const source of config.sources) {
    if (source.adapter === "exec" || !hasLanguages(source)) continue;
    if (!sourceWritesBack(source)) continue;
    let overridden = 0;
    // A source file that will not read is named once, where it is read.
    const pluralIds = await sourcePluralIds(
      jiti,
      cwd,
      source,
      config.sourceLanguage,
    ).catch(() => undefined);
    for (const lang of config.languages) {
      if (lang === config.sourceLanguage) continue;
      const file = fileOf(source, lang, config.sourceLanguage);
      if (!existsSync(path.join(cwd, file))) continue;
      const unread: string[] = [];
      try {
        for (const entry of await readEntries(
          jiti,
          cwd,
          file,
          source,
          false,
          lang,
          // What the source cannot read is no string to seed (#991).
          (id) => {
            if (ids.has(id)) unread.push(id);
          },
          pluralIds,
        )) {
          // A key the source no longer has, or an empty value an
          // extraction tool left, is not a translation.
          if (!ids.has(entry.id) || isBlank(entry.source)) continue;
          // A string two files of one source share has one translation:
          // two that differ could not both survive a pull (#661).
          const seeded = (seeds[lang] ??= {})[entry.id];
          const from = (seededFrom[lang] ??= {})[entry.id];
          if (seeded !== undefined && from !== undefined) {
            if (seeded !== entry.source && lastWins(source)) {
              overridden += 1;
              seeds[lang][entry.id] = entry.source;
              seededFrom[lang][entry.id] = file;
            } else if (seeded !== entry.source)
              errors.push(
                `${file}: ${printable(entry.id)} is translated otherwise in ${from}; a string the files share takes one translation, so write the same in both`,
              );
            continue;
          }
          seeds[lang][entry.id] = entry.source;
          seededFrom[lang][entry.id] = file;
        }
        if (unread.length > 0)
          notes.push(
            `${file}: ${unread.length} translation(s) not seeded: ${unreadKind(source)}, left as the file has it (${unread.map(printable).join(", ")})`,
          );
        // The file's defect, not Corpus's: a count past its forms shows
        // the source text in the app (#1004).
        if (source.adapter === "qt-ts") {
          const short = qtShortForms(
            readFileSync(path.join(cwd, file), "utf8"),
            lang,
          ).filter((s) => ids.has(s.id));
          if (short.length > 0)
            notes.push(
              `${file}: ${short.length} numerus translation(s) hold fewer than the ${short[0]!.want} forms Qt's rule for ${lang} has, so a count past them shows the source text (${short
                .slice(0, 3)
                .map((s) => printable(s.id))
                .join(", ")}${short.length > 3 ? ", …" : ""})`,
            );
        }
      } catch (error) {
        // A target file that does not read stops no other language's
        // push (#1028): it seeds nothing, and validate names it.
        const message = error instanceof Error ? error.message : String(error);
        notes.push(
          `${file}: does not read, so none of its translations are seeded; corpus validate names it, and pull leaves it as it is (${message})`,
        );
      }
    }
    if (overridden > 0)
      notes.push(
        `${source.path}: ${overridden} translation(s) differ from an earlier pattern's of the source; this later one's is seeded, as merge: "last-wins" says, and validate names each`,
      );
  }
  return seeds;
}
