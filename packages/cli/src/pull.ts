import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { entriesToMessages, entriesToTable } from "@corpus/adapters";
import {
  MIN_STATES,
  pullPayloadSchema,
  type CorpusConfig,
  type MinState,
  type PullPayload,
} from "@corpus/contract";
import type { RunContext } from "./cli";
import { CliError, loadConfig, requireToken } from "./config";

// `corpus pull` (§8): download translations at or above --min-state and
// write them back through the adapters. Files are only touched when
// their content changes, and every changed path is printed. `exec`
// sources get, on stdin, whatever the file adapters did not claim.
export async function pull(args: string[], ctx: RunContext): Promise<number> {
  const minState = option(args, "--min-state") ?? "verified";
  if (!(MIN_STATES as readonly string[]).includes(minState)) {
    throw new CliError(`--min-state must be one of ${MIN_STATES.join(", ")}`);
  }
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env);

  const payload = await download(config, token, minState as MinState, ctx);
  if (payload === undefined) return 1;

  const changed: string[] = [];
  const claimedTypes = new Set<string>();
  for (const source of config.sources) {
    if (source.adapter === "exec") continue;
    if (!source.path.includes("{lang}")) {
      // Source-only: nothing to write back, and its ids stay available to
      // an exec importer rather than vanishing.
      ctx.err(
        `corpus: ${source.path} has no {lang}; its translations are not written`,
      );
      continue;
    }
    claimedTypes.add(source.type);
    const templatePath = source.path.replace("{lang}", config.sourceLanguage);
    const template = readRepoFile(ctx.cwd, templatePath);
    if (template === undefined) {
      throw new CliError(`source file ${templatePath} does not exist`);
    }
    for (const language of config.languages) {
      const file = source.path.replace("{lang}", language);
      const existing = readRepoFile(ctx.cwd, file);
      const translations = forType(payload, language, source.type);
      if (existing === undefined && Object.keys(translations).length === 0)
        continue;
      const next =
        source.adapter === "messages"
          ? entriesToMessages(template, translations, existing)
          : entriesToTable(template, translations, source.map, existing);
      if (next !== existing) {
        writeFileSync(path.join(ctx.cwd, file), next);
        changed.push(file);
      }
    }
  }

  for (const source of config.sources) {
    if (source.adapter !== "exec" || !source.importCommand) continue;
    const translations: PullPayload["translations"] = {};
    for (const [language, texts] of Object.entries(payload.translations)) {
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
    });
    if (result.status !== 0) {
      throw new CliError(
        `import "${source.importCommand}" exited ${result.status}: ${result.stderr?.trim()}`,
      );
    }
    ctx.out(`ran ${source.importCommand}`);
  }

  const importers = config.sources.filter(
    (s) => s.adapter === "exec" && s.importCommand,
  ).length;
  if (importers === 0) {
    const dropped = new Set(
      Object.values(payload.translations)
        .flatMap((texts) => Object.keys(texts))
        .filter((id) => !claimedTypes.has(payload.types[id] ?? "")),
    );
    if (dropped.size > 0) {
      ctx.err(
        `corpus: ${dropped.size} translation(s) belong to no writable source and were not written`,
      );
    }
  }

  for (const file of changed) ctx.out(file);
  ctx.out(
    `pulled ${config.project} at ${minState}: ${changed.length} file(s) changed`,
  );
  return 0;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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
  ctx: RunContext,
): Promise<PullPayload | undefined> {
  const url = `${config.server.replace(/\/$/, "")}/api/pull?minState=${minState}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (error) {
    throw new CliError(
      `could not reach the server at ${config.server}: ${(error as Error).message}`,
    );
  }
  if (response.status === 401) {
    ctx.err("corpus: unauthorized — check CORPUS_TOKEN for this project");
    return undefined;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    ctx.err(
      `corpus: pull failed (HTTP ${response.status})${body.message ? `: ${body.message}` : ""}`,
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
