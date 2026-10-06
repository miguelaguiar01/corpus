import type { QueuesResponse } from "@corpus/contract";
import { richTextFor } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { QUEUE_KINDS, queueItems } from "@/catalogue/queues";
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
    const listed = queueItems(
      db,
      project.id,
      kind,
      { language, type },
      kind === "invalid",
      kind === "untranslated",
    ).items;
    // An invalid row says what is wrong with it, as the editor would.
    const items = listed.map(
      ({
        key,
        language,
        type,
        source,
        text,
        suggestion,
        syntax,
        arguments: args,
        placeholders,
        pluralForms,
        pluralShared,
      }) => ({
        key,
        language,
        type,
        source,
        text,
        // What the repository offers to start from (#1050).
        ...(suggestion && { suggestion }),
        ...(kind === "invalid" && {
          problem:
            text === null
              ? null
              : problemOf(
                  source,
                  text,
                  language,
                  syntax ?? "icu",
                  richTextFor(type, key, syntax ?? "icu", project.richText) ??
                    null,
                  args,
                  key,
                  project.sourceLanguage,
                  placeholders,
                  pluralForms?.[language],
                  pluralShared?.[language],
                ),
        }),
      }),
    );
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
