import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { Chip } from "@/components/ui/chip";
import { STATE_KEY, STATE_VARIANT } from "./state-label";

// Per-language state chips (§9.2): display only; the editor's switcher
// is the language bar.
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
