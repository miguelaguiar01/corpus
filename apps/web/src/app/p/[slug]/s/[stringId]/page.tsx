import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { EntityCards } from "@/components/entity-cards";
import { HistoryList } from "@/components/history-list";
import { MetadataChips } from "@/components/metadata-chips";
import { StateChips } from "@/components/state-chips";
import { getProjectBySlug } from "@/projects/service";
import { stringDetail } from "@/strings/detail";
import { t } from "@/i18n";

type Example = { values: Record<string, string>; rendered: string };

// Source verification surface (§9.3, M2): read the source with everything
// that gives it context, then proofread. The verify action and queue flow
// arrive in #91; the full editor is M3.
export default async function StringPage({
  params,
}: {
  params: Promise<{ slug: string; stringId: string }>;
}) {
  const { slug, stringId } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const detail = stringDetail(db, project.id, decodeURIComponent(stringId));
  if (!detail) notFound();
  const { string, declarations, translations, entities, history } = detail;
  const examples = (string.examples ?? []) as Example[];

  return (
    <main className="mx-auto max-w-xl space-y-8">
      <header className="space-y-3">
        <p className="font-mono text-xs text-muted-foreground">{string.key}</p>
        <p className="text-2xl leading-snug">{string.source}</p>
        {string.archived && (
          <p className="text-sm text-destructive">{t("string.archived")}</p>
        )}
        <StateChips languages={project.languages} states={translations} />
        <MetadataChips
          declarations={declarations}
          metadata={string.metadata ?? {}}
        />
      </header>

      {entities.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm text-muted-foreground">
            {t("string.entitiesHeading")}
          </h2>
          <EntityCards entities={entities} />
        </section>
      )}

      {examples.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm text-muted-foreground">
            {t("string.examplesHeading")}
          </h2>
          <ul className="space-y-2">
            {examples.map((example, index) => (
              <li key={index} className="text-base leading-relaxed">
                {example.rendered}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm text-muted-foreground">
          {t("string.historyHeading")}
        </h2>
        <HistoryList history={history} />
      </section>
    </main>
  );
}
