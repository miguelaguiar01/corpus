import type { RunContext } from "./cli";
import { CODE_KEYED_ADAPTERS } from "./build";
import { CliError, loadConfig, requireToken } from "./config";
import { languageDrift } from "./project";
import { request, serverMessage, UNAUTHORIZED } from "./server";

export const STATUS_USAGE = "corpus status [--json]";

type Counts = {
  untranslated: number;
  translated: number;
  verified: number;
  stale: number;
  // Seeds that fail validation (#646); absent from an older server.
  invalid?: number;
  total: number;
};

export type Status = {
  project: string;
  sourceLanguage: string;
  languages: string[];
  strings: number;
  lastPushAt: string | null;
  version: string;
  pendingProposals?: number;
  // The declared writable sources (§4): paths, none, or null when the
  // last push predates the declaration.
  writableSources?: string[] | null;
  // The seed digests the last push carried per language (#601), null
  // before one and absent from an older server.
  seedDigests?: Record<string, string> | null;
  // The targets that fall back to the source (#699); absent from an
  // older server.
  sourceVariants?: string[];
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
  "invalid",
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
  for (const line of render(
    body,
    config.server,
    config.sources.map((s) => s.adapter),
  ))
    ctx.out(line);
  const drift = languageDrift(config.languages, body.languages);
  if (drift) ctx.err(`corpus: ${drift}`);
  return 0;
}

// Sources whose text is the code's own (a gettext msgid, a qt-ts tr()
// literal, a String Catalog key) take no proposals (#1004).
function codeKeyedOnly(adapters: readonly string[]): boolean {
  return (
    adapters.length > 0 &&
    adapters.every((a) =>
      (CODE_KEYED_ADAPTERS as readonly string[]).includes(a),
    )
  );
}

// `a`, `a and b`, `a, b and c`.
function listed(items: string[]): string {
  return items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function render(
  status: Status,
  server: string,
  // The config's file adapters, which say why no source takes proposals.
  adapters: readonly string[] = [],
): string[] {
  const lines: string[] = [];
  const pushed = status.lastPushAt
    ? `last push ${status.lastPushAt}`
    : "never pushed";
  lines.push(
    `${status.project} on ${server}: ${status.strings} string(s), ${pushed}, server ${status.version}`,
  );
  if (status.pendingProposals) {
    lines.push(
      `${status.pendingProposals} proposal(s) pending: corpus pull writes them`,
    );
  }
  if (status.writableSources === null && status.lastPushAt) {
    lines.push(
      "last pushed before sources were declared: run corpus push with this CLI, so proposals know where to go",
    );
  } else if (status.writableSources) {
    lines.push(
      status.writableSources.length === 0
        ? codeKeyedOnly(adapters)
          ? `proposals: none, since ${listed([...new Set(adapters)])} source text is the code's`
          : "no writable source: proposals are not possible on this project"
        : `writable sources: ${status.writableSources.join(", ")}`,
    );
  }
  const types = Object.keys(status.progress.perType).sort();
  // A variant's untranslated rows are no work: after the targets, named
  // so (#699).
  const variants = new Set(status.sourceVariants ?? []);
  const languages = [
    ...status.languages.filter((l) => !variants.has(l)),
    ...status.languages.filter((l) => variants.has(l)),
  ];
  const label = (language: string) =>
    variants.has(language)
      ? `${language} (falls back to ${status.sourceLanguage})`
      : language;
  // One first column for every table, so the tables line up.
  const first = Math.max(
    "language".length,
    ...types.map((t) => t.length),
    ...languages.map((l) => label(l).length),
  );
  lines.push("");
  lines.push(
    ...table("language", status.progress.perLanguage, languages, first, label),
  );
  for (const type of types) {
    lines.push("");
    lines.push(
      ...table(
        type,
        status.progress.perType[type] ?? {},
        languages,
        first,
        label,
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
  label: (language: string) => string = (language) => language,
): string[] {
  const empty: Counts = {
    untranslated: 0,
    translated: 0,
    verified: 0,
    stale: 0,
    total: 0,
  };
  const cells = languages.map((language) => [
    label(language),
    ...COLUMNS.map((c) => String((rows[language] ?? empty)[c] ?? 0)),
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
