import { notFound } from "next/navigation";
import { requireUser } from "@/auth/session";
import { t } from "@/i18n";
import { NewProjectForm } from "./form";

// Minimal maintainer-only surface; absorbed by the M4 maintainer corner.
export default async function NewProjectPage() {
  const user = await requireUser();
  if (!user.maintainer) notFound();
  return (
    <main className="mx-auto max-w-sm space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold">{t("newProject.heading")}</h1>
      <NewProjectForm />
    </main>
  );
}
