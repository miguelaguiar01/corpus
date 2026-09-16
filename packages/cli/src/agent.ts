// `corpus agent` (§3): the seven tools as subcommands for an agent that
// has a shell and no MCP client. Each prints the API's JSON on stdout;
// any answer that is not a 2xx prints the server's error and message
// on stderr and exits 1.
import type { RunContext } from "./cli";
import { CliError, loadConfig, requireToken } from "./config";
import {
  apiOver,
  argumentProblem,
  tools,
  type ToolResult,
} from "./agent-tools";

export const AGENT_USAGE =
  "corpus agent queue <untranslated|stale|unverifiedSource|agentDrafts> [--lang <l>] [--type <t>] | string <key> | draft <key> <lang> <text> | propose <key> (--text <t> | --remove) | add <key> --file <f> --text <t> | status";

type Call = { tool: string; args: Record<string, string> };

const VALUED = new Set(["--lang", "--type", "--text", "--file"]);
// `--json` is accepted for symmetry with `corpus status --json`; the
// output is JSON either way.
const BARE = new Set(["--remove", "--json"]);

type Words = { positional: string[]; flags: Map<string, string | true> };

// The words after the subcommand: flags that take a value, flags that
// take none, and everything else in order. An unknown flag, or a
// valued one without a value, is refused rather than dropped.
function tokenize(sub: string, rest: string[]): Words {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (!word.startsWith("--")) {
      positional.push(word);
      continue;
    }
    if (BARE.has(word)) {
      flags.set(word, true);
      continue;
    }
    if (!VALUED.has(word)) {
      throw new CliError(
        `corpus agent ${sub}: unknown option ${word}\n${AGENT_USAGE}`,
      );
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(
        `corpus agent ${sub}: ${word} needs a value\n${AGENT_USAGE}`,
      );
    }
    flags.set(word, value);
    i++;
  }
  return { positional, flags };
}

export function parseAgent(argv: string[]): Call {
  const [sub = "", ...rest] = argv;
  const missing = (what: string): never => {
    throw new CliError(
      `corpus agent ${sub}: ${what} is missing\n${AGENT_USAGE}`,
    );
  };
  const { positional, flags } = tokenize(sub, rest);
  const valued = (name: string): string | undefined => {
    const v = flags.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const only = (count: number) => {
    if (positional.length > count) {
      throw new CliError(
        `corpus agent ${sub}: unexpected word ${positional[count]}\n${AGENT_USAGE}`,
      );
    }
  };
  switch (sub) {
    case "queue": {
      only(1);
      const args: Record<string, string> = {
        queue: positional[0] ?? missing("the queue"),
      };
      const lang = valued("--lang");
      const type = valued("--type");
      if (lang) args.language = lang;
      if (type) args.type = type;
      return { tool: "list_queue", args };
    }
    case "string":
      only(1);
      return {
        tool: "get_string",
        args: { key: positional[0] ?? missing("the key") },
      };
    case "draft": {
      const [key, language, ...text] = positional;
      return {
        tool: "save_draft",
        args: {
          key: key ?? missing("the key"),
          language: language ?? missing("the language"),
          text: text.length ? text.join(" ") : missing("the text"),
        },
      };
    }
    case "propose": {
      only(1);
      const key = positional[0] ?? missing("the key");
      if (flags.has("--remove"))
        return { tool: "propose_removal", args: { key } };
      return {
        tool: "propose_change",
        args: { key, text: valued("--text") ?? missing("--text or --remove") },
      };
    }
    case "add":
      only(1);
      return {
        tool: "add_string",
        args: {
          key: positional[0] ?? missing("the key"),
          file: valued("--file") ?? missing("--file"),
          text: valued("--text") ?? missing("--text"),
        },
      };
    case "status":
      only(0);
      return { tool: "status", args: {} };
    default:
      throw new CliError(`usage: ${AGENT_USAGE}`);
  }
}

export async function agent(argv: string[], ctx: RunContext): Promise<number> {
  const call = parseAgent(argv);
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env, ctx.cwd);
  const tool = tools(apiOver(config.server, token)).find(
    (t) => t.name === call.tool,
  );
  if (!tool) throw new CliError(`no such operation ${call.tool}`);
  const problem = argumentProblem(tool, call.args);
  if (problem) throw new CliError(`corpus agent ${argv[0]}: ${problem}`);
  const result: ToolResult = await tool.call(call.args);
  const text = result.content.map((c) => c.text).join("\n");
  if (result.isError) {
    ctx.err(`corpus: ${text}`);
    return 1;
  }
  ctx.out(text);
  return 0;
}
