import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  androidToEntries,
  applyAndroidOps,
  applyFluentOps,
  entriesToAndroid,
  entriesToFluent,
  fluentToEntries,
  applyXliffOps,
  entriesToGettext,
  entriesToXcstrings,
  xcstringsToEntries,
  entriesToXliff,
  parsePo,
  poId,
  xliffUnits,
  applyMessagesOps,
  applyTableOps,
  entriesToMessages,
  entriesToTable,
  messagesToEntries,
  stripBom,
  type SourceOp,
} from "@corpus/adapters";
import { printable } from "./printable";
import { option, options } from "./args";
import {
  libraryOf,
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
  fileOf,
  type FileSource,
  hasLanguages,
  isArb,
  readsPluralObjects,
  sourceWritesBack,
} from "./build";
import { CliError, fileCodeOf, loadConfig, requireToken } from "./config";
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

  // The files of one source are one catalogue (#661): the ids each
  // source-language file holds, by source, and the members of each.
  const groups = new Map<number, FileSource[]>();
  const sourceIds = new Map<FileSource, Set<string>>();
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    const group = "group" in source ? source.group : undefined;
    if (typeof group !== "number") continue;
    groups.set(group, [...(groups.get(group) ?? []), source]);
    const template = readRepoFile(
      ctx.cwd,
      fileOf(source, config.sourceLanguage, config.sourceLanguage),
    );
    sourceIds.set(
      source,
      (template && ownIds(template, source)) || new Set<string>(),
    );
  }
  const membersOf = (source: FileSource) => {
    const group = "group" in source ? source.group : undefined;
    return typeof group === "number" ? (groups.get(group) ?? []) : [];
  };

  // A string two files of one source share is written into each target
  // file that holds it, and into the first file's when none does, so a
  // push and a pull leave the files as they were (#661).
  const targetIds = new Map<string, Set<string>>();
  const idsInTarget = (member: FileSource, language: string) => {
    const file = fileOf(member, language, config.sourceLanguage);
    let ids = targetIds.get(file);
    if (!ids) {
      const text = readRepoFile(ctx.cwd, file);
      ids = (text !== undefined && ownIds(text, member)) || new Set<string>();
      targetIds.set(file, ids);
    }
    return ids;
  };
  const sharedFor = (
    translations: Record<string, string>,
    source: FileSource,
    members: FileSource[],
    language: string,
  ): Record<string, string> => {
    if (members.length < 2) return translations;
    return Object.fromEntries(
      Object.entries(translations).filter(([id]) => {
        const holders = members.filter((m) => sourceIds.get(m)?.has(id));
        if (holders.length < 2) return true;
        if (idsInTarget(source, language).has(id)) return true;
        return (
          holders[0] === source &&
          !holders.some((m) => idsInTarget(m, language).has(id))
        );
      }),
    );
  };

  // Read before anything is written: what the files held when the pull
  // began decides where a shared string goes.
  for (const members of groups.values())
    for (const member of members)
      for (const language of targets) idsInTarget(member, language);

  const changed: string[] = [];
  const pending = new Map<string, string>();
  const claimedTypes = new Set<string>();
  // Ids the server holds that no source-language file of their type does
  // any more: orphans, listed by validate, never appended to a target
  // (§8). Held ids are unioned per type first, since an array of
  // patterns splits one type over several files.
  const notHeld = new Set<string>();
  const heldByType = new Map<string, Set<string>>();
  for (const source of config.sources) {
    if (source.adapter === "table" || source.adapter === "exec") continue;
    if (!hasLanguages(source) || !sourceWritesBack(source)) continue;
    const template = readRepoFile(
      ctx.cwd,
      fileOf(source, config.sourceLanguage, config.sourceLanguage),
    );
    if (template === undefined) continue;
    const held = heldByType.get(source.type) ?? new Set<string>();
    for (const id of ownIds(template, source) ?? []) held.add(id);
    heldByType.set(source.type, held);
  }
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    if (!hasLanguages(source)) {
      // Source-only: nothing to write back, and its ids stay available to
      // an exec importer rather than vanishing.
      ctx.err(
        `corpus: ${source.path} has no {lang}: its translations cannot be written back`,
      );
      continue;
    }
    if (!sourceWritesBack(source)) {
      ctx.err(
        `corpus: ${source.path} is not JSON: pull writes JSON only, so its translations cannot be written back`,
      );
      continue;
    }
    claimedTypes.add(source.type);
    const templatePath = fileOf(
      source,
      config.sourceLanguage,
      config.sourceLanguage,
    );
    const template = readRepoFile(ctx.cwd, templatePath);
    if (template === undefined) {
      throw new CliError(`source file ${templatePath} does not exist`);
    }
    // A target file takes the ids its source-language file holds, under
    // the source's namespace when it has one, stripped for writing: two
    // sources of one type each write their own strings (#513).
    const own = ownIds(template, source);
    const members = membersOf(source);
    for (const language of targets) {
      const file = fileOf(source, language, config.sourceLanguage);
      // A String Catalog is one file for every language: each language
      // writes into what the one before it left.
      const existing = pending.get(file) ?? readRepoFile(ctx.cwd, file);
      const forSource = sharedFor(
        forType(payload, language, source.type),
        source,
        members,
        language,
      );
      const translations = unprefixed(forSource, source, own);
      const heldForType = heldByType.get(source.type);
      for (const id of Object.keys(forSource)) {
        if (heldForType && !heldForType.has(id)) notHeld.add(id);
      }
      if (existing === undefined && Object.keys(translations).length === 0)
        continue;
      const next =
        source.adapter === "android"
          ? entriesToAndroid(template, translations, existing)
          : source.adapter === "fluent"
            ? entriesToFluent(template, translations, existing)
            : source.adapter === "messages"
              ? entriesToMessages(template, translations, existing, {
                  ...(isArb(file) && { locale: language }),
                  chrome: libraryOf(source) === "chrome",
                  plurals: readsPluralObjects(source),
                  onRefused: (id) =>
                    ctx.err(
                      `corpus: ${file}: ${printable(id)} is a plural its object cannot hold (an =N branch, or a brace a form leaves open); not written`,
                    ),
                })
              : source.adapter === "xliff"
                ? entriesToXliff(template, translations, existing, language)
                : source.adapter === "gettext"
                  ? entriesToGettext(
                      template,
                      translations,
                      existing,
                      { tag: language, code: fileCodeOf(source, language) },
                      (id) =>
                        ctx.err(
                          `corpus: ${file}: ${printable(id)} is a plural and its translation is not one gettext can hold (a plain text, or an =N branch); not written`,
                        ),
                    )
                  : source.adapter === "xcstrings"
                    ? xcstringsInto(file, existing, translations, language)
                    : source.adapter === "table"
                      ? entriesToTable(
                          template,
                          translations,
                          source.map,
                          existing,
                        )
                      : existing;
      if (next !== undefined) pending.set(file, next);
      if (next !== undefined && next !== existing) {
        if (!check) {
          // A language new to the repository may need its directory.
          mkdirSync(path.dirname(path.join(ctx.cwd, file)), {
            recursive: true,
          });
          writeFileSync(path.join(ctx.cwd, file), next);
        }
        if (!changed.includes(file)) changed.push(file);
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
  // too; a file that matches no source is refused by name. An edit or a
  // removal of a string two files of one source share goes into each
  // (#661), or the next push finds them different.
  const written = new Set<string>();
  const sourceChanges = (payload.sourceChanges ?? []).flatMap((change) => {
    if (change.kind === "add") return [change];
    const named = config.sources.find(
      (s): s is FileSource =>
        s.adapter !== "exec" &&
        fileOf(s, config.sourceLanguage, config.sourceLanguage) === change.file,
    );
    const others = named
      ? membersOf(named).filter(
          (m) => m !== named && sourceIds.get(m)?.has(change.id),
        )
      : [];
    return [
      change,
      ...others.map((m) => ({
        ...change,
        file: fileOf(m, config.sourceLanguage, config.sourceLanguage),
      })),
    ];
  });
  for (const [file, ops] of proposalsByFile(sourceChanges)) {
    const source = config.sources.find(
      (s): s is Exclude<typeof s, { adapter: "exec" }> =>
        s.adapter !== "exec" &&
        fileOf(s, config.sourceLanguage, config.sourceLanguage) === file,
    );
    if (
      !source ||
      !sourceWritesBack(source) ||
      source.adapter === "gettext" ||
      source.adapter === "xcstrings"
    ) {
      ctx.err(
        `corpus: proposal(s) for ${ops.map((o) => printable(o.id)).join(", ")}: ${file} matches no writable source; not written`,
      );
      continue;
    }
    const stripped = stripNamespace(ops, source);
    for (const op of stripped.refused) {
      ctx.err(
        `corpus: proposal ${printable(op.id)} for ${file} lacks the namespace ${source.namespace}: that file's ids carry; not written`,
      );
    }
    const kept = stripped.ops;
    if (kept.length === 0) continue;
    for (const op of kept) written.add(`${op.kind}\u0000${op.id}`);
    const files: [string, SourceOp[]][] = [[file, kept]];
    const removals = kept.filter((o) => o.kind === "delete");
    if (removals.length > 0 && hasLanguages(source)) {
      for (const language of allTargets) {
        files.push([fileOf(source, language, config.sourceLanguage), removals]);
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
          source.adapter === "android"
            ? applyAndroidOps(existing, targetOps)
            : source.adapter === "fluent"
              ? applyFluentOps(existing, targetOps)
              : source.adapter === "messages"
                ? applyMessagesOps(existing, targetOps, {
                    chrome: libraryOf(source) === "chrome",
                    plurals: readsPluralObjects(source),
                  })
                : source.adapter === "xliff"
                  ? applyXliffOps(existing, targetOps)
                  : source.adapter === "table"
                    ? applyTableOps(existing, targetOps, source.map)
                    : existing;
      } catch (error) {
        throw new CliError(
          `${target}: proposal(s) for ${targetOps.map((o) => printable(o.id)).join(", ")}: ${(error as Error).message}`,
        );
      }
      if (next !== existing) {
        if (!check) writeFileSync(path.join(ctx.cwd, target), next);
        changed.push(target);
      }
    }
  }

  let ran = 0;
  for (const source of config.sources) {
    if (source.adapter !== "exec" || !source.importCommand) continue;
    if (check && !source.importCheck) {
      ctx.err(
        `corpus: exec "${source.importCommand}" is not checked: set importCheck: true once it honours CORPUS_PULL_CHECK=1`,
      );
      continue;
    }
    const translations: PullPayload["translations"] = {};
    for (const [language, texts] of Object.entries(payload.translations)) {
      if (!targets.includes(language)) continue;
      translations[language] = Object.fromEntries(
        Object.entries(texts).filter(
          ([id]) => !claimedTypes.has(payload.types[id] ?? ""),
        ),
      );
    }
    // Under --check the importer is asked, through the environment, which
    // reaches it through `npm run` and a chained command where a flag
    // would not, to report and not write (#659).
    const command = source.importCommand;
    const result = spawnSync(command, {
      shell: true,
      cwd: ctx.cwd,
      encoding: "utf8",
      env: { ...process.env, CORPUS_PULL_CHECK: check ? "1" : undefined },
      input: JSON.stringify({ ...payload, translations }),
      maxBuffer: EXEC_MAX_BUFFER,
    });
    if (result.status !== 0) {
      throw new CliError(describeExecFailure(command, result, "import"));
    }
    ran++;
    // Under --check stdout is the list of files, so the rest goes aside.
    const say = (line: string) => (check ? ctx.err(line) : ctx.out(line));
    say(`ran ${command}${check ? " (CORPUS_PULL_CHECK=1)" : ""}`);
    for (const line of result.stderr.split(/\r?\n/)) {
      if (line.trim() !== "") say(`  ${line}`);
    }
    // An importer that prints `{"changed": [paths]}` as its last line
    // has its files counted with the adapters' (#659); one that does
    // not is its own account, as before (#599), and is no check.
    const reported = changedFiles(result.stdout);
    if (reported) {
      for (const file of reported) {
        const rel = repoPath(ctx.cwd, file);
        if (rel === undefined)
          throw new CliError(
            `exec "${command}" reported ${file} changed, which is outside the repository`,
          );
        changed.push(rel);
      }
    } else if (check)
      ctx.err(
        `corpus: exec "${source.importCommand}" is not checked: it printed no {"changed": […]} line under CORPUS_PULL_CHECK=1`,
      );
  }

  if (check) {
    const files = [...new Set(changed)];
    for (const file of files) ctx.out(file);
    ctx.out(
      `pull --check ${config.project} at ${minState}: ${files.length} file(s) would change`,
    );
    return files.length === 0 ? 0 : 1;
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
  if (written.size > 0) {
    ctx.out(
      `${written.size} proposal(s) written: commit and push, and the next corpus push marks them applied`,
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
  if (source.adapter === "android") {
    return new Set(
      androidToEntries(template, { type: source.type }).map((e) => e.id),
    );
  }
  if (source.adapter === "fluent") {
    const prefix = source.namespace ? `${source.namespace}:` : "";
    try {
      return new Set(
        fluentToEntries(template, { type: source.type }).map(
          (e) => `${prefix}${e.id}`,
        ),
      );
    } catch {
      return undefined;
    }
  }
  if (source.adapter === "xliff") {
    try {
      return new Set(xliffUnits(template).map((u) => u.id));
    } catch {
      return undefined;
    }
  }
  if (source.adapter === "xcstrings")
    try {
      return new Set(
        xcstringsToEntries(template, { type: source.type }).map((e) => e.id),
      );
    } catch {
      return undefined;
    }
  if (source.adapter === "gettext")
    return new Set(
      parsePo(template).flatMap((e) => (e.msgid === "" ? [] : [poId(e)])),
    );
  if (source.adapter !== "messages") return undefined;
  try {
    const entries = messagesToEntries(JSON.parse(stripBom(template)), {
      type: source.type,
      arb: isArb(source.path),
      chrome: libraryOf(source) === "chrome",
      plurals: readsPluralObjects(source),
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

// The files an importer says it changed, from its last stdout line.
function changedFiles(stdout: string): string[] | undefined {
  const last = stdout.trimEnd().split(/\r?\n/).pop()?.trim();
  if (!last?.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(last) as { changed?: unknown };
    return Array.isArray(parsed.changed) &&
      parsed.changed.every((f) => typeof f === "string")
      ? (parsed.changed as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

// A path an importer reported, as the adapters' are written: relative
// to the repository, forward slashes; undefined outside it.
function repoPath(cwd: string, file: string): string | undefined {
  const rel = path.relative(cwd, path.resolve(cwd, file.replaceAll("\\", "/")));
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    return undefined;
  return rel.split(path.sep).join("/");
}

function xcstringsInto(
  file: string,
  existing: string | undefined,
  translations: Record<string, string>,
  language: string,
): string | undefined {
  if (existing === undefined) return undefined;
  try {
    return entriesToXcstrings(existing, translations, language);
  } catch (error) {
    throw new CliError(`${file}: ${(error as Error).message}`);
  }
}
