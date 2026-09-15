import { newStringBodySchema } from "@corpus/contract";
import { getDb } from "@/db";
import { ensureAgentActor } from "@/agents/actor";
import { authenticateProject } from "@/api/bearer";
import { readBody } from "@/api/body";
import { proposalCreated, proposalRefusal } from "@/api/proposal-response";
import { proposeAdd } from "@/proposals/service";

// A new string proposed through the token (§10, §11) into one of the
// writable sources push declared.
export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const body = await readBody(request, newStringBodySchema);
  if (!body.ok) return body.response;

  // The file may be the source as push declared it ({lang}) or the
  // source-language path a string response carries.
  const { file } = body.value;
  const source = (auth.project.sources ?? []).find(
    (s) =>
      s.path === file ||
      s.path.replace("{lang}", auth.project.sourceLanguage) === file,
  );
  const actor = ensureAgentActor(db, auth.project);
  const result = proposeAdd(db, {
    projectId: auth.project.id,
    key: body.value.key,
    sourcePath: source?.path ?? file,
    text: body.value.text,
    actor,
  });
  if (!result.ok) return proposalRefusal(result, body.value.key);
  return proposalCreated(result.proposal, actor.name);
}
