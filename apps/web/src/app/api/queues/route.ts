import type { QueuesResponse } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { allQueues, QUEUE_KINDS } from "@/catalogue/queues";

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

  const all = allQueues(db, project.id);
  const queues = {} as QueuesResponse["queues"];
  for (const kind of QUEUE_KINDS) {
    const items = all[kind].items
      .filter((item) => language === null || item.language === language)
      .filter((item) => type === null || item.type === type)
      .map(({ key, language, type }) => ({ key, language, type }));
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
