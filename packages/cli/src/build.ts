import { readFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { messagesToEntries, tableToEntries } from "@corpus/adapters";
import {
  parseIcu,
  snapshotSchema,
  type CorpusConfig,
  type Snapshot,
  type StringEntry,
} from "@corpus/contract";
import { CliError } from "./config";

type Sourced = { entry: StringEntry; file: string };

// Reads the configured sources, feeds the pure adapters, and assembles a
// corpus/1 envelope validated locally before any upload (§3, §8). exec
// sources are handled in #44.
export async function buildSnapshot(
  config: CorpusConfig,
  cwd: string,
): Promise<Snapshot> {
  const jiti = createJiti(import.meta.url);
  const sourced: Sourced[] = [];
  const errors: string[] = [];

  for (const source of config.sources) {
    if (source.adapter === "exec") {
      throw new CliError("exec sources are not supported yet (#44)");
    }
    const file =
      source.adapter === "messages"
        ? source.path.replace("{lang}", config.sourceLanguage)
        : source.path;
    const abs = path.join(cwd, file);
    const data = await readModule(jiti, abs);

    const entries =
      source.adapter === "messages"
        ? messagesToEntries(data, { type: source.type })
        : tableToEntries(data, { type: source.type, map: source.map });

    for (const entry of entries) {
      const icu = parseIcu(entry.source);
      if (!icu.ok) {
        errors.push(
          `${file} [${entry.id}]: invalid ICU: ${icu.errors[0]?.message}`,
        );
      }
      sourced.push({ entry, file });
    }
  }

  const byId = new Map<string, string>();
  for (const { entry, file } of sourced) {
    const prev = byId.get(entry.id);
    if (prev) {
      errors.push(`duplicate id ${entry.id} in ${prev} and ${file}`);
    } else {
      byId.set(entry.id, file);
    }
  }

  const snapshot = {
    contract: "corpus/1" as const,
    project: config.project,
    sourceLanguage: config.sourceLanguage,
    strings: sourced.map((s) => s.entry),
    entities: [],
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
  return parsed.success ? parsed.data : (snapshot as Snapshot);
}

async function readModule(
  jiti: ReturnType<typeof createJiti>,
  abs: string,
): Promise<unknown> {
  if (abs.endsWith(".json")) {
    return JSON.parse(readFileSync(abs, "utf8"));
  }
  return jiti.import(abs, { default: true });
}
