import { MIN_STATES, type MinState } from "@corpus/contract";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { pullPayload } from "@/pull/payload";

function isMinState(value: string): value is MinState {
  return (MIN_STATES as readonly string[]).includes(value);
}

export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const minState =
    new URL(request.url).searchParams.get("minState") ?? "verified";
  if (!isMinState(minState)) {
    return Response.json(
      {
        error: "bad-request",
        message: `minState must be one of ${MIN_STATES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  return Response.json(pullPayload(db, auth.project, minState));
}
