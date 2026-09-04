import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";

// Per-language progress bar (§9.2). The full dashboard with queues is M2.
export function ProgressStrip({ progress }: { progress: Progress }) {
  const languages = Object.keys(progress.perLanguage);
  if (languages.length === 0) return null;
  return (
    <div className="space-y-2">
      {languages.map((language) => {
        const p = progress.perLanguage[language]!;
        const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0);
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
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="bg-primary"
                style={{ width: `${pct(p.verified)}%` }}
              />
              <span
                className="bg-muted-foreground"
                style={{ width: `${pct(p.translated)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
