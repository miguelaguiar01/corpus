import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { listProjects } from "@/projects/service";
import { t } from "@/i18n";

export default async function Home() {
  const user = await requireUser();
  const projects = listProjects(getDb());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{t("home.projectsHeading")}</h1>
        {user.maintainer && (
          <Link href="/projects/new" className="text-sm underline">
            {t("home.newProject")}
          </Link>
        )}
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("home.noProjects")}</p>
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
    </main>
  );
}
