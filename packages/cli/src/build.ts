import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import {
  androidDirOf,
  androidToEntries,
  fluentToEntries,
  messagesToEntries,
  stripBom,
  tableToEntries,
} from "@corpus/adapters";
import {
  entitySchema,
  libraryOf,
  parseIcu,
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
import { CliError } from "./config";

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
};
export type BuildReport = {
  snapshot: Snapshot;
  refused: Refused[];
  // What the build wants said that is not a refusal: a file whose empty
  // values took the key as the text (#589).
  notes: string[];
};
// What an exporter says the repository already holds for its strings
// (§3, §8): per target language, id to text; taken as seeds once the
// snapshot's ids are known.
type ExecSeeds = {
  command: string;
  translations: Record<string, Record<string, string>>;
};
export const execTranslationsSchema = z.record(
  z.string(),
  z.record(z.string(), z.string()),
);

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
export const SAME_CAUSE = 5;

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

export function describeRefused({ file, id, message }: Refused): string {
  return `${file} [${id}]: ${message}`;
}

// Reads the configured sources, feeds the pure adapters (and custom exec
// exporters), and assembles a corpus/1 envelope validated locally before
// any upload (§3, §8). A source string that does not parse is refused by
// entry; anything else that fails, a file that will not read, a
// duplicate id, an exporter that exits non-zero, fails the build.
export async function buildSnapshotReport(
  config: CorpusConfig,
  cwd: string,
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
      );
      continue;
    }
    // Push reads the source-language file; a table path may carry {lang}
    // too when its translations are pulled back per language (§8).
    const file = fileOf(source, config.sourceLanguage, config.sourceLanguage);
    let entries: StringEntry[];
    try {
      entries = await readEntries(jiti, cwd, file, source, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: ${message}`);
      continue;
    }
    // The file rides with the entry (§4) so a proposal can come back to
    // it, and only where pull can write it: a .ts catalogue carries none,
    // so a proposal on its strings is refused up front, not left pending.
    const writable = sourceWritesBack(source);
    const keyed = entries.filter((entry) => entry.keyIsText).length;
    if (keyed > 0) {
      notes.push(
        `${file}: ${keyed} string(s) have an empty value and take the key as the text; a proposal on them is refused, since the text is the key`,
      );
    }
    for (const entry of entries) {
      validateEntry(
        {
          ...entry,
          // A key-is-text entry carries no file: a proposal would rewrite
          // the key, which is the code's, not the catalogue's.
          ...(writable && !entry.keyIsText ? { file } : {}),
          ...libraryFields(source),
        },
        file,
        sourced,
        refused,
      );
    }
  }

  const byId = new Map<string, string>();
  for (const { entry, file } of sourced) {
    const prev = byId.get(entry.id);
    if (prev) errors.push(`duplicate id ${entry.id} in ${prev} and ${file}`);
    else byId.set(entry.id, file);
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
    throw new CliError(
      [
        "snapshot build failed:",
        ...refused.map((entry) => `  ${describeRefused(entry)}`),
        ...ruined.map((reason) => `  ${reason}`),
        "  nothing was pushed: pushing the rest would archive every refused string",
      ].join("\n"),
    );
  }
  return { snapshot: parsed.data as Snapshot, refused, notes };
}

function validateEntry(
  entry: StringEntry,
  file: string,
  sourced: Sourced[],
  refused: Refused[],
): void {
  const syntax = libraryOf(entry);
  const icu = parseIcu(entry.source, syntax);
  if (icu.ok) sourced.push({ entry, file });
  else {
    const message = icu.errors[0]?.message ?? "";
    const advice = refusalAdvice(entry.source, syntax, message);
    const cause = refusalCause(entry.source, syntax, message);
    refused.push({
      file,
      id: entry.id,
      hint: advice,
      ...(cause ? { cause } : {}),
      message: `invalid ${syntax === "icu" ? "ICU" : syntax}: ${message}${advice}`,
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
): { ok: true; output: ExporterOutput } | { ok: false; error: string } {
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
    return { ok: true, output: JSON.parse(result.stdout) as ExporterOutput };
  } catch {
    return { ok: false, error: `exec "${command}" did not emit valid JSON` };
  }
}

function collectExec(
  command: string,
  cwd: string,
  sourced: Sourced[],
  entities: Entity[],
  execSeeds: ExecSeeds[],
  errors: string[],
  refused: Refused[],
): void {
  const ran = runExporter(command, cwd);
  if (!ran.ok) {
    errors.push(ran.error);
    return;
  }
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
    validateEntry(entry, `exec:${command}`, sourced, refused);
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
      execSeeds.push({ command, translations: translations.data });
    } else {
      errors.push(
        `exec "${command}" emitted invalid translations: a map of language to id to text`,
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
  return source.adapter === "fluent" ? "icu" : libraryOf(source);
}

// The file a source keeps a language in: its pattern with {lang}
// filled, or, for Android, the `values` directory of the language.
export function fileOf(
  source: FileSource,
  language: string,
  sourceLanguage: string,
): string {
  if (source.adapter !== "android")
    return source.path.replace("{lang}", language);
  const dir = language === sourceLanguage ? "values" : androidDirOf(language);
  return path.posix.join(source.path, dir, "strings.xml");
}

// Whether a source keeps a file per language, and so takes
// translations back.
export function hasLanguages(source: FileSource): boolean {
  return source.adapter === "android" || source.path.includes("{lang}");
}

export function sourceWritesBack(source: FileSource): boolean {
  if (source.adapter === "android" || source.adapter === "fluent") return true;
  return writesBack(source.path);
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
): Promise<StringEntry[]> {
  if (source.adapter === "android") {
    return androidToEntries(readFileSync(path.join(cwd, file), "utf8"), {
      type: source.type,
    });
  }
  if (source.adapter === "fluent") {
    const entries = fluentToEntries(
      readFileSync(path.join(cwd, file), "utf8"),
      { type: source.type },
    );
    return source.namespace
      ? entries.map((e) => ({ ...e, id: `${source.namespace}:${e.id}` }))
      : entries;
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

async function readModule(
  jiti: ReturnType<typeof createJiti>,
  abs: string,
  exportName?: string,
): Promise<unknown> {
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

// The sources pull can rewrite in place (§4): not exec, a .json path;
// {lang} is not required, so a table without it takes proposals though
// it takes no translations.
export function writableSources(config: CorpusConfig): WritableSource[] {
  return config.sources.flatMap((source) =>
    source.adapter !== "exec" && sourceWritesBack(source)
      ? [
          {
            // Android's source file itself: the server fills {lang} in
            // a pattern, and a res directory has none.
            path:
              source.adapter === "android"
                ? fileOf(source, config.sourceLanguage, config.sourceLanguage)
                : source.path,
            adapter: source.adapter,
            type: source.type,
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
    } else if (source.adapter === "android") {
      continue;
    } else if (!source.path.includes("{lang}")) {
      notes.push(
        `${source.path} has no {lang}: its translations cannot be written back`,
      );
    } else if (!writesBack(source.path)) {
      notes.push(
        `${source.path} is not JSON: pull writes JSON only, so its translations cannot be written back`,
      );
    }
  }
  return notes;
}

// Pull rewrites a catalogue in place and only knows JSON (§8); a .ts or
// .js catalogue pushes fine but nothing can come back to it.
export function writesBack(sourcePath: string): boolean {
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
    const file = config.glossary.path.replace("{lang}", lang);
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
): Promise<Record<string, Record<string, string>>> {
  const seeds: Record<string, Record<string, string>> = {};
  for (const { command, translations } of execSeeds) {
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
        if (!ids.has(id) || text.trim() === "") continue;
        (seeds[lang] ??= {})[id] = text;
      }
    }
  }
  for (const source of config.sources) {
    if (source.adapter === "exec" || !hasLanguages(source)) continue;
    if (!sourceWritesBack(source)) continue;
    for (const lang of config.languages) {
      if (lang === config.sourceLanguage) continue;
      const file = fileOf(source, lang, config.sourceLanguage);
      if (!existsSync(path.join(cwd, file))) continue;
      try {
        for (const entry of await readEntries(jiti, cwd, file, source)) {
          // A key the source no longer has, or an empty value an
          // extraction tool left, is not a translation.
          if (!ids.has(entry.id) || entry.source.trim() === "") continue;
          (seeds[lang] ??= {})[entry.id] = entry.source;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${file}: ${message}`);
      }
    }
  }
  return seeds;
}
