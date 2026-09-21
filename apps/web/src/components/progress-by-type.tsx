import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { ProgressBar } from "./progress-bar";
import { ProgressLegend } from "./progress-legend";
import { ProgressRow } from "./progress-row";

// Past this many languages the blocks become a table: a project of
// dozens of languages with one string type is otherwise a wall of one
// bar each (§9.1).
const TABLE_FROM_LANGUAGES = 8;

// Per-language progress: a block per language broken down by string
// type, or, from eight languages on, a table of one row each with the
// breakdown behind the row (§9.1).
export function ProgressByType({ progress }: { progress: Progress }) {
  const languages = Object.keys(progress.perLanguage);
  if (languages.length === 0) return null;
  const types = Object.keys(progress.perType);
  if (languages.length >= TABLE_FROM_LANGUAGES) {
    return (
      <div className="space-y-3">
        <ProgressLegend />
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">{t("progress.languageColumn")}</th>
              <th scope="col">{t("progress.progressColumn")}</th>
              <th scope="col" className="hidden sm:table-cell">
                {t("progress.summaryColumn")}
              </th>
            </tr>
          </thead>
          <tbody>
            {languages.map((language) => (
              <ProgressRow
                key={language}
                language={language}
                p={progress.perLanguage[language]!}
                types={types.flatMap((type) => {
                  const tp = progress.perType[type]?.[language];
                  return tp ? [{ type, p: tp }] : [];
                })}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ProgressLegend />
      {languages.map((language) => {
        const p = progress.perLanguage[language]!;
        return (
          <section key={language} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-medium">{language}</h3>
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
