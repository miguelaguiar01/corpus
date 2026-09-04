import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { applySnapshot } from "@/ingest/apply";
import { validateSnapshot } from "@/ingest/validate";

export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "bad-request", message: "body is not valid JSON" },
      { status: 400 },
    );
  }

  const validation = validateSnapshot(body);
  if (!validation.ok) {
    return Response.json(
      { error: "invalid-snapshot", errors: validation.errors },
      { status: 422 },
    );
  }
  if (validation.snapshot.project !== auth.project.slug) {
    return Response.json(
      {
        error: "project-mismatch",
        message: "token is for a different project",
      },
      { status: 403 },
    );
  }

  const report = applySnapshot(db, auth.project.id, validation.snapshot);
  return Response.json({ report });
}
