import { t } from "@/i18n";
import type { StringDetail } from "@/strings/detail";
import { Chip } from "@/components/ui/chip";
import { STATE_KEY } from "./state-label";

// The same sentence in the other languages (§9.3): every language of
// the project except the source and the one being edited, read only,
// so a translator can lean on a finished translation without leaving
// the string. Nothing here saves.
export function OtherLanguages({
  languages,
  exclude,
  translations,
}: {
  languages: string[];
  exclude: string[];
  translations: StringDetail["translations"];
}) {
  const others = languages.filter((l) => !exclude.includes(l));
  if (others.length === 0) return null;
  return (
    <dl className="space-y-2">
      {others.map((language) => {
        const row = translations[language];
        const state = row?.state ?? "untranslated";
        return (
          <div key={language} className="flex flex-wrap items-baseline gap-2">
            <dt className="flex items-center gap-1.5">
              <span className="font-medium">{language}</span>
              <Chip
                variant={state === "verified" ? "state-verified" : "outline"}
              >
                {t(STATE_KEY[state])}
              </Chip>
              {row?.stale && (
                <Chip variant="state-stale">{t("state.stale")}</Chip>
              )}
            </dt>
            <dd
              className={
                row?.text
                  ? "text-base leading-relaxed"
                  : "text-muted-foreground italic"
              }
            >
              {row?.text ?? t("string.otherLanguagesNone")}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
