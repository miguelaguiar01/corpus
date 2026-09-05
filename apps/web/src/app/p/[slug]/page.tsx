import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { getDb } from "@/db";
import { progressCounts } from "@/catalogue/progress";
import { allQueues } from "@/catalogue/queues";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ProgressByType } from "@/components/progress-by-type";
import { QueueList } from "@/components/queue-list";
import { Chip } from "@/components/ui/chip";
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
  await requireUser();
  const { slug } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();
  const queues = allQueues(db, project.id);
  const progress = progressCounts(db, project.id);

  return (
    <Page width="wide" className="space-y-8">
      <PageHeader
        title={project.name}
        meta={
          <span className="flex flex-wrap gap-1.5">
            {project.languages.map((language) => (
              <Chip key={language} variant="outline">
                {language}
              </Chip>
            ))}
          </span>
        }
      />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
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
      </div>
    </Page>
  );
}
