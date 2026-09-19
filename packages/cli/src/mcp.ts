// `corpus mcp` (§3): a Model Context Protocol server on stdio for an
// agent in the repository. Every tool is one call to the API of §10 with
// the project token; the server's refusals come back as tool errors
// with the server's own message. The protocol here is the tools subset
// of MCP over newline-delimited JSON-RPC, small enough to carry without
// the reference SDK and its web-server dependencies.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { apiOver, argumentProblem, tools, type Api } from "./agent-tools";
import type { RunContext } from "./cli";
import { loadConfig, requireToken } from "./config";

export const MCP_USAGE = "corpus mcp";

const PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

// What an agent is told at initialize: the rules of §10 in its own terms.
const INSTRUCTIONS =
  "Corpus holds this repository's strings and their translations. A draft you save lands on an untranslated row, a stale row or your own earlier draft; a row a person edited refuses with human-edited, so propose a change instead of retrying. Every draft is attributed to the project's agent actor and waits for a maintainer to verify it; you cannot verify. Placeholders and selects must survive translation. Proposals go into the project's writable sources, which status lists as writableSources; a project pushed before sources were declared has none until its next corpus push. A proposal stays pending until its change is pulled, committed and pushed and the next corpus push sees it; list_proposals shows the pending ones and withdraw_proposal takes back one of yours.";

type Message = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

// The server over any pair of streams, so a test can drive it without a
// process; `corpus mcp` binds it to stdin and stdout.
export function serve(
  input: Readable,
  output: Writable,
  api: Api,
  version: string,
): Promise<void> {
  const registry = tools(api);
  // Awaited, so a reply larger than the pipe's buffer is flushed before
  // the process exits on stdin's close.
  const reply = (id: Message["id"], body: object) =>
    new Promise<void>((resolve, reject) => {
      output.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`,
        (failure) => (failure ? reject(failure) : resolve()),
      );
    });
  const error = (id: Message["id"], code: number, message: string) =>
    reply(id, { error: { code, message } });

  const handle = async (message: Message) => {
    const { id, method } = message;
    const params =
      message.params && typeof message.params === "object"
        ? message.params
        : {};
    if (id === undefined || id === null) return; // a notification
    switch (method) {
      case "initialize": {
        const asked = String(params.protocolVersion ?? "");
        return reply(id, {
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked)
              ? asked
              : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: "corpus", version },
            instructions: INSTRUCTIONS,
          },
        });
      }
      case "ping":
        return reply(id, { result: {} });
      case "tools/list":
        return reply(id, {
          result: {
            tools: registry.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            })),
          },
        });
      case "tools/call": {
        const tool = registry.find((t) => t.name === params.name);
        if (!tool)
          return error(id, -32602, `unknown tool ${String(params.name)}`);
        const args = (
          params.arguments && typeof params.arguments === "object"
            ? params.arguments
            : {}
        ) as Record<string, unknown>;
        const problem = argumentProblem(tool, args);
        if (problem) return error(id, -32602, `${tool.name}: ${problem}`);
        try {
          return reply(id, { result: await tool.call(args) });
        } catch (caught) {
          return reply(id, {
            result: {
              content: [{ type: "text", text: (caught as Error).message }],
              isError: true,
            },
          });
        }
      }
      default:
        return error(id, -32601, `method not found: ${String(method)}`);
    }
  };

  return new Promise((resolve) => {
    const lines = createInterface({ input, crlfDelay: Infinity });
    let pending = Promise.resolve();
    lines.on("line", (line) => {
      if (line.trim() === "") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        pending = pending.then(() => error(null, -32700, "parse error"));
        return;
      }
      if (!parsed || typeof parsed !== "object") {
        pending = pending.then(() =>
          error(null, -32600, "a request is a JSON object"),
        );
        return;
      }
      pending = pending.then(() => handle(parsed as Message));
    });
    lines.on("close", () => {
      void pending.then(resolve);
    });
  });
}

// The CLI's own version, beside this module in the source tree and in
// the published dist alike.
function cliVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return manifest.version;
}

export async function mcp(ctx: RunContext): Promise<number> {
  const config = await loadConfig(ctx.cwd);
  const token = requireToken(ctx.env, ctx.cwd);
  ctx.err(`corpus mcp: ${config.project} on ${config.server}`);
  await serve(
    ctx.input ?? process.stdin,
    process.stdout,
    apiOver(config.server, token),
    cliVersion(),
  );
  return 0;
}
