import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { issueToken } from "@/projects/service";

// Rotates a project's token with its current token (§10): the old one
// stops working at once and the new one is returned once. The invite
// secret is every translator's credential, so it never reaches here.
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;

  const { slug } = await context.params;
  if (auth.project.slug !== slug) {
    return Response.json(
      {
        error: "project-mismatch",
        message: "token is for a different project",
      },
      { status: 403 },
    );
  }
  const token = issueToken(db, auth.project.id);
  return Response.json({ slug, token });
}
