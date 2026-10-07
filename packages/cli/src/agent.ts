// `corpus agent` (§3): the tools as subcommands for an agent that
// has a shell and no MCP client. Each prints the API's JSON on stdout;
// any answer that is not a 2xx prints the server's error and message
// on stderr and exits 1.
import { createInterface } from "node:readline";
import type { RunContext } from "./cli";
import { refusalsIn } from "./build";
import { CliError, loadConfig, requireToken } from "./config";
import {
  apiOver,
  argumentProblem,
  tools,
  type ToolResult,
} from "./agent-tools";

export const AGENT_USAGE =
  "corpus agent queue <untranslated|stale|unverifiedSource|agentDrafts|invalid> [--lang <l>] [--type <t>] | string <key> | draft <key> <lang> <text> | propose <key> (--text <t> | --remove) | add <key> --file <f> --text <t> | proposals | withdraw <id> | status | --stdin";

type Call = { tool: string; args: Record<string, string> };

// Each --stdin op with one line that runs it (#1077); --help lists its
// fields from the tool's own schema, so the two cannot drift.
export const STDIN_OPS: { op: string; example: string }[] = [
  {
    op: "queue",
    example:
      '{"op":"queue","queue":"untranslated","language":"pt-PT","type":"ui","id":"q1"}',
  },
  { op: "string", example: '{"op":"string","key":"ui.save"}' },
  {
    op: "draft",
    example:
      '{"op":"draft","key":"ui.save","language":"pt-PT","text":"Guardar","id":"d1"}',
  },
  {
    op: "propose",
    example: '{"op":"propose","key":"ui.save","text":"Save changes"}',
  },
  { op: "remove", example: '{"op":"remove","key":"ui.old"}' },
  {
    op: "add",
    example:
      '{"op":"add","key":"ui.new","file":"src/locales/en.json","text":"New"}',
  },
  { op: "status", example: '{"op":"status"}' },
  { op: "proposals", example: '{"op":"proposals"}' },
  { op: "withdraw", example: '{"op":"withdraw","proposal":"12"}' },
];

// What `corpus agent --help` says of --stdin: each op, its fields (`?`
// where optional) and its example line.
export function stdinHelp(): string {
  const table = tools(apiOver("http://localhost:0", "t"));
  const lines = [
    'corpus agent --stdin reads one JSON object per line, each with "op" and an optional "id" echoed back, and answers each with one line: {"id", "op", "ok", "result"} or {"id", "op", "ok": false, "error", "message"}.',
  ];
  for (const { op, example } of STDIN_OPS) {
    const tool = table.find((t) => t.op === op)!;
    const required = new Set(tool.inputSchema.required ?? []);
    const fields = Object.keys(tool.inputSchema.properties).map((name) =>
      name === "queue"
        ? "queue (or state)"
        : required.has(name)
          ? name
          : `${name}?`,
    );
    lines.push(
      `  ${op.padEnd(11)}${fields.length ? fields.join(", ") : "(no fields)"}`,
      `  ${"".padEnd(11)}${example}`,
    );
  }
  return lines.join("\n");
}

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
    case "proposals":
      only(0);
      return { tool: "list_proposals", args: {} };
    case "withdraw":
      only(1);
      return {
        tool: "withdraw_proposal",
        args: { proposal: positional[0] ?? missing("the id") },
      };
    default:
      throw new CliError(`usage: ${AGENT_USAGE}`);
  }
}

export async function agent(argv: string[], ctx: RunContext): Promise<number> {
  if (argv[0] === "--stdin") {
    if (argv.length > 1) {
      throw new CliError(
        `corpus agent --stdin: unexpected word ${argv[1]}\n${AGENT_USAGE}`,
      );
    }
    return agentStdin(ctx);
  }
  const call = parseAgent(argv);
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env, ctx.cwd);
  const tool = tools(
    apiOver(config.server, token),
    refusalsIn(config, ctx.cwd),
  ).find((t) => t.name === call.tool);
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

// Many operations through one process (§3): JSON lines in, one JSON
// line out per operation in order, `ok` true with the result or false
// with the server's error and message; a line that is not an operation
// answers `bad-line`, an unreachable server `unreachable`, and the batch
// goes on. Exit 1 when any line failed, so a batch is a check as well
// as a run.
async function agentStdin(ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env, ctx.cwd);
  const table = tools(
    apiOver(config.server, token),
    refusalsIn(config, ctx.cwd),
  );
  let failed = false;
  const answer = (line: Record<string, unknown> & { ok: boolean }) => {
    if (!line.ok) failed = true;
    ctx.out(JSON.stringify(line));
  };
  const lines = createInterface({
    input: ctx.input ?? process.stdin,
    crlfDelay: Infinity,
  });
  for await (const raw of lines) {
    if (raw.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      answer({ ok: false, error: "bad-line", message: "not a JSON object" });
      continue;
    }
    const { op, id, ...args } = parsed as Record<string, unknown>;
    const echo = id === undefined ? {} : { id };
    // A queue is named in `queue`, or in `state`, which names a state
    // everywhere else (#1077); `queue` wins.
    if (op === "queue") {
      if (args.queue === undefined) args.queue = args.state;
      delete args.state;
      if (args.queue === undefined) {
        answer({
          ...echo,
          op,
          ok: false,
          error: "bad-line",
          message: "queue is missing (its name goes in `queue`, or `state`)",
        });
        continue;
      }
    }
    const tool = table.find((t) => t.op === op);
    if (!tool) {
      answer({
        ...echo,
        op,
        ok: false,
        error: "bad-line",
        message: `op must be one of ${table.map((t) => t.op).join(", ")}`,
      });
      continue;
    }
    const problem = argumentProblem(tool, args);
    if (problem) {
      answer({ ...echo, op, ok: false, error: "bad-line", message: problem });
      continue;
    }
    let result: ToolResult;
    try {
      result = await tool.call(args);
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      answer({
        ...echo,
        op,
        ok: false,
        error: "unreachable",
        message: error.message,
      });
      continue;
    }
    const text = result.content.map((c) => c.text).join("\n");
    if (result.isError) {
      const [error, ...rest] = text.split(": ");
      answer({
        ...echo,
        op,
        ok: false,
        error: rest.length ? error : "failed",
        message: rest.length ? rest.join(": ") : text,
      });
      continue;
    }
    answer({ ...echo, op, ok: true, result: result.structuredContent ?? text });
  }
  return failed ? 1 : 0;
}
