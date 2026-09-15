import { stringProposalBodySchema } from "@corpus/contract";
import { getDb } from "@/db";
import { ensureAgentActor } from "@/agents/actor";
import { authenticateProject } from "@/api/bearer";
import { apiError, readBody } from "@/api/body";
import { proposalCreated, proposalRefusal } from "@/api/proposal-response";
import { proposeDelete, proposeEdit } from "@/proposals/service";
import { stringDetail } from "@/strings/detail";

// An edit or a removal proposed through the token (§10, §11), by the
// agent actor, pending until a pull writes it and a person merges.
export async function POST(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const body = await readBody(request, stringProposalBodySchema);
  if (!body.ok) return body.response;
  const { key } = await context.params;
  const detail = stringDetail(db, auth.project.id, key);
  if (!detail) return apiError(404, "not-found", `no string ${key}`);

  const actor = ensureAgentActor(db, auth.project);
  const result =
    body.value.kind === "edit"
      ? proposeEdit(db, {
          stringRowId: detail.string.id,
          text: body.value.text,
          actor,
        })
      : proposeDelete(db, { stringRowId: detail.string.id, actor });
  if (!result.ok) return proposalRefusal(result, key);
  return proposalCreated(result.proposal, actor.name);
}
