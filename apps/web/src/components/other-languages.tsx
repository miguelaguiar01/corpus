import { t } from "@/i18n";
import type { StringDetail } from "@/strings/detail";
import { Chip } from "@/components/ui/chip";
import { Section } from "@/components/ui/section";
import { STATE_KEY, STATE_VARIANT } from "./state-label";

// The same sentence in the other languages (§9.3): every language of
// the project except the source and the one being read, so a
// translator can lean on a finished translation without leaving the
// string. Read only; nothing here saves. Renders nothing when no other
// language remains.
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
    <Section heading={t("string.otherLanguagesHeading")}>
      <dl className="space-y-2">
        {others.map((language) => {
          const row = translations[language];
          const state = row?.state ?? "untranslated";
          const hasText = Boolean(row?.text);
          return (
            <div key={language} className="flex flex-wrap items-baseline gap-2">
              <dt className="flex items-center gap-1.5">
                <span className="font-medium">{language}</span>
                <Chip variant={STATE_VARIANT[state]}>
                  {t(STATE_KEY[state])}
                </Chip>
                {row?.stale && (
                  <Chip variant="state-stale">{t("state.stale")}</Chip>
                )}
              </dt>
              <dd
                className={
                  hasText
                    ? "text-base leading-relaxed"
                    : "text-muted-foreground"
                }
              >
                {hasText ? row?.text : t("string.otherLanguagesNone")}
              </dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}
