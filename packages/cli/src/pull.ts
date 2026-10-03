import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import {
  applyAndroidOps,
  applyFluentOps,
  entriesToAndroid,
  entriesToFluent,
  applyXliffOps,
  entriesToGettext,
  entriesToXcstrings,
  entriesToQtTs,
  entriesToYaml,
  applyYamlOps,
  entriesToXliff,
  applyMessagesOps,
  applyTableOps,
  entriesToMessages,
  entriesToTable,
  isBlank,
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
  lastWins,
  readEntries,
  sourcePluralIds,
  readsPluralObjects,
  readsSuffixPlurals,
  sourceWritesBack,
  takesProposals,
  writeBackRefusal,
} from "./build";
import { CliError, fileCodeOf, loadConfig, requireToken } from "./config";
import { request, serverMessage, UNAUTHORIZED } from "./server";

// `corpus pull` (§8): download translations at or above --min-state and
// write them back through the adapters. Files are only touched when
// their content changes, and every changed path is printed. `exec`
// sources get, on stdin, whatever the file adapters did not claim.
// `--lang` (repeatable) narrows both to those languages; `--check`
// writes nothing and exits 1 when a pull would change a file; an exec
// importer runs only where importCheck says it honours the check.
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

  const jiti = createJiti(import.meta.url);
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
    sourceIds.set(
      source,
      (await ownIds(
        jiti,
        ctx.cwd,
        fileOf(source, config.sourceLanguage, config.sourceLanguage),
        source,
        config.sourceLanguage,
      )) ?? new Set<string>(),
    );
  }
  const membersOf = (source: FileSource) => {
    const group = "group" in source ? source.group : undefined;
    return typeof group === "number" ? (groups.get(group) ?? []) : [];
  };

  // A string two files of one source share is written into each target
  // file that holds it, and into the first file's when none does, so a
  // push and a pull leave the files as they were (#661). An empty value
  // is a key the file lacks, as build seeds it (#970).
  const targetTexts = new Map<string, Map<string, string>>();
  const textIn = (member: FileSource, language: string, id: string) =>
    targetTexts.get(fileOf(member, language, config.sourceLanguage))?.get(id);
  const holds = (member: FileSource, language: string, id: string) =>
    !isBlank(textIn(member, language, id) ?? "");
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
        // Under last-wins the app reads the later file's (#953): that one
        // is written, and an earlier one only where it held the same
        // text, so a file that disagrees keeps what the app never shows
        // and a pull of what was pushed leaves every byte.
        if (lastWins(source)) {
          const inTarget = holders.filter((m) => holds(m, language, id));
          const winner = inTarget.at(-1);
          if (!winner) return holders.at(-1) === source;
          return (
            source === winner ||
            (inTarget.includes(source) &&
              textIn(source, language, id) === textIn(winner, language, id))
          );
        }
        // Where none holds a translation, each file that has the key
        // takes it, `""` left by an extraction tool included, since the
        // app may read any of them; where none has it, the first.
        const filled = holders.filter((m) => holds(m, language, id));
        if (filled.length > 0) return filled.includes(source);
        const keyed = holders.filter(
          (m) => textIn(m, language, id) !== undefined,
        );
        if (keyed.length > 0) return keyed.includes(source);
        return holders[0] === source;
      }),
    );
  };

  // Read before anything is written: what the files held when the pull
  // began decides where a shared string goes.
  // A target's plural object without `other` is read as build reads it
  // (#950), or the file that holds it would seem not to.
  for (const members of groups.values())
    for (const member of members) {
      const pluralIds = await sourcePluralIds(
        jiti,
        ctx.cwd,
        member,
        config.sourceLanguage,
      ).catch(() => undefined);
      for (const language of targets) {
        const file = fileOf(member, language, config.sourceLanguage);
        if (targetTexts.has(file)) continue;
        targetTexts.set(
          file,
          (await ownTexts(jiti, ctx.cwd, file, member, language, pluralIds)) ??
            new Map<string, string>(),
        );
      }
    }

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
    if (writeBackRefusal(source)) continue;
    const templatePath = fileOf(
      source,
      config.sourceLanguage,
      config.sourceLanguage,
    );
    if (!existsSync(path.join(ctx.cwd, templatePath))) continue;
    const held = heldByType.get(source.type) ?? new Set<string>();
    const own = await ownIds(
      jiti,
      ctx.cwd,
      templatePath,
      source,
      config.sourceLanguage,
    );
    for (const id of own ?? []) held.add(id);
    heldByType.set(source.type, held);
  }
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    // Its ids stay available to an exec importer rather than vanishing.
    const refusal = writeBackRefusal(source);
    if (refusal) {
      ctx.err(`corpus: ${refusal}`);
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
    const own = await ownIds(
      jiti,
      ctx.cwd,
      templatePath,
      source,
      config.sourceLanguage,
    );
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
      let next: string | undefined;
      try {
        next = writeTarget(
          source,
          file,
          template,
          translations,
          existing,
          language,
          config,
          ctx.err,
        );
      } catch (error) {
        // A target file that does not read is left as it is, and the
        // other languages are written (#1028).
        const unread = await unreadable(jiti, ctx.cwd, file, source, language);
        if (existing === undefined || unread === undefined) throw error;
        ctx.err(
          `corpus: ${file}: does not read, so pull leaves it as it is (${unread})`,
        );
        continue;
      }
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
    if (!source || !takesProposals(source)) {
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
    // Each file with the language code its root key is, for yaml.
    // The source's own file is rooted at its code too (#994).
    const files: [string, SourceOp[], string][] = [
      [file, kept, fileCodeOf(source, config.sourceLanguage)],
    ];
    const removals = kept.filter((o) => o.kind === "delete");
    // The source's plurals before its proposals, which say what a target's
    // objects are (#984).
    const pluralIds =
      removals.length > 0
        ? await sourcePluralIds(jiti, ctx.cwd, source, config.sourceLanguage)
        : undefined;
    if (removals.length > 0 && hasLanguages(source)) {
      for (const language of allTargets) {
        files.push([
          fileOf(source, language, config.sourceLanguage),
          removals,
          fileCodeOf(source, language),
        ]);
      }
    }
    for (const [target, targetOps, code] of files) {
      const existing = readRepoFile(ctx.cwd, target);
      if (existing === undefined) {
        if (target === file)
          throw new CliError(`source file ${file} does not exist`);
        continue;
      }
      let next: string;
      try {
        next = applyOps(
          source,
          existing,
          targetOps,
          code,
          config.sourceLanguage,
          target === file ? undefined : pluralIds,
        );
      } catch (error) {
        // A removal into a target file that does not read leaves it as
        // it is (#1028); the source file's own failure stops the pull.
        const unread =
          target === file
            ? undefined
            : await unreadable(jiti, ctx.cwd, target, source);
        if (unread !== undefined) {
          ctx.err(
            `corpus: ${target}: does not read, so pull leaves it as it is (${unread})`,
          );
          continue;
        }
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

// The target file `source` writes for `language`, with each refusal said
// through `err`; undefined when there is no file to write.
function writeTarget(
  source: FileSource,
  file: string,
  template: string,
  translations: Record<string, string>,
  existing: string | undefined,
  language: string,
  config: CorpusConfig,
  err: (line: string) => void,
): string | undefined {
  const refused = (id: string, why: string) =>
    err(`corpus: ${file}: ${printable(id)} ${why}; not written`);
  switch (source.adapter) {
    case "android":
      return entriesToAndroid(template, translations, existing);
    case "fluent":
      return entriesToFluent(template, translations, existing);
    case "messages":
      return entriesToMessages(template, translations, existing, {
        ...(isArb(file) && { locale: language }),
        chrome: libraryOf(source) === "chrome",
        plurals: readsPluralObjects(source),
        suffixPlurals: readsSuffixPlurals(source),
        sourceLanguage: config.sourceLanguage,
        onRefused: (id) =>
          refused(
            id,
            "is a plural its object cannot hold (an =N branch, or a brace a form leaves open)",
          ),
        onList: (id) =>
          refused(id, "is a list in the file, which Corpus cannot read"),
      });
    case "xliff":
      return entriesToXliff(template, translations, existing, language, (id) =>
        refused(id, "is a unit of the file Corpus cannot read"),
      );
    case "gettext":
      return entriesToGettext(
        template,
        translations,
        existing,
        { tag: language, code: fileCodeOf(source, language) },
        (id) =>
          refused(
            id,
            "is a plural and its translation is not one gettext can hold (a plain text, an =N branch the file has no form for, or two texts for one form)",
          ),
        (note) => err(`corpus: ${file}: ${note}`),
      );
    case "qt-ts":
      return entriesToQtTs(
        template,
        translations,
        existing,
        { tag: language, code: fileCodeOf(source, language) },
        (id) =>
          refused(
            id,
            "is a numerus message and its translation is not one plural Qt can hold (a plain text, or an =N branch)",
          ),
      );
    case "yaml":
      return entriesToYaml(
        template,
        translations,
        existing,
        {
          source: fileCodeOf(source, config.sourceLanguage),
          code: fileCodeOf(source, language),
        },
        (id, _text, why) =>
          err(
            why === "plural"
              ? `corpus: ${file}: ${printable(id)} is a plural a Rails hash cannot hold (an =N branch, or text beside it); not written`
              : `corpus: ${file}: ${printable(id)}'s parent in the file is a scalar, a hash written inline or an alias; not written`,
          ),
      );
    case "xcstrings":
      return xcstringsInto(file, existing, translations, language, (id) =>
        refused(
          id,
          "is a plural a String Catalog cannot hold (an =N branch, or one that does not parse)",
        ),
      );
    case "table":
      return entriesToTable(template, translations, source.map, existing);
    default:
      return existing;
  }
}

// A source file with the proposals applied; `code` is the root key a
// yaml target file carries.
function applyOps(
  source: FileSource,
  existing: string,
  ops: SourceOp[],
  code: string,
  sourceLanguage: string,
  pluralIds?: ReadonlySet<string>,
): string {
  switch (source.adapter) {
    case "android":
      return applyAndroidOps(existing, ops);
    case "fluent":
      return applyFluentOps(existing, ops);
    case "messages":
      return applyMessagesOps(existing, ops, {
        chrome: libraryOf(source) === "chrome",
        plurals: readsPluralObjects(source),
        suffixPlurals: readsSuffixPlurals(source),
        sourceLanguage,
        ...(pluralIds && { pluralIds }),
      });
    case "xliff":
      return applyXliffOps(existing, ops);
    case "yaml":
      return applyYamlOps(existing, ops, code);
    case "table":
      return applyTableOps(existing, ops, source.map);
    default:
      return existing;
  }
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

// Why a target file does not read through its source's adapter, or
// undefined where it does.
async function unreadable(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  file: string,
  source: FileSource,
  language?: string,
): Promise<string | undefined> {
  try {
    await readEntries(jiti, cwd, file, source, false, language);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
  const out = Object.create(null) as Record<string, string>;
  for (const [id, text] of Object.entries(
    payload.translations[language] ?? {},
  )) {
    if (payload.types[id] === type) out[id] = text;
  }
  return out;
}

export async function download(
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

// The ids a catalogue file holds, read as a source-language file, as
// the snapshot names them; unknown for a table, a file pull does not
// write back, or one that does not parse.
async function ownIds(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  file: string,
  source: FileSource,
  sourceLanguage: string,
): Promise<Set<string> | undefined> {
  if (!sourceWritesBack(source)) return undefined;
  try {
    // The language picks a messages source's plural families (#985); a
    // String Catalog names its own.
    const entries = await readEntries(
      jiti,
      cwd,
      file,
      source,
      true,
      source.adapter === "messages" ? sourceLanguage : undefined,
    );
    return new Set(entries.map((e) => e.id));
  } catch {
    return undefined;
  }
}

// A target file's translations by id: which files of a source hold a
// string they share, and, under last-wins, whether they agree.
async function ownTexts(
  jiti: ReturnType<typeof createJiti>,
  cwd: string,
  file: string,
  source: FileSource,
  language: string,
  pluralIds?: ReadonlySet<string>,
): Promise<Map<string, string> | undefined> {
  if (!sourceWritesBack(source)) return undefined;
  try {
    const entries = await readEntries(
      jiti,
      cwd,
      file,
      source,
      false,
      language,
      undefined,
      pluralIds,
    );
    return new Map(entries.map((e) => [e.id, e.source]));
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
  const out = Object.create(null) as Record<string, string>;
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
  onRefused: (id: string) => void,
): string | undefined {
  if (existing === undefined) return undefined;
  try {
    return entriesToXcstrings(existing, translations, language, onRefused);
  } catch (error) {
    throw new CliError(`${file}: ${(error as Error).message}`);
  }
}
