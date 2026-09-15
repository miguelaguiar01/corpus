// `corpus mcp` (§3): a Model Context Protocol server on stdio for an
// agent in the repository. Every tool is one call to the API of §10 with
// the project token; the server's refusals come back as tool errors
// with the server's own message. The protocol here is the tools subset
// of MCP over newline-delimited JSON-RPC, small enough to carry without
// the reference SDK and its web-server dependencies.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { RunContext } from "./cli";
import { loadConfig, requireToken } from "./config";
import { request } from "./server";

export const MCP_USAGE = "corpus mcp";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type JsonSchema = {
  type: "object";
  properties: Record<
    string,
    { type: string; description: string; enum?: string[] }
  >;
  required?: string[];
  additionalProperties: false;
};

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
};

// One API call with the token; a 2xx is the body, anything else a tool
// error carrying the server's error and message.
export type Api = (
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
) => Promise<ToolResult>;

export function apiOver(server: string, token: string): Api {
  const base = server.replace(/\/$/, "");
  return async (method, path, body) => {
    const response = await request(`${base}${path}`, token, { method, body });
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      const failure = (json ?? {}) as { error?: string; message?: string };
      const text =
        failure.error && failure.message
          ? `${failure.error}: ${failure.message}`
          : `HTTP ${response.status}`;
      return { content: [{ type: "text", text }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
      structuredContent: json as Record<string, unknown>,
    };
  };
}

const QUEUES = ["untranslated", "stale", "unverifiedSource", "agentDrafts"];

const key = {
  type: "string",
  description: "The string's key, as in the source file.",
};
const language = {
  type: "string",
  description: "A language code of the project, such as pt-PT.",
};

export function tools(api: Api): Tool[] {
  const str = (args: Record<string, unknown>, name: string) =>
    String(args[name] ?? "");
  const segment = (value: string) => encodeURIComponent(value);
  return [
    {
      name: "list_queue",
      description:
        "The items of one queue: untranslated, stale, unverifiedSource or agentDrafts; narrowed to a language when given. Each item is a key and a language.",
      inputSchema: {
        type: "object",
        properties: {
          queue: { type: "string", description: "Which queue.", enum: QUEUES },
          language: {
            ...language,
            description: `${language.description} Optional.`,
          },
        },
        required: ["queue"],
        additionalProperties: false,
      },
      call: async (args) => {
        const query = args.language
          ? `?language=${segment(str(args, "language"))}`
          : "";
        const result = await api("GET", `/api/queues${query}`);
        if (result.isError || !result.structuredContent) return result;
        const queues = result.structuredContent.queues as Record<
          string,
          unknown
        >;
        const picked = {
          queue: str(args, "queue"),
          ...(queues[str(args, "queue")] as object),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(picked, null, 2) }],
          structuredContent: picked,
        };
      },
    },
    {
      name: "get_string",
      description:
        "One string as the editor shows it: source text, placeholders and selects, examples with their values per language, every language's text and state, and any pending proposal.",
      inputSchema: {
        type: "object",
        properties: { key },
        required: ["key"],
        additionalProperties: false,
      },
      call: (args) => api("GET", `/api/strings/${segment(str(args, "key"))}`),
    },
    {
      name: "save_draft",
      description:
        "Save a translation as a draft for a maintainer to verify. Accepted on an untranslated row, a stale row or your own earlier draft; refused (human-edited) where a person's work is, in which case propose instead. Placeholders and selects must match the source.",
      inputSchema: {
        type: "object",
        properties: {
          key,
          language,
          text: {
            type: "string",
            description:
              "The translation, in ICU MessageFormat where the source is.",
          },
        },
        required: ["key", "language", "text"],
        additionalProperties: false,
      },
      call: (args) =>
        api(
          "PUT",
          `/api/strings/${segment(str(args, "key"))}/translations/${segment(str(args, "language"))}`,
          { text: str(args, "text") },
        ),
    },
    {
      name: "propose_change",
      description:
        "Propose new source text for a string. Pending until corpus pull writes it into the source file and a person merges.",
      inputSchema: {
        type: "object",
        properties: {
          key,
          text: { type: "string", description: "The new source text." },
        },
        required: ["key", "text"],
        additionalProperties: false,
      },
      call: (args) =>
        api("POST", `/api/strings/${segment(str(args, "key"))}/proposals`, {
          kind: "edit",
          text: str(args, "text"),
        }),
    },
    {
      name: "propose_removal",
      description:
        "Propose removing a string from its source file. Pending until corpus pull writes it and a person merges.",
      inputSchema: {
        type: "object",
        properties: { key },
        required: ["key"],
        additionalProperties: false,
      },
      call: (args) =>
        api("POST", `/api/strings/${segment(str(args, "key"))}/proposals`, {
          kind: "delete",
        }),
    },
    {
      name: "add_string",
      description:
        "Propose a new string into one of the project's writable source files, by the file's path as push declared it or as get_string reports it.",
      inputSchema: {
        type: "object",
        properties: {
          key,
          file: { type: "string", description: "The source file's path." },
          text: { type: "string", description: "The source text." },
        },
        required: ["key", "file", "text"],
        additionalProperties: false,
      },
      call: (args) =>
        api("POST", "/api/proposals", {
          key: str(args, "key"),
          file: str(args, "file"),
          text: str(args, "text"),
        }),
    },
    {
      name: "status",
      description:
        "The project's numbers: strings, last push, pending proposals, progress per language and per string type.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      call: () => api("GET", "/api/status"),
    },
  ];
}

type Request = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

function missing(
  tool: Tool,
  args: Record<string, unknown>,
): string | undefined {
  for (const name of tool.inputSchema.required ?? []) {
    if (typeof args[name] !== "string" || args[name] === "") return name;
  }
  for (const name of Object.keys(args)) {
    if (!(name in tool.inputSchema.properties)) return name;
  }
  return undefined;
}

// The server over any pair of streams, so a test can drive it without a
// process; `corpus mcp` binds it to stdin and stdout.
export function serve(
  input: Readable,
  output: Writable,
  api: Api,
  version: string,
): Promise<void> {
  const registry = tools(api);
  const reply = (id: Request["id"], body: object) => {
    output.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
  };
  const error = (id: Request["id"], code: number, message: string) =>
    reply(id, { error: { code, message } });

  const handle = async (message: Request) => {
    const { id, method, params = {} } = message;
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
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        const problem = missing(tool, args);
        if (problem)
          return error(
            id,
            -32602,
            `${tool.name}: ${problem} is missing or not a string`,
          );
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
      let message: Request;
      try {
        message = JSON.parse(line) as Request;
      } catch {
        error(null, -32700, "parse error");
        return;
      }
      pending = pending.then(() => handle(message));
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
    process.stdin,
    process.stdout,
    apiOver(config.server, token),
    cliVersion(),
  );
  return 0;
}
