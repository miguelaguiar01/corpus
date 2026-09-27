import type { QueuesResponse } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { inArray } from "drizzle-orm";
import { QUEUE_KINDS, queueItems, type QueueItem } from "@/catalogue/queues";
import { strings } from "@/db/schema";
import { problemOf } from "@/translations/validation-message";

// The dashboard's queues for an agent (§9.1, §10), narrowed by
// `?language=` and `?type=` when given.
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { project } = auth;

  const params = new URL(request.url).searchParams;
  const language = params.get("language");
  const type = params.get("type");
  if (language !== null && !project.languages.includes(language)) {
    return apiError(
      422,
      "unknown-language",
      `${language} is not a language of ${project.slug}`,
    );
  }

  const queues = {} as QueuesResponse["queues"];
  for (const kind of QUEUE_KINDS) {
    const listed = queueItems(db, project.id, kind, { language, type }).items;
    const problem = kind === "invalid" ? problems(listed) : undefined;
    const items = listed.map(
      ({ stringId, key, language, type, source, text }) => ({
        key,
        language,
        type,
        source,
        text,
        ...(problem && {
          problem: problem(stringId, language, type, source, text),
        }),
      }),
    );
    queues[kind] = { count: items.length, items };
  }
  // An invalid row says what is wrong with it, as the editor would.
  function problems(listed: QueueItem[]) {
    const syntaxOf = new Map(
      listed.length === 0
        ? []
        : db
            .select({ id: strings.id, syntax: strings.syntax })
            .from(strings)
            .where(
              inArray(strings.id, [...new Set(listed.map((i) => i.stringId))]),
            )
            .all()
            .map((row) => [row.id, row.syntax ?? "icu"] as const),
    );
    return (
      stringId: number,
      language: string,
      type: string,
      source: string,
      text: string | null,
    ) =>
      text === null
        ? null
        : problemOf(
            source,
            text,
            language,
            syntaxOf.get(stringId) ?? "icu",
            project.richText?.[type] ?? null,
          );
  }
  const body: QueuesResponse = {
    project: project.slug,
    language,
    type,
    queues,
  };
  return Response.json(body);
}
