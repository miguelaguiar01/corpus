import {
  placeholdersOf,
  selectArgsOf,
  type StringResponse,
} from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { pendingForString } from "@/proposals/service";
import { stringDetail } from "@/strings/detail";
import { siblingsOf } from "@/strings/siblings";

// What the editor shows for one string (§9.3), for an agent (§10).
export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { project } = auth;

  const { key } = await context.params;
  const detail = stringDetail(db, project.id, key);
  if (!detail) return apiError(404, "not-found", `no string ${key}`);

  const pending = pendingForString(db, detail.string.id);
  const siblings = siblingsOf(db, project.id, {
    id: detail.string.id,
    key: detail.string.key,
    type: detail.string.type,
    sourceLanguage: project.sourceLanguage,
  });
  const translations: StringResponse["translations"] = {};
  for (const [language, row] of Object.entries(detail.translations)) {
    translations[language] = {
      state: row.state,
      stale: row.stale,
      text: row.text,
      agentDraft: row.agentDraft,
    };
  }
  const body: StringResponse = {
    key: detail.string.key,
    type: detail.string.type,
    source: detail.string.source,
    sourceLanguage: project.sourceLanguage,
    file: detail.string.file,
    archived: detail.string.archived,
    placeholders: [...placeholdersOf(detail.string.source)],
    selects: [...selectArgsOf(detail.string.source)],
    examples: detail.string.examples ?? [],
    metadata: detail.string.metadata,
    translations,
    proposal: pending
      ? {
          id: pending.id,
          kind: pending.kind,
          text: pending.text,
          author: pending.author,
        }
      : null,
    siblings: siblings.items.map(({ key, source, translations }) => ({
      key,
      source,
      translations,
    })),
    siblingCount: siblings.total,
  };
  return Response.json(body);
}
