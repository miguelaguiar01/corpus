import type { LanguageProgress } from "@/catalogue/progress";

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
