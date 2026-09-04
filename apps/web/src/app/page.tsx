import { requireUser } from "@/auth/session";
import { t } from "@/i18n";

// Placeholder landing — replaced by the project dashboard in M2 (§9.1).
export default async function Home() {
  const user = await requireUser();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <h1 className="text-4xl font-semibold tracking-tight">
        {t("home.heading")}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("home.signedInAs", { name: user.name })}
      </p>
    </main>
  );
}
