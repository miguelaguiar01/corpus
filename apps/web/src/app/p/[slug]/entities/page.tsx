import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { entitiesByType } from "@/entities/browser";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

// Entity browser (§9.4): read-only cards per entity type.
export default async function EntitiesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const groups = entitiesByType(db, project.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">{t("entities.heading")}</h1>
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("entities.empty")}</p>
      )}
      {groups.map((group) => (
        <section key={group.type} className="space-y-3">
          <h2 className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">{group.label}</span>
            <span className="text-sm text-muted-foreground">
              {group.entities.length}
            </span>
          </h2>
          <EntityCards entities={group.entities} />
        </section>
      ))}
    </main>
  );
}
