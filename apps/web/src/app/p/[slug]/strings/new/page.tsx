import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { getDb } from "@/db";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { getProjectBySlug } from "@/projects/service";
import { t } from "@/i18n";
import { AddStringForm } from "./form";

// The catalogue's "Add a string" (§9.2): a key, a source file among
// the writable sources push declared, and the source text, recorded
// as a pending add (§11) by anyone signed in.
export default async function NewString({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await params;
  const project = getProjectBySlug(getDb(), slug);
  if (!project) notFound();
  const sources = project.sources ?? [];
  return (
    <Page width="form" className="space-y-6">
      <PageHeader title={t("proposal.addHeading")} />
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("proposal.addNoSources")}
        </p>
      ) : (
        <AddStringForm slug={slug} sources={sources} />
      )}
    </Page>
  );
}
