import { t } from "@/i18n";
import { FILL } from "./progress-bar";
import { STATE_KEY } from "./state-label";

// A 12x8 swatch of the track needs a border to read; the bar's own
// length does not.
const SWATCH = {
  ...FILL,
  untranslated: `border border-border ${FILL.untranslated}`,
};

export function ProgressLegend() {
  return (
    <ul
      aria-label={t("progress.legend")}
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {(Object.keys(SWATCH) as (keyof typeof SWATCH)[]).map((state) => (
        <li key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-2 w-3 rounded-sm ${SWATCH[state]}`}
          />
          {t(STATE_KEY[state])}
        </li>
      ))}
    </ul>
  );
}
