import type { QueuesResponse } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { QUEUE_KINDS, queueItems } from "@/catalogue/queues";

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
    const items = queueItems(db, project.id, kind, {
      language,
      type,
    }).items.map(({ key, language, type, source, text }) => ({
      key,
      language,
      type,
      source,
      text,
    }));
    queues[kind] = { count: items.length, items };
  }
  const body: QueuesResponse = {
    project: project.slug,
    language,
    type,
    queues,
  };
  return Response.json(body);
}
