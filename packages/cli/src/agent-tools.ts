// The operations an agent has (§3, §10), each one call to the API
// with the project token: the MCP tools and the `corpus agent`
// subcommands are two spellings of this table.
import { request } from "./server";

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

export type Tool = {
  name: string;
  // The operation's name on `corpus agent --stdin` (§3).
  op: string;
  description: string;
  inputSchema: JsonSchema;
  call: (args: Record<string, unknown>) => Promise<ToolResult>;
};

// One API call with the token; a 2xx is the body, anything else a tool
// error carrying the server's error and message.
export type Api = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<ToolResult>;

export function apiOver(server: string, token: string): Api {
  const base = server.replace(/\/$/, "");
  return async (method, path, body) => {
    const response = await request(`${base}${path}`, token, { method, body });
    const json: unknown = await response.json().catch(() => null);
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
      ...(json && typeof json === "object"
        ? { structuredContent: json as Record<string, unknown> }
        : {}),
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
      op: "queue",
      description:
        "The items of one queue: untranslated, stale, unverifiedSource or agentDrafts; narrowed to a language and a string type when given. Each item is a key, a language, the string's type, its source text and the row's current text (null when there is none), so a batch can be translated from the queue alone and the agent drafts queue reads back as a review list.",
      inputSchema: {
        type: "object",
        properties: {
          queue: { type: "string", description: "Which queue.", enum: QUEUES },
          language: {
            ...language,
            description: `${language.description} Optional.`,
          },
          type: {
            type: "string",
            description:
              "A string type of the project, as status lists them. Optional.",
          },
        },
        required: ["queue"],
        additionalProperties: false,
      },
      call: async (args) => {
        const query = new URLSearchParams();
        if (args.language) query.set("language", str(args, "language"));
        if (args.type) query.set("type", str(args, "type"));
        const suffix = query.size ? `?${query}` : "";
        const result = await api("GET", `/api/queues${suffix}`);
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
      op: "string",
      description:
        "One string as the editor shows it: source text, its library (icu; i18next with {{name}} interpolation; or vue with pipe plurals and {'…'} literals; a translation writes placeholders the same way), placeholders, selects, plurals and the rich-text tags a translation must keep, each slot with what the repository declares for it (description and role) and its first example value per language, examples with their values per language, every language's text and state, the type's note on voice and register, the glossary terms that occur in the source with their target renderings, the entities it refers to (characters, rooms and the like) with their names and attributes, any pending proposal, and its siblings (the ten nearest strings of the same type under the same key prefix, or in the same i18next plural family, with their translations) so a set reads as one.",
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
      op: "draft",
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
      op: "propose",
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
      op: "remove",
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
      op: "add",
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
      op: "status",
      description:
        "The project's numbers: strings, last push, pending proposals, the writable sources proposals can go into (null until a push declares them), progress per language and per string type.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      call: () => api("GET", "/api/status"),
    },
    {
      name: "list_proposals",
      op: "proposals",
      description:
        "The project's pending proposals: id, kind, key, file, text, author, and whether it is yours. A proposal stays pending until the change is pulled, committed and pushed, and the next corpus push marks it applied.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      call: () => api("GET", "/api/proposals"),
    },
    {
      name: "withdraw_proposal",
      op: "withdraw",
      description:
        "Withdraw one of your own pending proposals by id; a person's is refused.",
      // Named `proposal`, not `id`: on stdin `id` is the line's own.
      inputSchema: {
        type: "object",
        properties: {
          proposal: {
            type: "string",
            description: "The proposal's id, as list_proposals shows it.",
          },
        },
        required: ["proposal"],
        additionalProperties: false,
      },
      call: (args) =>
        api("DELETE", `/api/proposals/${segment(str(args, "proposal"))}`),
    },
  ];
}

// What a call is missing or has wrong, in the tool's terms; undefined
// when the arguments fit the schema.
export function argumentProblem(
  tool: Tool,
  args: Record<string, unknown>,
): string | undefined {
  // A number is taken as its digits, in place, so the call that follows
  // sees it: an id from list_proposals comes back as one.
  for (const [name, value] of Object.entries(args)) {
    if (typeof value === "number" && Number.isFinite(value))
      args[name] = String(value);
  }
  for (const name of tool.inputSchema.required ?? []) {
    if (typeof args[name] !== "string" || args[name] === "")
      return `${name} is missing or not a string`;
  }
  for (const [name, value] of Object.entries(args)) {
    const property = tool.inputSchema.properties[name];
    if (!property) return `unknown argument ${name}`;
    if (typeof value !== "string") return `${name} is not a string`;
    if (property.enum && !property.enum.includes(value))
      return `${name} must be one of ${property.enum.join(", ")}`;
  }
  return undefined;
}
