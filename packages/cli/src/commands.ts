import { AGENT_USAGE } from "./agent";
import { INIT_USAGE } from "./init";
import { MCP_USAGE } from "./mcp";
import { PROJECT_USAGE } from "./project";
import { STATUS_USAGE } from "./status";
import { VALIDATE_USAGE } from "./validate";
import { WORKBENCH_USAGE } from "./workbench";

// The CLI's commands as data (#534): each one's usage line and the flags
// it takes, from which `corpus --help` and the refusal table are both
// derived, so a command cannot exist without a flag row, empty or not.
// A command that reads its own words, subcommand by subcommand, says so
// with `own`, and the dispatcher leaves its flags to it.
export type Command = {
  name: string;
  usage: string;
  flags: readonly string[] | "own";
};

export const COMMANDS: readonly Command[] = [
  { name: "push", usage: "corpus push [--dry-run]", flags: ["--dry-run"] },
  {
    name: "pull",
    usage:
      "corpus pull [--min-state <untranslated|translated|verified>] [--lang <l>]... [--check]",
    flags: ["--min-state", "--lang", "--check"],
  },
  { name: "check", usage: "corpus check", flags: [] },
  { name: "build", usage: "corpus build [--out <file>]", flags: ["--out"] },
  {
    name: "init",
    usage: INIT_USAGE,
    flags: [
      "--project",
      "--source",
      "--messages",
      "--languages",
      "--server",
      "--type",
      "--library",
      "--syntax",
    ],
  },
  {
    name: "workbench",
    usage: WORKBENCH_USAGE,
    flags: ["--port", "--db", "--open", "--no-provision"],
  },
  // `project` is dispatched by subcommand: a union of the two would let
  // `rotate-token --name X` through.
  {
    name: "project create",
    usage: PROJECT_USAGE.split(" | ")[0]!,
    flags: ["--name", "--server"],
  },
  {
    name: "project rotate-token",
    usage: PROJECT_USAGE.split(" | ")[1]!,
    flags: ["--server"],
  },
  { name: "status", usage: STATUS_USAGE, flags: ["--json"] },
  { name: "validate", usage: VALIDATE_USAGE, flags: ["--json"] },
  { name: "mcp", usage: MCP_USAGE, flags: [] },
  { name: "agent", usage: AGENT_USAGE, flags: "own" },
];

// How `corpus --help` lays the usages out: the four everyday commands
// on the first line, then one line per command, `project`'s two
// together.
const USAGE_LINES: readonly (readonly string[])[] = [
  ["push", "pull", "check", "build"],
  ["init"],
  ["workbench"],
  ["project create", "project rotate-token"],
  ["status"],
  ["validate"],
  ["mcp"],
  ["agent"],
];

export function usageOf(name: string): string {
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) throw new Error(`no command ${name}`);
  return command.usage;
}

export const USAGE = USAGE_LINES.map(
  (names, index) =>
    `${index === 0 ? "usage: " : "       "}${names.map(usageOf).join(" | ")}`,
).join("\n");

// What each command takes, so anything else is a typo rather than a
// flag that silently does nothing (#520).
export const KNOWN_FLAGS: Record<string, readonly string[]> =
  Object.fromEntries(
    COMMANDS.flatMap((c) => (c.flags === "own" ? [] : [[c.name, c.flags]])),
  );

// The first word of every command, for the dispatcher.
export const COMMAND_WORDS = new Set(
  COMMANDS.map((c) => c.name.split(" ")[0]!),
);
