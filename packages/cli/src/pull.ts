import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyMessagesOps,
  applyTableOps,
  entriesToMessages,
  entriesToTable,
  messagesToEntries,
  type SourceOp,
} from "@corpus/adapters";
import { option, options } from "./args";
import {
  MIN_STATES,
  pullPayloadSchema,
  type CorpusConfig,
  type MinState,
  type PullPayload,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import {
  describeExecFailure,
  EXEC_MAX_BUFFER,
  isArb,
  type FileSource,
  writesBack,
} from "./build";
import { CliError, loadConfig, requireToken } from "./config";
import { request, serverMessage, UNAUTHORIZED } from "./server";

// `corpus pull` (§8): download translations at or above --min-state and
// write them back through the adapters. Files are only touched when
// their content changes, and every changed path is printed. `exec`
// sources get, on stdin, whatever the file adapters did not claim.
// `--lang` (repeatable) narrows both to those languages; `--check`
// writes nothing, runs nothing, and exits 1 when a pull would change a
// file.
export async function pull(args: string[], ctx: RunContext): Promise<number> {
  const minState = option(args, "--min-state") ?? "verified";
  if (!(MIN_STATES as readonly string[]).includes(minState)) {
    throw new CliError(`--min-state must be one of ${MIN_STATES.join(", ")}`);
  }
  const check = args.includes("--check");
  const config = await loadConfig(ctx.cwd);
  // The source text belongs to the repository (§1, §8): pull writes
  // target languages only and hands importers only those.
  const allTargets = config.languages.filter(
    (l) => l !== config.sourceLanguage,
  );
  const langs = options(args, "--lang");
  for (const lang of langs) {
    if (lang === config.sourceLanguage) {
      throw new CliError(
        `--lang ${lang} is the source language, which is never pulled`,
      );
    }
    if (!allTargets.includes(lang)) {
      throw new CliError(
        `--lang ${lang} is not a language of this config (${allTargets.join(", ")})`,
      );
    }
  }
  const targets = langs.length > 0 ? langs : allTargets;
  const token = requireToken(ctx.env, ctx.cwd);

  const payload = await download(
    config,
    token,
    minState as MinState,
    langs,
    ctx,
  );
  if (payload === undefined) return 1;

  const changed: string[] = [];
  const claimedTypes = new Set<string>();
  // Ids the server holds that no source-language file of their type does
  // any more: orphans, listed by validate, never appended to a target
  // (§8). Held ids are unioned per type first, since an array of
  // patterns splits one type over several files.
  const notHeld = new Set<string>();
  const heldByType = new Map<string, Set<string>>();
  for (const source of config.sources) {
    if (source.adapter !== "messages") continue;
    if (!source.path.includes("{lang}") || !writesBack(source.path)) continue;
    const template = readRepoFile(
      ctx.cwd,
      source.path.replace("{lang}", config.sourceLanguage),
    );
    if (template === undefined) continue;
    const held = heldByType.get(source.type) ?? new Set<string>();
    for (const id of ownIds(template, source) ?? []) held.add(id);
    heldByType.set(source.type, held);
  }
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    if (!source.path.includes("{lang}")) {
      // Source-only: nothing to write back, and its ids stay available to
      // an exec importer rather than vanishing.
      ctx.err(
        `corpus: ${source.path} has no {lang}: its translations cannot be written back`,
      );
      continue;
    }
    if (!writesBack(source.path)) {
      ctx.err(
        `corpus: ${source.path} is not JSON: pull writes JSON only, so its translations cannot be written back`,
      );
      continue;
    }
    claimedTypes.add(source.type);
    const templatePath = source.path.replace("{lang}", config.sourceLanguage);
    const template = readRepoFile(ctx.cwd, templatePath);
    if (template === undefined) {
      throw new CliError(`source file ${templatePath} does not exist`);
    }
    // A target file takes the ids its source-language file holds, under
    // the source's namespace when it has one, stripped for writing: two
    // sources of one type each write their own strings (#513).
    const own = ownIds(template, source);
    for (const language of targets) {
      const file = source.path.replace("{lang}", language);
      const existing = readRepoFile(ctx.cwd, file);
      const forSource = forType(payload, language, source.type);
      const translations = unprefixed(forSource, source, own);
      const heldForType = heldByType.get(source.type);
      for (const id of Object.keys(forSource)) {
        if (heldForType && !heldForType.has(id)) notHeld.add(id);
      }
      if (existing === undefined && Object.keys(translations).length === 0)
        continue;
      const next =
        source.adapter === "messages"
          ? entriesToMessages(
              template,
              translations,
              existing,
              isArb(file) ? { locale: language } : {},
            )
          : entriesToTable(template, translations, source.map, existing);
      if (next !== existing) {
        if (!check) writeFileSync(path.join(ctx.cwd, file), next);
        changed.push(file);
      }
    }
  }

  if (notHeld.size > 0) {
    ctx.err(
      `corpus: ${notHeld.size} translation(s) name an id no source-language file holds and were not written; corpus validate lists the orphans`,
    );
  }

  // The pending proposals (§8, §11): each into the source-language file
  // of the source it names, a removal into that source's target files
  // too; a file that matches no source is refused by name.
  let proposalsWritten = 0;
  for (const [file, ops] of proposalsByFile(payload.sourceChanges ?? [])) {
    const source = config.sources.find(
      (s): s is Exclude<typeof s, { adapter: "exec" }> =>
        s.adapter !== "exec" &&
        s.path.replace("{lang}", config.sourceLanguage) === file,
    );
    if (!source || !writesBack(source.path)) {
      ctx.err(
        `corpus: proposal(s) for ${ops.map((o) => o.id).join(", ")}: ${file} matches no writable source; not written`,
      );
      continue;
    }
    const stripped = stripNamespace(ops, source);
    for (const op of stripped.refused) {
      ctx.err(
        `corpus: proposal ${op.id} for ${file} lacks the namespace ${source.namespace}: that file's ids carry; not written`,
      );
    }
    const kept = stripped.ops;
    if (kept.length === 0) continue;
    proposalsWritten += kept.length;
    const files: [string, SourceOp[]][] = [[file, kept]];
    const removals = kept.filter((o) => o.kind === "delete");
    if (removals.length > 0 && source.path.includes("{lang}")) {
      for (const language of allTargets) {
        files.push([source.path.replace("{lang}", language), removals]);
      }
    }
    for (const [target, targetOps] of files) {
      const existing = readRepoFile(ctx.cwd, target);
      if (existing === undefined) {
        if (target === file)
          throw new CliError(`source file ${file} does not exist`);
        continue;
      }
      let next: string;
      try {
        next =
          source.adapter === "messages"
            ? applyMessagesOps(existing, targetOps)
            : applyTableOps(existing, targetOps, source.map);
      } catch (error) {
        throw new CliError(
          `${target}: proposal(s) for ${targetOps.map((o) => o.id).join(", ")}: ${(error as Error).message}`,
        );
      }
      if (next !== existing) {
        if (!check) writeFileSync(path.join(ctx.cwd, target), next);
        changed.push(target);
      }
    }
  }

  if (check) {
    for (const source of config.sources) {
      if (source.adapter === "exec" && source.importCommand) {
        ctx.err(
          `corpus: exec "${source.importCommand}" is not checked: an import command's writes are its own`,
        );
      }
    }
    const files = [...new Set(changed)];
    for (const file of files) ctx.out(file);
    ctx.out(
      `pull --check ${config.project} at ${minState}: ${files.length} file(s) would change`,
    );
    return files.length === 0 ? 0 : 1;
  }

  let ran = 0;
  for (const source of config.sources) {
    if (source.adapter !== "exec" || !source.importCommand) continue;
    const translations: PullPayload["translations"] = {};
    for (const [language, texts] of Object.entries(payload.translations)) {
      if (!targets.includes(language)) continue;
      translations[language] = Object.fromEntries(
        Object.entries(texts).filter(
          ([id]) => !claimedTypes.has(payload.types[id] ?? ""),
        ),
      );
    }
    const result = spawnSync(source.importCommand, {
      shell: true,
      cwd: ctx.cwd,
      encoding: "utf8",
      input: JSON.stringify({ ...payload, translations }),
      maxBuffer: EXEC_MAX_BUFFER,
    });
    if (result.status !== 0) {
      throw new CliError(
        describeExecFailure(source.importCommand, result, "import"),
      );
    }
    ran++;
    ctx.out(`ran ${source.importCommand}`);
    // What the importer said is the only account of what it wrote: the
    // file count below is the adapters' alone (#599).
    for (const line of result.stderr.split("\n")) {
      if (line.trim() !== "") ctx.out(`  ${line}`);
    }
  }

  const importers = config.sources.filter(
    (s) => s.adapter === "exec" && s.importCommand,
  ).length;
  if (importers === 0) {
    const dropped = new Set(
      Object.entries(payload.translations)
        .filter(([language]) => targets.includes(language))
        .flatMap(([, texts]) => Object.keys(texts))
        .filter((id) => !claimedTypes.has(payload.types[id] ?? "")),
    );
    if (dropped.size > 0) {
      ctx.err(
        `corpus: ${dropped.size} translation(s) belong to no writable source and were not written`,
      );
    }
  }

  const files = [...new Set(changed)];
  for (const file of files) ctx.out(file);
  ctx.out(
    `pulled ${config.project} at ${minState}: ${files.length} file(s) changed${ran > 0 ? `, ${ran} import command(s) ran` : ""}`,
  );
  if (proposalsWritten > 0) {
    ctx.out(
      `${proposalsWritten} proposal(s) written: commit and push, and the next corpus push marks them applied`,
    );
  }
  return 0;
}

