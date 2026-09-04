import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { strings } from "@/db/schema";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

// Stub string view; the editor lands in M3 (§9.3).
export default async function StringPage({
  params,
}: {
  params: Promise<{ slug: string; stringId: string }>;
}) {
  const { slug, stringId } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const row = db
    .select()
    .from(strings)
    .where(
      and(
        eq(strings.projectId, project.id),
        eq(strings.stringId, decodeURIComponent(stringId)),
      ),
    )
    .get();
  if (!row) notFound();

  return (
    <main className="space-y-3">
      <h1 className="font-mono text-lg">{row.stringId}</h1>
      <p className="text-sm">{row.source}</p>
      <p className="text-sm text-muted-foreground">{t("editor.stub")}</p>
    </main>
  );
}
