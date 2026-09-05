import { t } from "@/i18n";
import { STATE_KEY } from "./state-label";

// The one legend for every progress bar: the same three fills as
// ProgressBar, named once.
const FILL = {
  verified: "bg-state-verified",
  translated: "bg-muted-foreground",
  untranslated: "border border-border bg-muted",
} as const;

export function ProgressLegend() {
  return (
    <ul
      aria-label={t("progress.legend")}
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {(Object.keys(FILL) as (keyof typeof FILL)[]).map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-3 rounded-sm ${FILL[state]}`}
          />
          {t(STATE_KEY[state])}
        </li>
      ))}
    </ul>
  );
}
