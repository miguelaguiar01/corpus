import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";

// One line per language above the catalogue (§9.2); the dashboard has
// the breakdown by type.
export function ProgressStrip({ progress }: { progress: Progress }) {
  const languages = Object.keys(progress.perLanguage);
  if (languages.length === 0) return null;
  return (
    <ul className="grid gap-x-12 gap-y-1.5 lg:grid-cols-2">
      {languages.map((language) => {
        const p = progress.perLanguage[language]!;
        return (
          <li key={language} className="flex items-center gap-3 text-xs">
            <span className="w-14 shrink-0 font-medium">{language}</span>
            <ProgressBar p={p} label={language} className="h-1.5 flex-1" />
            <span className="w-52 shrink-0 text-right whitespace-nowrap text-muted-foreground">
              {t("progress.summary", {
                verified: p.verified,
                translated: p.translated,
                total: p.total,
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
