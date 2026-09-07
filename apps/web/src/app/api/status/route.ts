import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { authenticateProject } from "@/api/bearer";
import { progressCounts } from "@/catalogue/progress";
import { pushes, strings } from "@/db/schema";
import { appVersion } from "@/version";

// The dashboard's numbers for the CLI (§9.1): the same progress query,
// with the project's languages so the config can be compared.
export async function GET(request: Request): Promise<Response> {
  const db = getDb();
  const auth = authenticateProject(db, request);
  if (!auth.ok) return auth.response;
  const { project } = auth;

  const activeStrings = db
    .select({ id: strings.id })
    .from(strings)
    .where(and(eq(strings.projectId, project.id), eq(strings.archived, false)))
    .all().length;
  const lastPush = db
    .select({ at: pushes.at })
    .from(pushes)
    .where(eq(pushes.projectId, project.id))
    .orderBy(desc(pushes.at))
    .limit(1)
    .get();

  return Response.json({
    project: project.slug,
    sourceLanguage: project.sourceLanguage,
    languages: project.languages,
    strings: activeStrings,
    lastPushAt: lastPush ? lastPush.at.toISOString() : null,
    version: appVersion(process.env),
    progress: progressCounts(db, project.id),
  });
}
