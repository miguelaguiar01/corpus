import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

// Project overview; the dashboard with queues lands in M2 (§9.1).
export default async function ProjectHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(getDb(), slug);
  if (!project) notFound();
  return (
    <main className="space-y-3">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-sm text-muted-foreground">
        {t("project.languages", { languages: project.languages.join(", ") })}
      </p>
      <Link
        href={`/p/${slug}/catalogue`}
        className="inline-block text-sm underline"
      >
        {t("nav.catalogue")}
      </Link>
    </main>
  );
}
