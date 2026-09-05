import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";

// Per-language progress broken down by string type (§9.1).
export function ProgressByType({ progress }: { progress: Progress }) {
  const languages = Object.keys(progress.perLanguage);
  if (languages.length === 0) return null;
  const types = Object.keys(progress.perType);
  return (
    <div className="space-y-6">
      {languages.map((language) => {
        const p = progress.perLanguage[language]!;
        return (
          <section key={language} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold">{language}</h3>
              <span className="text-xs text-muted-foreground">
                {t("progress.summary", {
                  verified: p.verified,
                  translated: p.translated,
                  total: p.total,
                })}
              </span>
            </div>
            {types.map((type) => {
              const tp = progress.perType[type]?.[language];
              return tp ? (
                <div key={type} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate text-muted-foreground">
                    {type}
                  </span>
                  <ProgressBar p={tp} label={type} className="h-1.5 flex-1" />
                </div>
              ) : null;
            })}
          </section>
        );
      })}
    </div>
  );
}
