import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { Chip } from "@/components/ui/chip";
import { STATE_KEY } from "./state-label";

// Three states, three treatments that survive both themes and do not
// rely on hue alone: outlined, filled achromatic, filled moss with a
// mark.
const STATE_VARIANT = {
  untranslated: "outline",
  translated: "neutral",
  verified: "state-verified",
} as const satisfies Record<LanguageState["state"], string>;

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
          <Chip
            key={language}
            variant={STATE_VARIANT[state]}
            title={t(STATE_KEY[state])}
          >
            {state === "verified" && <span aria-hidden="true">✓</span>}
            <span className="font-medium">{language}</span>
            {value?.stale && (
              <span className="rounded-sm bg-state-stale px-1 text-state-stale-foreground">
                {t("state.stale")}
              </span>
            )}
          </Chip>
        );
      })}
    </div>
  );
}
