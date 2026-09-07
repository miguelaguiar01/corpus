import type { RunContext } from "./cli";
import { CliError, loadConfig, requireToken } from "./config";
import { languageDrift } from "./project";
import { request, serverMessage, UNAUTHORIZED } from "./server";

export const STATUS_USAGE = "corpus status [--json]";

type Counts = {
  untranslated: number;
  translated: number;
  verified: number;
  stale: number;
  total: number;
};

export type Status = {
  project: string;
  sourceLanguage: string;
  languages: string[];
  strings: number;
  lastPushAt: string | null;
  version: string;
  progress: {
    perLanguage: Record<string, Counts>;
    perType: Record<string, Record<string, Counts>>;
  };
};

const COLUMNS = [
  "untranslated",
  "translated",
  "verified",
  "stale",
  "total",
] as const;

// `corpus status` (§3): the dashboard's numbers in the terminal, and the
// languages the config and the project disagree on.
export async function status(args: string[], ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env, ctx.cwd);
  const url = `${config.server.replace(/\/$/, "")}/api/status`;
  const response = await request(url, token);
  if (response.status === 401) throw new CliError(UNAUTHORIZED);
  if (!response.ok) {
    throw new CliError(
      `status failed (HTTP ${response.status})${await serverMessage(response)}`,
    );
  }
  const body = (await response.json()) as Status;
  if (args.includes("--json")) {
    ctx.out(JSON.stringify(body, null, 2));
    return 0;
  }
  for (const line of render(body, config.server)) ctx.out(line);
  const drift = languageDrift(config.languages, body.languages);
  if (drift) ctx.err(`corpus: ${drift}`);
  return 0;
}

export function render(status: Status, server: string): string[] {
  const lines: string[] = [];
  const pushed = status.lastPushAt
    ? `last push ${status.lastPushAt}`
    : "never pushed";
  lines.push(
    `${status.project} on ${server}: ${status.strings} string(s), ${pushed}, server ${status.version}`,
  );
  const types = Object.keys(status.progress.perType).sort();
  // One first column for every table, so the tables line up.
  const first = Math.max(
    "language".length,
    ...types.map((t) => t.length),
    ...status.languages.map((l) => l.length),
  );
  lines.push("");
  lines.push(
    ...table("language", status.progress.perLanguage, status.languages, first),
  );
  for (const type of types) {
    lines.push("");
    lines.push(
      ...table(
        type,
        status.progress.perType[type] ?? {},
        status.languages,
        first,
      ),
    );
  }
  return lines;
}

// One table per grouping: a row per language in the project's order,
// the numbers right-aligned under their headings.
function table(
  heading: string,
  rows: Record<string, Counts>,
  languages: string[],
  first: number,
): string[] {
  const empty: Counts = {
    untranslated: 0,
    translated: 0,
    verified: 0,
    stale: 0,
    total: 0,
  };
  const cells = languages.map((language) => [
    language,
    ...COLUMNS.map((c) => String((rows[language] ?? empty)[c])),
  ]);
  const head = [heading, ...COLUMNS];
  const widths = head.map((h, i) =>
    Math.max(i === 0 ? first : h.length, ...cells.map((row) => row[i]!.length)),
  );
  const line = (row: string[]) =>
    row
      .map((cell, i) =>
        i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!),
      )
      .join("  ")
      .trimEnd();
  return [line(head), ...cells.map(line)];
}
