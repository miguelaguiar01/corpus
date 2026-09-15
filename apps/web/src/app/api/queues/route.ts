import type { QueuesResponse } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { allQueues, QUEUE_KINDS } from "@/catalogue/queues";

// The dashboard's queues for an agent (§9.1, §10), every language or
// one named by `?language=`.
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { project } = auth;

  const language = new URL(request.url).searchParams.get("language");
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
      .map(({ key, language }) => ({ key, language }));
    queues[kind] = { count: items.length, items };
  }
  const body: QueuesResponse = { project: project.slug, language, queues };
  return Response.json(body);
}
