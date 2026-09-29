import type { LanguageProgress } from "@/catalogue/progress";
import { t } from "@/i18n";

// One bar for both progress views: verified in the state colour,
// translated in the achromatic tone, the remainder the track. The
// legend uses the same three fills. Sized by the caller.
export const FILL = {
  verified: "bg-state-verified",
  translated: "bg-muted-foreground",
  untranslated: "bg-muted",
} as const;

export function ProgressBar({
  p,
  label,
  className,
}: {
  p: LanguageProgress;
  label?: string;
  className: string;
}) {
  const pct = (n: number) => (p.total ? (n / p.total) * 100 : 0);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={p.total}
      aria-valuenow={p.verified + p.translated}
      className={`flex overflow-hidden rounded-full ${FILL.untranslated} ${className}`}
    >
      <span
        className={FILL.verified}
        style={{ width: `${pct(p.verified)}%` }}
      />
      <span
        className={FILL.translated}
        style={{ width: `${pct(p.translated)}%` }}
      />
    </div>
  );
}

// The translated rows that fail validation (#646), beside a type's bar
// where there are any (§9.1, #911): part of translated, so a number and
// not a share of the bar.
export function InvalidCount({
  n,
  className = "",
}: {
  n: number;
  className?: string;
}) {
  if (n === 0) return null;
  return (
    <span className={`text-xs text-destructive ${className}`}>
      {t("progress.invalid", { count: n })}
    </span>
  );
}

// A language's counts, and its invalid rows after a real space, so a
// screen reader and a copy read them apart.
export function ProgressSummary({ p }: { p: LanguageProgress }) {
  return (
    <span className="text-right text-xs text-muted-foreground sm:whitespace-nowrap">
      {t("progress.summary", {
        verified: p.verified,
        translated: p.translated,
        total: p.total,
      })}
      {p.invalid > 0 && (
        <>
          {" "}
          <span className="text-destructive">
            {t("progress.invalidAfter", { count: p.invalid })}
          </span>
        </>
      )}
    </span>
  );
}

// A per-type bar's invalid count, in a slot every such bar has once any
// has a count, so the bars still end together.
export function InvalidSlot({ n, reserve }: { n: number; reserve: boolean }) {
  if (!reserve) return null;
  return (
    <span className="w-24 shrink-0 text-right whitespace-nowrap">
      <InvalidCount n={n} />
    </span>
  );
}
