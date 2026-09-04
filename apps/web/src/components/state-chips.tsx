import { t } from "@/i18n";
import type { LanguageState } from "@/catalogue/query";
import { STATE_KEY } from "./state-label";

const STATE_CLASS: Record<LanguageState["state"], string> = {
  untranslated: "bg-muted text-muted-foreground",
  translated: "bg-secondary text-secondary-foreground",
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
