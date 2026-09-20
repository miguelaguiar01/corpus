import { draftBodySchema, type DraftResponse } from "@corpus/contract";
import { getDb } from "@/db";
import { agentDraft } from "@/agents/draft";
import { authenticateProject } from "@/api/bearer";
import { apiError, readBody } from "@/api/body";

// A draft through the token (§10): the editor's save, attributed to the
// agent actor, refused where a person's current work is.
export async function PUT(
  request: Request,
  context: { params: Promise<{ key: string; lang: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const body = await readBody(request, draftBodySchema, (field) =>
    field === "state"
      ? "the token cannot verify; a signed-in maintainer does, in the workbench"
      : undefined,
  );
  if (!body.ok) return body.response;
  const { key, lang } = await context.params;

  const result = agentDraft(db, {
    project: auth.project,
    key,
    language: lang,
    text: body.value.text,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "not-found":
        return apiError(404, "not-found", `no string ${key}`);
      case "unknown-language":
        return apiError(
          422,
          "unknown-language",
          `${lang} is not a language of ${auth.project.slug}`,
        );
      case "source-row":
        return apiError(
          422,
          "source-row",
          "the source text comes from the repository and is not edited here",
        );
      case "archived":
        return apiError(409, "archived", `${key} is archived`);
      case "empty-text":
        return apiError(422, "empty-text", "the translation is empty");
      case "invalid-translation":
        return apiError(422, "invalid-translation", result.message);
      case "human-edited":
        return apiError(
          409,
          "human-edited",
          `${key} in ${lang} holds a person's work; propose a change if the source is the problem; otherwise leave the row to its author`,
        );
    }
  }
  const response: DraftResponse = {
    key: result.key,
    language: result.language,
    state: result.state,
    text: result.text,
    actor: result.actor,
  };
  return Response.json(response);
}
