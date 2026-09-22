import { writeFileSync } from "node:fs";
import type { Readable } from "node:stream";
import path from "node:path";
import {
  buildSnapshotReport,
  deprecations,
  describeRefused,
  pushOnlyNotes,
  type Refused,
} from "./build";
import { option, refuseUnknown } from "./args";
import { CliError, loadConfig, requireToken } from "./config";
import { checkFiles, READS } from "./check";
import { init, INIT_USAGE } from "./init";
import { agent, AGENT_USAGE } from "./agent";
import { MCP_USAGE, cliVersion, mcp } from "./mcp";
import { languageDrift, project, PROJECT_USAGE } from "./project";
import { pull } from "./pull";
import { request, serverMessage, UNAUTHORIZED } from "./server";
import { status, STATUS_USAGE } from "./status";
import { validate, VALIDATE_USAGE } from "./validate";
import { workbench, WORKBENCH_USAGE } from "./workbench";

export type RunContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  err: (line: string) => void;
  // Where `corpus agent --stdin` reads its operations; the process's
  // stdin when absent.
  input?: Readable;
};

const USAGE = `usage: corpus push [--dry-run] | corpus pull [--min-state <untranslated|translated|verified>] [--lang <l>]... [--check] | corpus check | corpus build [--out <file>]
       ${INIT_USAGE}
       ${WORKBENCH_USAGE}
       ${PROJECT_USAGE}
       ${STATUS_USAGE}
       ${VALIDATE_USAGE}
       ${MCP_USAGE}
       ${AGENT_USAGE}`;

// What each command takes, so anything else is a typo rather than a
// flag that silently does nothing (#520).
const KNOWN_FLAGS: Record<string, readonly string[]> = {
  push: ["--dry-run"],
  pull: ["--min-state", "--lang", "--check"],
  check: [],
  build: ["--out"],
  workbench: ["--port", "--db", "--open", "--no-provision"],
  init: [
    "--project",
    "--source",
    "--messages",
    "--languages",
    "--server",
    "--type",
    "--library",
    "--syntax",
  ],
  project: ["--name", "--server"],
  status: ["--json"],
  validate: ["--json"],
  mcp: [],
};

export async function run(argv: string[], ctx: RunContext): Promise<number> {
  const [command] = argv;

  if (command === "--help" || command === "-h" || command === "help") {
    ctx.out(USAGE);
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    ctx.out(cliVersion());
    return 0;
  }
  if (
    command === "push" ||
    command === "pull" ||
    command === "check" ||
    command === "build" ||
    command === "workbench" ||
    command === "init" ||
    command === "project" ||
    command === "status" ||
    command === "validate" ||
    command === "mcp" ||
    command === "agent"
  ) {
    try {
      // `agent` reads its own words, subcommand by subcommand.
      if (command !== "agent") {
        refuseUnknown(command, argv.slice(1), KNOWN_FLAGS[command] ?? []);
      }
      if (command === "init") return await init(argv.slice(1), ctx);
      if (command === "push") return await push(argv.slice(1), ctx);
      if (command === "build") return await build(argv.slice(1), ctx);
      if (command === "workbench") return await workbench(argv.slice(1), ctx);
      if (command === "project") return await project(argv.slice(1), ctx);
      if (command === "status") return await status(argv.slice(1), ctx);
      if (command === "validate") return await validate(argv.slice(1), ctx);
      if (command === "mcp") return await mcp(ctx);
      if (command === "agent") return await agent(argv.slice(1), ctx);
      if (command === "pull") return await pull(argv.slice(1), ctx);
      return await check(ctx);
    } catch (error) {
      if (error instanceof CliError) {
        ctx.err(`corpus: ${error.message}`);
        return 1;
      }
      throw error;
    }
  }

  ctx.err(USAGE);
  return 1;
}

type PushReport = {
  added: number;
  changed: number;
  stale: number;
  archived: number;
  seeded?: number;
  seedsIgnored?: number;
  seedsIdentical?: number;
};

