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
  const user = await requireUser();
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
      {/* Wraps on a phone: four links beside the switcher overflow 390px,
          and a page that overflows sideways breaks fixed-bar hit testing. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <Link href="/" className="text-sm font-semibold">
          {t("app.title")}
        </Link>
        <ProjectSwitcher current={slug} projects={projects} />
        <nav className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href={`/p/${slug}`} className="hover:underline">
            {t("nav.overview")}
          </Link>
          <Link href={`/p/${slug}/catalogue`} className="hover:underline">
            {t("nav.catalogue")}
          </Link>
          <Link href={`/p/${slug}/entities`} className="hover:underline">
            {t("nav.entities")}
          </Link>
          {user.maintainer && (
            <Link href={`/p/${slug}/settings`} className="hover:underline">
              {t("nav.settings")}
            </Link>
          )}
        </nav>
      </header>
      <div className="px-4 py-6">{children}</div>
    </div>
  );
}
