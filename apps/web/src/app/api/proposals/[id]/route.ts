import { getDb } from "@/db";
import { ensureAgentActor } from "@/agents/actor";
import { authenticateProject } from "@/api/bearer";
import { apiError } from "@/api/body";
import { withdrawProposal } from "@/proposals/service";

// The agent actor withdraws one of its own pending proposals (§10,
// §11); a person's answers 403, as the actor is never a maintainer.
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const proposalId = Number(id);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return apiError(404, "not-found", `no proposal ${id}`);
  }
  const result = withdrawProposal(db, {
    proposalId,
    projectId: auth.project.id,
    actor: ensureAgentActor(db, auth.project),
  });
  if (!result.ok) {
    switch (result.reason) {
      case "not-found":
        return apiError(404, "not-found", `no proposal ${id}`);
      case "forbidden":
        return apiError(
          403,
          "forbidden",
          `proposal ${id} is a person's; only its author or a maintainer withdraws it`,
        );
      case "not-pending":
        return apiError(
          409,
          "not-pending",
          `proposal ${id} is no longer pending`,
        );
    }
  }
  return Response.json({ id: proposalId, status: "withdrawn" });
}
