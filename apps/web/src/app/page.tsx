import { t } from "@/i18n";

// Placeholder landing — replaced by the project dashboard in M2 (§9.1).
export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        {t("home.heading")}
      </h1>
    </main>
  );
}
