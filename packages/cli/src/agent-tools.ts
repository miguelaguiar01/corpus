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

// What the repository's build refuses (#1011): the server never holds
// those strings, so only the repository can say why one is missing;
// undefined where the build fails for another reason.
export type Refusals = () => Promise<
  { id: string; reason: string }[] | undefined
>;

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

const QUEUES = [
  "untranslated",
  "stale",
  "unverifiedSource",
  "agentDrafts",
  "invalid",
];

const key = {
  type: "string",
  description: "The string's key, as in the source file.",
};
const language = {
  type: "string",
  description: "A language code of the project, such as pt-PT.",
};

export function tools(api: Api, refusals?: Refusals): Tool[] {
  const str = (args: Record<string, unknown>, name: string) =>
    String(args[name] ?? "");
  const segment = (value: string) => encodeURIComponent(value);
  return [
    {
      name: "list_queue",
      op: "queue",
      description:
        "The items of one queue: untranslated, stale, unverifiedSource, agentDrafts, or invalid (translations the repository holds that fail validation); narrowed to a language and a string type when given. Each item is a key, a language, the string's type, its source text and the row's current text (null when there is none), an invalid item also its problem, what is wrong as the editor says it, and an untranslated item its suggestion where the repository offers one (a gettext fuzzy row or a Qt unfinished translation, which the app may already ship: a starting point, not a translation), so a batch can be translated from the queue alone and the agent drafts queue reads back as a review list.",
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
        "One string as the editor shows it: source text, its library (icu, an apostrophe being the character; formatjs, ICU as FormatJS reads it, where an apostrophe before a brace, a tag or a plural's # quotes it into text and '' is one apostrophe; lingui, ICU as Lingui reads it, where an apostrophe before a brace or a plural's # quotes only up to the apostrophe that closes it, and is the character where none does; gen_l10n, Flutter's ICU subset, where # is text (write {count}), a date or time takes a ::skeleton and number, selectordinal and offset do not exist; fmt, libfmt's and Python str.format's {name} and {name:spec} fields named by their name, {} by position, {{ and }} literal braces, a name the source lacks or any other brace aborting the program; i18next with {{name}} interpolation; vue with pipe plurals and {'…'} literals; printf with %s and %[2]s verbs named by their position, and Python's %(name)s named by its key, each slot carrying the verb as written; chrome with $NAME$ placeholders named without regard to case; counterpart with %(name)s placeholders and <tag> substitutions, a bare <pill> needing no close; easy_localization with positional {} and named {name} placeholders and @:key links, each kept as written; rails with %{name} placeholders, other braces being text; qt with %0–%99, %L1 and %n placeholders by number, any other % and <…> being text; or fluent, a .ftl message read as ICU, whose names may hold hyphens ({cards-per-minute}), whose term references are placeholders named after the term with their arguments ({-brand(case: \"gen\")}, which a translation may change, and a term the source lacks it may add), whose message references are {@name}, apart from a variable {name} (a translation may refer to a message the source does not and must keep one it does), and whose plurals and selects may nest in their own kind; a translation writes placeholders the same way), arguments where the key names the verbs the code passes by position (a String Catalog's %lld: values a translation may pluralise on as argN or print, though the source may print none), or, under a library that names its values, the names the repository declares its code passes beside the source's (Discourse's number beside count: a translation may print or pluralise on them, and printing one shows the count), placeholders, selects, plurals (a selectordinal among them, counted by the language's ordinal rule: English one, two, few, other for 1st, 2nd, 3rd, 4th), forms (how many vue pipe forms the source has, separated by |, 0 otherwise; a translation writes the forms its language's pluralization rule picks from, and where formMeanings is given the project runs vue-i18n's default rule, which reads a translation's forms by the source's count: write exactly that many, each for what formMeanings says, =1 | other or =0 | =1 | other) and the rich-text tags a translation must keep (unless richText is html: the text is read as HTML and a translation may write its own tags, closing those it opens, and attributePlaceholders lists the placeholders a translation must write inside its tags' attributes, where the source does, as it does for a tag read as prose under any reading), each slot with what the repository declares for it (description and role, null where it declares none) and its first example value per language, a target language with none taking the source language's, listed in fromSource, and missing naming what the repository gives the slot none of (description, role, example), so an absence is known to be one, examples with their values per language, every language's text and state, with whether it is invalid and its problem, what is wrong as the editor says it, and, where the repository offers one, a suggestion (a gettext fuzzy row or a Qt unfinished translation, which the app may already ship: a starting point that is not a translation and must still be validated), the string's own note from the repository and the type's note on voice and register, the glossary terms that occur in the source with their target renderings, the entities it refers to (characters, rooms and the like) with their names and attributes, any pending proposal, and its siblings (the ten nearest strings of the same type under the same key prefix, or in the same i18next plural family, with their translations) so a set reads as one. A string the repository no longer gives the server is archived: true, and where the build refuses its text, refused says why, as file [key]: reason.",
      inputSchema: {
        type: "object",
        properties: { key },
        required: ["key"],
        additionalProperties: false,
      },
      call: async (args) => {
        const result = await api(
          "GET",
          `/api/strings/${segment(str(args, "key"))}`,
        );
        const row = result.structuredContent;
        const archived = !result.isError && row?.archived === true;
        if (
          !refusals ||
          !(archived || result.content[0]?.text.startsWith("not-found:"))
        )
          return result;
        const refused = (await refusals())?.find(
          (r) => r.id === String(args.key),
        );
        if (!refused) return result;
        // A string the project held before the build refused it is
        // archived: the row is real, and the refusal says why (#1111).
        if (archived) {
          const answered = { ...row, refused: refused.reason };
          return {
            content: [
              { type: "text", text: JSON.stringify(answered, null, 2) },
            ],
            structuredContent: answered,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `refused: ${refused.reason}; it is in the repository, so do not add it: the build leaves it out of every push until its text in the source file, or the config, is fixed (as read when this session first asked; a new session reads it again)`,
            },
          ],
          isError: true,
        };
      },
    },
    {
      name: "save_draft",
      op: "draft",
      description:
        "Save a translation as a draft for a maintainer to verify. Accepted on an untranslated row, a stale row, an invalid seed or your own earlier draft; refused (human-edited) where a person's work is, in which case propose instead. An untranslated row's suggestion may be text the app already ships, a translator's unfinished work: read it before replacing it. Placeholders and selects must match the source.",
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
        "Propose a new string into one of the project's writable source files, by the file's path as push declared it or as get_string reports it; a file whose ids carry a namespace (admin:title) gives the key its prefix.",
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
        "The project's numbers: strings, last push, pending proposals, the writable sources proposals can go into (null until a push declares them), progress per language and per string type, sourceVariants, the target languages that fall back to the source language, whose untranslated rows are no work (their counts stay raw), and refusedSourceStrings, how many of the repository's source strings the build refuses, which the server never receives (get_string on one says why), as the repository was when this session first asked; absent when the build fails for another reason.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      call: async () => {
        const [result, refused] = await Promise.all([
          api("GET", "/api/status"),
          refusals?.(),
        ]);
        if (!refused || result.isError || !result.structuredContent)
          return result;
        const counted = {
          ...result.structuredContent,
          refusedSourceStrings: refused.length,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(counted, null, 2) }],
          structuredContent: counted,
        };
      },
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
