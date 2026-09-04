import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";

// Per-language progress bar (§9.2). The full dashboard with queues is M2.
export function ProgressStrip({ progress }: { progress: Progress }) {
  const languages = Object.keys(progress.perLanguage);
  if (languages.length === 0) return null;
  return (
    <div className="space-y-2">
      {languages.map((language) => {
        const p = progress.perLanguage[language]!;
        return (
          <div key={language} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{language}</span>
              <span className="text-muted-foreground">
                {t("progress.summary", {
                  verified: p.verified,
                  translated: p.translated,
                  total: p.total,
                })}
              </span>
            </div>
            <ProgressBar p={p} label={language} className="h-2" />
          </div>
        );
      })}
    </div>
  );
}
