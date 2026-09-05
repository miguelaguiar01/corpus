import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { progressCounts } from "@/catalogue/progress";
import { allQueues } from "@/catalogue/queues";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ProgressByType } from "@/components/progress-by-type";
import { QueueList } from "@/components/queue-list";
import { Section } from "@/components/ui/section";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

// The dashboard (§9.1): what to work on first, then how far along each
// language is, by string type.
export default async function ProjectHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const queues = allQueues(db, project.id);
  const progress = progressCounts(db, project.id);

  return (
    <Page width="reading" className="space-y-8">
      <PageHeader
        title={project.name}
        meta={t("project.languages", {
          languages: project.languages.join(", "),
        })}
      />
      <Section heading={t("dashboard.queuesHeading")}>
        <QueueList
          slug={slug}
          counts={{
            untranslated: queues.untranslated.count,
            stale: queues.stale.count,
            unverifiedSource: queues.unverifiedSource.count,
          }}
          first={{
            untranslated: queues.untranslated.first,
            stale: queues.stale.first,
            unverifiedSource: queues.unverifiedSource.first,
          }}
        />
      </Section>
      <Section heading={t("dashboard.progressHeading")}>
        <ProgressByType progress={progress} />
      </Section>
    </Page>
  );
}
