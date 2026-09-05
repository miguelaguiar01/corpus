import type { LanguageProgress } from "@/catalogue/progress";

// One bar for both progress views: verified in the state colour,
// translated in the achromatic tone, the remainder untranslated. Sized
// by the caller.
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
      className={`flex overflow-hidden rounded-full bg-muted ${className}`}
    >
      <span
        className="bg-state-verified"
        style={{ width: `${pct(p.verified)}%` }}
      />
      <span
        className="bg-muted-foreground"
        style={{ width: `${pct(p.translated)}%` }}
      />
    </div>
  );
}
