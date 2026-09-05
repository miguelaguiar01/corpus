import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { progressCounts } from "@/catalogue/progress";
import { queueCounts } from "@/catalogue/queues";
import { AppShell } from "@/components/app-shell";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";
import { listProjects } from "@/projects/service";
import { t } from "@/i18n";

export default async function Home() {
  const user = await requireUser();
  const db = getDb();
  const projects = listProjects(db).map((project) => ({
    slug: project.slug,
    name: project.name,
    languages: project.languages,
    progress: progressCounts(db, project.id).perLanguage,
    counts: queueCounts(db, project.id),
  }));

  return (
    <AppShell>
      <Page width="wide" className="space-y-6">
        <PageHeader
          title={t("home.projectsHeading")}
          actions={
            user.maintainer && (
              <Button asChild>
                <Link href="/projects/new">{t("home.newProject")}</Link>
              </Button>
            )
          }
        />
        {projects.length === 0 ? (
          <div className="max-w-2xl space-y-3">
            <p className="text-lg">{t("home.noProjects")}</p>
            <p className="text-sm text-muted-foreground">
              {user.maintainer
                ? t("home.emptyMaintainer")
                : t("home.emptyTranslator")}
            </p>
            {user.maintainer && (
              <code className="block w-fit rounded-md bg-muted px-3 py-2 text-sm">
                corpus push
              </code>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.slug}>
                <ProjectCard
                  slug={project.slug}
                  name={project.name}
                  languages={project.languages}
                  progress={project.progress}
                  counts={project.counts}
                />
              </li>
            ))}
          </ul>
        )}
      </Page>
    </AppShell>
  );
}
