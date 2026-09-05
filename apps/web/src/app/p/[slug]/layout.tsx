import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { ProjectSwitcher } from "@/components/project-switcher";
import { getProjectBySlug, listProjects } from "@/projects/service";
import { t } from "@/i18n";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const db = getDb();
  const project = getProjectBySlug(db, slug);
  if (!project) notFound();

  const projects = listProjects(db).map((p) => ({
    slug: p.slug,
    name: p.name,
  }));

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Link href="/" className="text-sm font-semibold">
          {t("app.title")}
        </Link>
        <ProjectSwitcher current={slug} projects={projects} />
        <nav className="ml-auto flex gap-4 text-sm">
          <Link href={`/p/${slug}`} className="hover:underline">
            {t("nav.overview")}
          </Link>
          <Link href={`/p/${slug}/catalogue`} className="hover:underline">
            {t("nav.catalogue")}
          </Link>
          <Link href={`/p/${slug}/entities`} className="hover:underline">
            {t("nav.entities")}
          </Link>
        </nav>
      </header>
      <div className="px-4 py-6">{children}</div>
    </div>
  );
}
