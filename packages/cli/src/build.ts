import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { messagesToEntries, tableToEntries } from "@corpus/adapters";
import {
  entitySchema,
  parseIcu,
  snapshotSchema,
  stringEntrySchema,
  type CorpusConfig,
  type Entity,
  type Snapshot,
  type StringEntry,
} from "@corpus/contract";
import { CliError } from "./config";

type Sourced = { entry: StringEntry; file: string };

// Reads the configured sources, feeds the pure adapters (and custom exec
// exporters), and assembles a corpus/1 envelope validated locally before
// any upload (§3, §8).
export async function buildSnapshot(
  config: CorpusConfig,
  cwd: string,
): Promise<Snapshot> {
  const jiti = createJiti(import.meta.url);
  const sourced: Sourced[] = [];
  const entities: Entity[] = [];
  const errors: string[] = [];

  for (const source of config.sources) {
    if (source.adapter === "exec") {
      collectExec(source.command, cwd, sourced, entities, errors);
      continue;
    }
    // Push reads the source-language file; a table path may carry {lang}
    // too when its translations are pulled back per language (§8).
    const file = source.path.replace("{lang}", config.sourceLanguage);
    let entries: StringEntry[];
    try {
      const data = await readModule(
        jiti,
        path.join(cwd, file),
        source.adapter === "table" ? source.export : undefined,
      );
      entries =
        source.adapter === "messages"
          ? messagesToEntries(data, { type: source.type })
          : tableToEntries(data, { type: source.type, map: source.map });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${file}: ${message}`);
      continue;
    }
    for (const entry of entries) validateEntry(entry, file, sourced, errors);
  }

  const byId = new Map<string, string>();
  for (const { entry, file } of sourced) {
    const prev = byId.get(entry.id);
    if (prev) errors.push(`duplicate id ${entry.id} in ${prev} and ${file}`);
    else byId.set(entry.id, file);
  }

  // The declarations travel with the snapshot (§4): the server renders
  // and validates metadata from them without reading the config.
  const snapshot = {
    contract: "corpus/1" as const,
    project: config.project,
    sourceLanguage: config.sourceLanguage,
    strings: sourced.map((s) => s.entry),
    entities,
    ...(config.stringTypes && { stringTypes: config.stringTypes }),
    ...(config.entityTypes && { entityTypes: config.entityTypes }),
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
  return parsed.data as Snapshot;
}

function validateEntry(
  entry: StringEntry,
  file: string,
  sourced: Sourced[],
  errors: string[],
): void {
  const icu = parseIcu(entry.source);
  if (!icu.ok) {
    errors.push(
      `${file} [${entry.id}]: invalid ICU: ${icu.errors[0]?.message}`,
    );
  }
  sourced.push({ entry, file });
}

function collectExec(
  command: string,
  cwd: string,
  sourced: Sourced[],
  entities: Entity[],
  errors: string[],
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
  const out = parsed as { strings?: unknown[]; entities?: unknown[] };
  for (const raw of out.strings ?? []) {
    const entry = stringEntrySchema.safeParse(raw);
    if (!entry.success) {
      errors.push(`exec "${command}" emitted an invalid string entry`);
      continue;
    }
    validateEntry(entry.data, `exec:${command}`, sourced, errors);
  }
  for (const raw of out.entities ?? []) {
    const entity = entitySchema.safeParse(raw);
    if (!entity.success)
      errors.push(`exec "${command}" emitted an invalid entity`);
    else entities.push(entity.data);
  }
}

async function readModule(
  jiti: ReturnType<typeof createJiti>,
  abs: string,
  exportName?: string,
): Promise<unknown> {
  if (abs.endsWith(".json")) return JSON.parse(readFileSync(abs, "utf8"));
  if (exportName === undefined) return jiti.import(abs, { default: true });
  const mod = (await jiti.import(abs)) as Record<string, unknown>;
  if (!(exportName in mod)) {
    throw new Error(
      `the module has no export named ${JSON.stringify(exportName)}`,
    );
  }
  return mod[exportName];
}
