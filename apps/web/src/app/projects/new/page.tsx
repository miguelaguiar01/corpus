import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell";
import { Page } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { t } from "@/i18n";
import { NewProjectForm } from "./form";

// Minimal maintainer-only surface; absorbed by the M4 maintainer corner.
export default async function NewProjectPage() {
  const user = await requireUser();
  if (!user.maintainer) notFound();
  return (
    <AppShell>
      <Page width="form" className="space-y-6">
        <PageHeader title={t("newProject.heading")} />
        <NewProjectForm />
      </Page>
    </AppShell>
  );
}
