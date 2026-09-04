import type { LanguageProgress, Progress } from "@/catalogue/progress";
import { t } from "@/i18n";

function Bar({ label, p }: { label: string; p: LanguageProgress }) {
  const done = p.verified + p.translated;
  const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0);
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 truncate text-muted-foreground">
        {label}
      </span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={done}
        className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <span className="bg-primary" style={{ width: `${pct(p.verified)}%` }} />
        <span
          className="bg-muted-foreground"
          style={{ width: `${pct(p.translated)}%` }}
        />
      </div>
    </div>
  );
}

// Per-language progress broken down by string type (§9.1). Verified fills
// in the foreground tone, translated in the quieter one; the remainder is
// untranslated.
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
              return tp ? <Bar key={type} label={type} p={tp} /> : null;
            })}
          </section>
        );
      })}
    </div>
  );
}
