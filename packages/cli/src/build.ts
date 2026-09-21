import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import { messagesToEntries, tableToEntries } from "@corpus/adapters";
import {
  entitySchema,
  parseIcu,
  snapshotSchema,
  stringEntrySchema,
  glossaryFileSchema,
  type CorpusConfig,
  type Entity,
  type Glossary,
  type Snapshot,
  type Source,
  type StringEntry,
  type WritableSource,
} from "@corpus/contract";
import { CliError } from "./config";

type Sourced = { entry: StringEntry; file: string };
// A source string whose text does not parse (§8): left out of the
// snapshot and named, so one typo does not hold the other thousand.
export type Refused = { file: string; id: string; message: string };
export type BuildReport = { snapshot: Snapshot; refused: Refused[] };
// What an exporter says the repository already holds for its strings
// (§3, §8): per target language, id to text; taken as seeds once the
// snapshot's ids are known.
type ExecSeeds = {
  command: string;
  translations: Record<string, Record<string, string>>;
};
const execTranslationsSchema = z.record(
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
    const file = source.path.replace("{lang}", config.sourceLanguage);
    let entries: StringEntry[];
    try {
      entries = await readEntries(jiti, cwd, file, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: ${message}`);
      continue;
    }
    // The file rides with the entry (§4) so a proposal can come back to
    // it, and only where pull can write it: a .ts catalogue carries none,
    // so a proposal on its strings is refused up front, not left pending.
    const writable = writesBack(source.path);
    for (const entry of entries) {
      validateEntry(
        {
          ...entry,
          ...(writable ? { file } : {}),
          ...(source.syntax ? { syntax: source.syntax } : {}),
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
  return { snapshot: parsed.data as Snapshot, refused };
}

function validateEntry(
  entry: StringEntry,
  file: string,
  sourced: Sourced[],
  refused: Refused[],
): void {
  const icu = parseIcu(entry.source, entry.syntax ?? "icu");
  if (icu.ok) sourced.push({ entry, file });
  else {
    refused.push({
      file,
      id: entry.id,
      message: `invalid ${entry.syntax ?? "ICU"}: ${icu.errors[0]?.message}`,
    });
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
  const result = spawnSync(command, { shell: true, cwd, encoding: "utf8" });
  if (result.status !== 0) {
    errors.push(
      `exec "${command}" exited ${result.status}: ${result.stderr?.trim()}`,
    );
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    errors.push(`exec "${command}" did not emit valid JSON`);
    return;
  }
  const out = parsed as {
    strings?: unknown[];
    entities?: unknown[];
    translations?: unknown;
  };
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

export type FileSource = Exclude<Source, { adapter: "exec" }>;

// A catalogue file through its source's adapter: the entries push would
// send for it, or, for a target file, the translations it holds.
export async function readEntries(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  file: string,
  source: FileSource,
): Promise<StringEntry[]> {
  const data = await readModule(
    jiti,
    path.join(cwd, file),
    source.adapter === "table" ? source.export : undefined,
  );
  return source.adapter === "messages"
    ? messagesToEntries(data, { type: source.type })
    : tableToEntries(data, { type: source.type, map: source.map });
}

async function readModule(
  jiti: ReturnType<typeof createJiti>,
  abs: string,
  exportName?: string,
): Promise<unknown> {
  if (abs.endsWith(".json")) {
    if (exportName !== undefined) {
      throw new Error(
        `a JSON file has no exports; drop export ${JSON.stringify(exportName)}`,
      );
    }
    return JSON.parse(readFileSync(abs, "utf8"));
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
    source.adapter !== "exec" && writesBack(source.path)
      ? [
          {
            path: source.path,
            adapter: source.adapter,
            type: source.type,
            ...(source.syntax ? { syntax: source.syntax } : {}),
          },
        ]
      : [],
  );
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
  return sourcePath.toLowerCase().endsWith(".json");
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
      json = JSON.parse(raw);
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
    if (source.adapter === "exec" || !source.path.includes("{lang}")) continue;
    if (!writesBack(source.path)) continue;
    for (const lang of config.languages) {
      if (lang === config.sourceLanguage) continue;
      const file = source.path.replace("{lang}", lang);
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
