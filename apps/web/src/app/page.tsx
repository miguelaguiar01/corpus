import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { listProjects } from "@/projects/service";
import { t } from "@/i18n";

export default async function Home() {
  const user = await requireUser();
  const projects = listProjects(getDb());

  return (
    <AppShell>
      <Page width="reading" className="space-y-6">
        <PageHeader
          title={t("home.projectsHeading")}
          actions={
            user.maintainer && (
              <Link href="/projects/new" className="text-sm underline">
                {t("home.newProject")}
              </Link>
            )
          }
        />
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("home.noProjects")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {projects.map((p) => (
              <li key={p.slug}>
                <Link
                  href={`/p/${p.slug}`}
                  className="flex items-center justify-between py-3 hover:underline"
                >
                  <span>{p.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.languages.join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Page>
    </AppShell>
  );
}
