// `corpus agent` (§3): the seven tools as subcommands for an agent that
// has a shell and no MCP client. Each prints the API's JSON on stdout;
// any answer that is not a 2xx prints the server's error and message
// on stderr and exits 1.
import { option } from "./args";
import type { RunContext } from "./cli";
import { CliError, loadConfig, requireToken } from "./config";
import { apiOver, tools, type ToolResult } from "./agent-tools";

export const AGENT_USAGE =
  "corpus agent queue <untranslated|stale|unverifiedSource|agentDrafts> [--lang <l>] [--type <t>] | string <key> | draft <key> <lang> <text> | propose <key> (--text <t> | --remove) | add <key> --file <f> --text <t> | status";

type Call = { tool: string; args: Record<string, string> };

// The subcommand's words as a tool call; a CliError names what is
// missing, in the usage's terms.
export function parseAgent(argv: string[]): Call {
  const [sub, ...rest] = argv;
  const positional = rest.filter(
    (a, i) => !a.startsWith("--") && !(rest[i - 1] ?? "").startsWith("--"),
  );
  const need = (value: string | undefined, what: string): string => {
    if (!value)
      throw new CliError(
        `corpus agent ${sub}: ${what} is missing\n${AGENT_USAGE}`,
      );
    return value;
  };
  switch (sub) {
    case "queue": {
      const args: Record<string, string> = {
        queue: need(positional[0], "the queue"),
      };
      const lang = option(rest, "--lang");
      const type = option(rest, "--type");
      if (lang) args.language = lang;
      if (type) args.type = type;
      return { tool: "list_queue", args };
    }
    case "string":
      return {
        tool: "get_string",
        args: { key: need(positional[0], "the key") },
      };
    case "draft":
      return {
        tool: "save_draft",
        args: {
          key: need(positional[0], "the key"),
          language: need(positional[1], "the language"),
          text: need(positional.slice(2).join(" "), "the text"),
        },
      };
    case "propose": {
      const key = need(positional[0], "the key");
      if (rest.includes("--remove"))
        return { tool: "propose_removal", args: { key } };
      return {
        tool: "propose_change",
        args: { key, text: need(option(rest, "--text"), "--text or --remove") },
      };
    }
    case "add":
      return {
        tool: "add_string",
        args: {
          key: need(positional[0], "the key"),
          file: need(option(rest, "--file"), "--file"),
          text: need(option(rest, "--text"), "--text"),
        },
      };
    case "status":
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
  const result: ToolResult = await tool.call(call.args);
  const text = result.content.map((c) => c.text).join("\n");
  if (result.isError) {
    ctx.err(`corpus: ${text}`);
    return 1;
  }
  ctx.out(text);
  return 0;
}