function proposalsByFile(
  changes: NonNullable<PullPayload["sourceChanges"]>,
): Map<string, SourceOp[]> {
  const byFile = new Map<string, SourceOp[]>();
  for (const change of changes) {
    const ops = byFile.get(change.file) ?? [];
    ops.push(
      change.kind === "delete"
        ? { kind: "delete", id: change.id }
        : { kind: change.kind, id: change.id, text: change.text ?? "" },
    );
    byFile.set(change.file, ops);
  }
  return byFile;
}

function readRepoFile(cwd: string, rel: string): string | undefined {
  const abs = path.join(cwd, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

function forType(
  payload: PullPayload,
  language: string,
  type: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(
    payload.translations[language] ?? {},
  )) {
    if (payload.types[id] === type) out[id] = text;
  }
  return out;
}

async function download(
  config: CorpusConfig,
  token: string,
  minState: MinState,
  langs: string[],
  ctx: RunContext,
): Promise<PullPayload | undefined> {
  const query = [
    `minState=${minState}`,
    ...langs.map((l) => `lang=${encodeURIComponent(l)}`),
  ].join("&");
  const url = `${config.server.replace(/\/$/, "")}/api/pull?${query}`;
  const response = await request(url, token);
  if (response.status === 401) {
    ctx.err(`corpus: ${UNAUTHORIZED}`);
    return undefined;
  }
  if (!response.ok) {
    ctx.err(
      `corpus: pull failed (HTTP ${response.status})${await serverMessage(response)}`,
    );
    return undefined;
  }
  const parsed = pullPayloadSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new CliError(
      `the server's pull payload does not match the corpus/1 contract: ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

// The ids a source-language file holds, as the snapshot names them.
function ownIds(template: string, source: FileSource): Set<string> | undefined {
  if (source.adapter !== "messages") return undefined;
  try {
    const entries = messagesToEntries(JSON.parse(template), {
      type: source.type,
      arb: isArb(source.path),
    });
    const prefix = source.namespace ? `${source.namespace}:` : "";
    return new Set(entries.map((e) => `${prefix}${e.id}`));
  } catch {
    return undefined;
  }
}

// A source's share of a language's translations, keyed as its file
// writes them: the namespace stripped, ids the file does not hold left
// out when the file's own ids are known.
function unprefixed(
  translations: Record<string, string>,
  source: FileSource,
  own: Set<string> | undefined,
): Record<string, string> {
  const prefix = source.namespace ? `${source.namespace}:` : "";
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(translations)) {
    if (own && !own.has(id)) continue;
    if (prefix && !id.startsWith(prefix)) continue;
    out[id.slice(prefix.length)] = text;
  }
  return out;
}

// A namespaced file's ops arrive with the namespace on their ids; the
// file is written without it. An op whose id lacks it names a string the
// file cannot hold, and is refused by name rather than dropped.
function stripNamespace(
  ops: SourceOp[],
  source: FileSource,
): { ops: SourceOp[]; refused: SourceOp[] } {
  const prefix = source.namespace ? `${source.namespace}:` : "";
  if (!prefix) return { ops, refused: [] };
  const kept: SourceOp[] = [];
  const refused: SourceOp[] = [];
  for (const op of ops) {
    if (op.id.startsWith(prefix))
      kept.push({ ...op, id: op.id.slice(prefix.length) });
    else refused.push(op);
  }
  return { ops: kept, refused };
}
