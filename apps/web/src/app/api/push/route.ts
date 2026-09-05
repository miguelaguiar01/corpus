import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { MAX_BODY_BYTES } from "@/api/limits";
import { applySnapshot } from "@/ingest/apply";
import { validateSnapshot } from "@/ingest/validate";

function tooLarge(): Response {
  return Response.json(
    {
      error: "payload-too-large",
      message: `body exceeds ${MAX_BODY_BYTES} bytes`,
    },
    { status: 413 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return tooLarge();

  let body: unknown;
  try {
    body = JSON.parse(text);
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

  const dryRun = new URL(request.url).searchParams.has("dryRun");
  const report = applySnapshot(db, auth.project.id, validation.snapshot, {
    dryRun,
  });
  return Response.json({ report, dryRun });
}
