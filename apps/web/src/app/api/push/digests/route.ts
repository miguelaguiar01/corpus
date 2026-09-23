import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";

// What the last push digested per target language (#601), for the
// CLI to leave out the seeds the instance already holds. Apart from
// status, which counts every row of the project to answer.
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  return Response.json({ seedDigests: auth.project.seedDigests ?? null });
}
