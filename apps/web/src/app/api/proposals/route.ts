import {
  newStringBodySchema,
  type ProposalListResponse,
} from "@corpus/contract";
import { getDb } from "@/db";
import { ensureAgentActor, findAgentActor } from "@/agents/actor";
import { authenticateProject } from "@/api/bearer";
import { readBody } from "@/api/body";
import { proposalCreated, proposalRefusal } from "@/api/proposal-response";
import {
  pendingProposals,
  proposeAdd,
  namespacedKey,
} from "@/proposals/service";
import { users } from "@/db/schema";
import { inArray } from "drizzle-orm";

// The project's pending proposals for an agent (§10, §11), the agent
// actor's own marked, since those are the ones it may withdraw.
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const actorId = findAgentActor(db, auth.project);
  const pending = pendingProposals(db, auth.project.id);
  const authorIds = [...new Set(pending.map((p) => p.authorId))];
  const names = new Map(
    (authorIds.length
      ? db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, authorIds))
          .all()
      : []
    ).map((u) => [u.id, u.name]),
  );
  const body: ProposalListResponse = {
    proposals: pending.map((p) => ({
      id: p.id,
      kind: p.kind,
      key: p.key,
      file: p.file,
      text: p.text,
      status: "pending",
      author: names.get(p.authorId) ?? "",
      createdAt: p.createdAt.toISOString(),
      mine: p.authorId === actorId,
    })),
  };
  return Response.json(body);
}

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
  if (!result.ok) {
    const key = source
      ? (namespacedKey(source, body.value.key.trim()) ?? body.value.key)
      : body.value.key;
    return proposalRefusal(result, key, auth.project);
  }
  return proposalCreated(result.proposal, actor.name);
}