// The snapshot is built and validated before the token is needed, so a
// config or an exporter can be fixed without a server in sight.
async function push(args: string[], ctx: RunContext): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const config = await loadConfig(ctx.cwd);
  const { snapshot, refused } = await buildSnapshotReport(config, ctx.cwd);
  for (const entry of refused) ctx.err(`corpus: ${describeRefused(entry)}`);
  for (const note of deprecations(config)) ctx.err(`corpus: ${note}`);
  for (const note of pushOnlyNotes(config)) ctx.err(`corpus: ${note}`);
  const token = requireToken(ctx.env, ctx.cwd);

  const url = `${config.server.replace(/\/$/, "")}/api/push${dryRun ? "?dryRun" : ""}`;
  const response = await request(url, token, {
    method: "POST",
    body: snapshot,
  });

  if (response.status === 401) {
    ctx.err(`corpus: ${UNAUTHORIZED}`);
    return 1;
  }
  if (response.status === 422) {
    const body = (await response.json()) as {
      errors?: { id: string; message: string }[];
    };
    ctx.err("corpus: the server rejected the snapshot:");
    for (const error of body.errors ?? []) {
      ctx.err(`  ${error.id}: ${error.message}`);
    }
    return 1;
  }
  if (!response.ok) {
    ctx.err(
      `corpus: push failed (HTTP ${response.status})${await serverMessage(response)}`,
    );
    return 1;
  }

  const { report, languages } = (await response.json()) as {
    report: PushReport;
    languages?: string[];
  };
  const label = dryRun ? "dry-run" : "pushed";
  const ignored = report.seedsIgnored;
  const identical = report.seedsIdentical;
  const beside = [
    ignored ? `${ignored} kept as Corpus has them` : "",
    identical ? `${identical} identical to the source, kept untranslated` : "",
  ].filter(Boolean);
  const alone = [
    ignored
      ? `${ignored} repository translation(s) kept as Corpus has them`
      : "",
    identical
      ? `${identical} repository translation(s) identical to the source, kept untranslated`
      : "",
  ].filter(Boolean);
  // Seed counts describe the catalogue the push carried, not what it
  // wrote, so they ride on a push that did something: a first push whose
  // every seed is the source text says why those rows are untranslated,
  // and a push that changes nothing says nothing about seeds at all.
  const applied = report.added || report.changed || report.archived;
  const seeded = report.seeded
    ? `, ${report.seeded} translation(s) seeded from the repository${beside.length ? ` (${beside.join("; ")})` : ""}`
    : applied && alone.length
      ? `, ${alone.join("; ")}`
      : "";
  ctx.out(
    `${label} ${config.project}: ${report.added} added, ${report.changed} changed, ${report.stale} stale, ${report.archived} archived${seeded}`,
  );
  if (languages) {
    const drift = languageDrift(config.languages, languages);
    if (drift) ctx.err(`corpus: ${drift}`);
  }
  return refusedExit(
    refused,
    ctx,
    dryRun
      ? "would not be pushed; a refused string the project holds would be archived until it parses"
      : "not pushed; a refused string the project holds is archived until it parses",
  );
}

function refusedExit(refused: Refused[], ctx: RunContext, fate: string) {
  if (refused.length === 0) return 0;
  ctx.err(`corpus: ${refused.length} string(s) refused and ${fate}`);
  return 1;
}

// `corpus build`: the snapshot without a server, for authoring the config.
async function build(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const { snapshot, refused } = await buildSnapshotReport(config, ctx.cwd);
  for (const entry of refused) ctx.err(`corpus: ${describeRefused(entry)}`);
  for (const note of deprecations(config)) ctx.err(`corpus: ${note}`);
  for (const note of pushOnlyNotes(config)) ctx.err(`corpus: ${note}`);
  const out = option(args, "--out");
  if (out) {
    writeFileSync(
      path.resolve(ctx.cwd, out),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
  const byType = (items: { type: string }[]) => {
    const counts = new Map<string, number>();
    for (const item of items)
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    return [...counts].map(([type, n]) => `${type} ${n}`).join(", ");
  };
  ctx.out(
    `built ${config.project}: ${snapshot.strings.length} string(s) (${byType(snapshot.strings) || "none"}), ${snapshot.entities.length} entity(ies) (${byType(snapshot.entities) || "none"})${out ? `, written to ${out}` : ""}`,
  );
  return refusedExit(refused, ctx, "left out of the snapshot");
}

// `corpus check` (§3): exit 1 with file:line: text per finding, 0 when clean.
async function check(ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const options = config.check ?? {};
  const include = options.include ?? ["src"];
  const { findings, scanned, unscanned } = checkFiles(ctx.cwd, {
    include,
    ignore: options.ignore,
    allow: (options.allow ?? []).map((source) => new RegExp(source, "u")),
  });
  // An entry that is not there narrows the lint as quietly as an unread
  // directory does, and a run kept green by its siblings never says so.
  for (const entry of unscanned) {
    ctx.err(
      entry.reason === "missing"
        ? `corpus: check.include names ${entry.dir}, which does not exist`
        : `corpus: check.include names ${entry.dir}, which is a file; it takes directories`,
    );
  }
  if (scanned.length === 0) {
    ctx.err(
      `corpus: check scanned nothing: no directory among ${include.join(", ")}; set check.include in corpus.config.ts to the directories with your components`,
    );
    return 1;
  }
  // A tree of .vue or .svelte components parses to nothing here, and a
  // clean bill over code the command never read is worse than a finding:
  // every such directory is named, and parsing nothing at all is fatal.
  const unread = scanned.filter((s) => s.parsed === 0).map((s) => s.dir);
  const parsed = scanned.reduce((n, s) => n + s.parsed, 0);
  if (unread.length > 0) {
    ctx.err(
      `corpus: check parsed no files in ${unread.join(", ")}; it reads ${READS}`,
    );
  }
  if (parsed === 0) return 1;
  for (const f of findings) ctx.err(`${f.file}:${f.line}: ${f.text}`);
  const tokens = findings.filter((f) => !/\s/.test(f.text)).length;
  if (findings.length >= 5 && tokens * 2 >= findings.length) {
    ctx.err(
      `corpus: ${tokens} of the ${findings.length} findings are single words or names; a name that stays untranslated goes in check.allow (regular expressions)`,
    );
  }
  if (findings.length > 0) {
    ctx.err(
      `corpus: ${findings.length} user-facing literal(s) outside declared sources`,
    );
    return 1;
  }
  ctx.out(
    `check: no user-facing literals outside declared sources in ${parsed} file(s)`,
  );
  return 0;
}
