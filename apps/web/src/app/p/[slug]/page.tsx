import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";

// Placeholder project home; the catalogue list lands in #48.
export default async function ProjectHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProjectBySlug(getDb(), slug);
  if (!project) notFound();
  return (
    <main className="space-y-2">
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-sm text-muted-foreground">
        {t("project.languages", { languages: project.languages.join(", ") })}
      </p>
    </main>
  );
}
