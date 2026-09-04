import Link from "next/link";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";

// Custom 404 so Next's built-in English fallback never renders (§12: all
// chrome strings come from the catalog).
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">{t("notFound.heading")}</h1>
      <p className="text-muted-foreground">{t("notFound.description")}</p>
      <Button asChild variant="outline">
        <Link href="/">{t("notFound.backHome")}</Link>
      </Button>
    </main>
  );
}
