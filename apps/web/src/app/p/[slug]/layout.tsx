import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { getProjectBySlug, listProjects } from "@/projects/service";

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
    <AppShell project={slug} maintainer={user.maintainer} projects={projects}>
      {children}
    </AppShell>
  );
}
