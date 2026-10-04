import type { Progress } from "@/catalogue/progress";
import { t } from "@/i18n";
import { InvalidSlot, ProgressBar, ProgressSummary } from "./progress-bar";
import { ProgressLegend } from "./progress-legend";
import { ProgressRow } from "./progress-row";
import { inVariantOrder, VariantLabel } from "./variant-label";

// Past this many languages the blocks become a table: a project of
// dozens of languages with one string type is otherwise a wall of one
// bar each (§9.1).
const TABLE_FROM_LANGUAGES = 8;

// Per-language progress: a block per language broken down by string
// type, or, from eight languages on, a table of one row each with the
// breakdown behind the row (§9.1).
export function ProgressByType({
  progress,
  sourceLanguage,
  sourceVariants = [],
}: {
  progress: Progress;
  sourceLanguage: string;
  // Targets that fall back to the source (#658): their untranslated rows
  // are no work, so they come after the targets, named so (#699).
  sourceVariants?: string[];
}) {
  const variants = new Set(sourceVariants);
  const variantOf = (language: string) =>
    variants.has(language) ? sourceLanguage : undefined;
  const languages = inVariantOrder(Object.keys(progress.perLanguage), variants);
  if (languages.length === 0) return null;
  const types = Object.keys(progress.perType);
  const anyInvalid = Object.values(progress.perType).some((byLanguage) =>
    Object.values(byLanguage).some((p) => p.invalid > 0),
  );
  if (languages.length >= TABLE_FROM_LANGUAGES) {
    // The table answers "what needs a translator" (§9.1), so it leads
    // with the language that has the most untranslated rows; the source
    // language is pinned, since its rows are the project's own text. The
    // tie-break compares code units rather than collating, so the order
    // does not depend on the locale the instance happens to run under.
    const left = (l: string) => progress.perLanguage[l]?.untranslated ?? 0;
    const ordered = [...languages].sort((a, b) => {
      if (a === sourceLanguage) return -1;
      if (b === sourceLanguage) return 1;
      if (variants.has(a) !== variants.has(b)) return variants.has(a) ? 1 : -1;
      return left(b) - left(a) || (a < b ? -1 : a > b ? 1 : 0);
    });
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
            {ordered.map((language) => (
              <ProgressRow
                key={language}
                language={language}
                variantOf={variantOf(language)}
                anyInvalid={anyInvalid}
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
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="shrink-0 text-base font-medium whitespace-nowrap">
                {language}
                <VariantLabel source={variantOf(language)} />
              </h3>
              <ProgressSummary p={p} />
            </div>
            {types.map((type) => {
              const tp = progress.perType[type]?.[language];
              return tp ? (
                <div key={type} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0 truncate text-muted-foreground">
                    {type}
                  </span>
                  <ProgressBar p={tp} label={type} className="h-1.5 flex-1" />
                  <InvalidSlot n={tp.invalid} reserve={anyInvalid} />
                </div>
              ) : null;
            })}
          </section>
        );
      })}
    </div>
  );
}
