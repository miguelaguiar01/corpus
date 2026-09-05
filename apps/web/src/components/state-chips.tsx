import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { STATE_KEY } from "./state-label";

// Three states, three treatments that survive both themes and do not
// rely on hue alone: outlined, filled quiet, filled strong with a mark.
// (`muted` and `secondary` share a colour in globals.css, which is why
// untranslated and translated used to look the same.)
const STATE_CLASS: Record<LanguageState["state"], string> = {
  untranslated: "border border-border text-muted-foreground",
  translated: "bg-muted-foreground text-background",
  verified: "bg-primary text-primary-foreground",
};

export function StateChips({
  languages,
  states,
}: {
  languages: string[];
  states: Record<string, LanguageState>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {languages.map((language) => {
        const value = states[language];
        const state = value?.state ?? "untranslated";
        return (
          <span
            key={language}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${STATE_CLASS[state]}`}
            title={t(STATE_KEY[state])}
          >
            {state === "verified" && <span aria-hidden="true">✓</span>}
            <span className="font-medium">{language}</span>
            {value?.stale && (
              <span className="rounded-sm bg-destructive px-1 text-destructive-foreground">
                {t("state.stale")}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
